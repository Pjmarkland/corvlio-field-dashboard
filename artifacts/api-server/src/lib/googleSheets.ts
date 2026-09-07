const REQUIRED_HEADERS = [
  "Timestamp",
  "Caller Name",
  "Phone",
  "Issue",
  "Address",
  "Urgency",
  "Status",
  "🔐 Softr Record ID",
  "Contacted At",
] as const;

type LeadStatus = "pending" | "contacted";

export class GoogleSheetStatusError extends Error {
  readonly status: 404 | 409 | 429 | 502;

  constructor(
    message: string,
    status: 404 | 409 | 429 | 502,
  ) {
    super(message);
    this.name = "GoogleSheetStatusError";
    this.status = status;
  }
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function requireOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Sheets OAuth credentials are not configured");
  }
  return { clientId, clientSecret, refreshToken };
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const { clientId, clientSecret, refreshToken } = requireOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth refresh failed${data.error ? `: ${data.error}` : ""}`);
  }

  cachedAccessToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

function normalizeUrgency(value: string): "urgent" | "normal" | "low" {
  const normalized = value.trim().toLowerCase();
  if (["urgent", "high", "emergency", "same-day", "same day"].some((label) => normalized.includes(label))) {
    return "urgent";
  }
  if (["low", "flexible", "can wait", "whenever"].some((label) => normalized.includes(label))) {
    return "low";
  }
  return "normal";
}

function normalizeStatus(value: string): "pending" | "contacted" {
  return ["contacted", "complete", "completed", "done"].includes(value.trim().toLowerCase())
    ? "contacted"
    : "pending";
}

function parseTimestamp(value: string, rowNumber: number): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid Timestamp in spreadsheet row ${rowNumber}`);
  }
  return timestamp.toISOString();
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function parseSheetTimestamp(value: unknown, timeZone: string, rowNumber: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return parseTimestamp(String(value ?? ""), rowNumber);
  }
  const wallClockMs = Date.UTC(1899, 11, 30) + value * 86_400_000;
  let instant = new Date(wallClockMs);
  instant = new Date(wallClockMs - getTimeZoneOffsetMs(instant, timeZone));
  instant = new Date(wallClockMs - getTimeZoneOffsetMs(instant, timeZone));
  return instant.toISOString();
}

function parseOptionalSheetTimestamp(value: unknown, timeZone: string, rowNumber: number): string | null {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  return parseSheetTimestamp(value, timeZone, rowNumber);
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

async function readValues(spreadsheetId: string, accessToken: string) {
  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:Z`,
  );
  valuesUrl.searchParams.set("majorDimension", "ROWS");
  valuesUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");

  const response = await fetch(valuesUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json() as {
    values?: unknown[][];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new GoogleSheetStatusError(
      `Google Sheets read failed${data.error?.message ? `: ${data.error.message}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }
  return data.values ?? [];
}

export async function readGoogleSheetLeads(spreadsheetId: string) {
  const accessToken = await getAccessToken();
  const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  metadataUrl.searchParams.set("fields", "properties.timeZone");

  const headers = { authorization: `Bearer ${accessToken}` };
  const [values, metadataResponse] = await Promise.all([
    readValues(spreadsheetId, accessToken),
    fetch(metadataUrl, { headers }),
  ]);
  const metadata = await metadataResponse.json() as {
    properties?: { timeZone?: string };
    error?: { message?: string };
  };
  if (!metadataResponse.ok) {
    const message = metadata.error?.message;
    throw new GoogleSheetStatusError(
      `Google Sheets read failed${message ? `: ${message}` : ""}`,
      metadataResponse.status === 429 ? 429 : 502,
    );
  }

  const [rawHeaders = [], ...rows] = values;
  const headerIndexes = new Map(rawHeaders.map((header, index) => [String(header ?? "").trim(), index]));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerIndexes.has(header));
  if (missingHeaders.length) {
    throw new Error(`Spreadsheet is missing required headers: ${missingHeaders.join(", ")}`);
  }

  const rawCell = (row: unknown[], header: typeof REQUIRED_HEADERS[number]) =>
    row[headerIndexes.get(header)!];
  const cell = (row: unknown[], header: typeof REQUIRED_HEADERS[number]) =>
    String(rawCell(row, header) ?? "").trim();

  const timeZone = metadata.properties?.timeZone ?? "UTC";
  const leads = rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => String(value ?? "").trim() !== ""))
    .map(({ row, rowNumber }) => ({
      id: cell(row, "🔐 Softr Record ID"),
      name: cell(row, "Caller Name"),
      phone: cell(row, "Phone"),
      issue: cell(row, "Issue"),
      address: cell(row, "Address"),
      urgency: normalizeUrgency(cell(row, "Urgency")),
      status: normalizeStatus(cell(row, "Status")),
      createdAt: parseSheetTimestamp(rawCell(row, "Timestamp"), timeZone, rowNumber),
      contactedAt: parseOptionalSheetTimestamp(rawCell(row, "Contacted At"), timeZone, rowNumber),
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const leadIds = leads.map((lead) => lead.id);
  if (leadIds.some((leadId) => !leadId)) {
    throw new Error("Spreadsheet contains a lead with a blank 🔐 Softr Record ID");
  }
  if (new Set(leadIds).size !== leadIds.length) {
    throw new Error("Spreadsheet contains duplicate 🔐 Softr Record ID values");
  }

  return { leads, timeZone };
}

export async function writeGoogleSheetLeadStatus(
  spreadsheetId: string,
  leadId: string,
  status: LeadStatus,
) {
  const accessToken = await getAccessToken();
  const values = await readValues(spreadsheetId, accessToken);
  const [rawHeaders = [], ...rows] = values;
  const headerIndexes = new Map(rawHeaders.map((header, index) => [String(header ?? "").trim(), index]));
  const requiredWriteHeaders = ["Status", "🔐 Softr Record ID", "Contacted At"] as const;
  const missingHeaders = requiredWriteHeaders.filter((header) => !headerIndexes.has(header));
  if (missingHeaders.length) {
    throw new GoogleSheetStatusError(
      `Spreadsheet is missing required headers: ${missingHeaders.join(", ")}`,
      502,
    );
  }

  const recordIdIndex = headerIndexes.get("🔐 Softr Record ID")!;
  const matchingRows = rows
    .map((row, index) => ({ rowNumber: index + 2, recordId: String(row[recordIdIndex] ?? "").trim() }))
    .filter((row) => row.recordId === leadId);

  if (matchingRows.length === 0) {
    throw new GoogleSheetStatusError("Lead not found in the connected Google Sheet", 404);
  }
  if (matchingRows.length > 1) {
    throw new GoogleSheetStatusError("Lead ID is duplicated in the connected Google Sheet", 409);
  }

  const rowNumber = matchingRows[0].rowNumber;
  const statusColumn = columnName(headerIndexes.get("Status")!);
  const contactedAtColumn = columnName(headerIndexes.get("Contacted At")!);
  const contactedAt = status === "contacted" ? new Date().toISOString() : null;
  const updateUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const response = await fetch(updateUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: [
        {
          range: `${statusColumn}${rowNumber}`,
          values: [[status === "contacted" ? "Contacted" : "Pending"]],
        },
        {
          range: `${contactedAtColumn}${rowNumber}`,
          values: [[contactedAt ?? ""]],
        },
      ],
    }),
  });
  const data = await response.json() as { error?: { message?: string } };
  if (!response.ok) {
    throw new GoogleSheetStatusError(
      `Google Sheets write failed${data.error?.message ? `: ${data.error.message}` : ""}`,
      response.status === 429 ? 429 : 502,
    );
  }

  return { leadId, status, contactedAt };
}
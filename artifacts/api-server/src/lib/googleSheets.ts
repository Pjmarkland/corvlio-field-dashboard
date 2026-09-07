const REQUIRED_HEADERS = [
  "Timestamp",
  "Caller Name",
  "Phone",
  "Issue",
  "Address",
  "Urgency",
  "Status",
] as const;

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

export async function readGoogleSheetLeads(spreadsheetId: string) {
  const accessToken = await getAccessToken();
  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:Z`,
  );
  valuesUrl.searchParams.set("majorDimension", "ROWS");
  valuesUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const timestampsUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:A`,
  );
  timestampsUrl.searchParams.set("majorDimension", "ROWS");
  timestampsUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  metadataUrl.searchParams.set("fields", "properties.timeZone");

  const headers = { authorization: `Bearer ${accessToken}` };
  const [response, timestampsResponse, metadataResponse] = await Promise.all([
    fetch(valuesUrl, { headers }),
    fetch(timestampsUrl, { headers }),
    fetch(metadataUrl, { headers }),
  ]);
  const data = await response.json() as {
    values?: string[][];
    error?: { message?: string };
  };
  const timestampsData = await timestampsResponse.json() as {
    values?: unknown[][];
    error?: { message?: string };
  };
  const metadata = await metadataResponse.json() as {
    properties?: { timeZone?: string };
    error?: { message?: string };
  };
  if (!response.ok || !timestampsResponse.ok || !metadataResponse.ok) {
    const message = data.error?.message ?? timestampsData.error?.message ?? metadata.error?.message;
    throw new Error(`Google Sheets read failed${message ? `: ${message}` : ""}`);
  }

  const [rawHeaders = [], ...rows] = data.values ?? [];
  const headerIndexes = new Map(rawHeaders.map((header, index) => [header.trim(), index]));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerIndexes.has(header));
  if (missingHeaders.length) {
    throw new Error(`Spreadsheet is missing required headers: ${missingHeaders.join(", ")}`);
  }

  const cell = (row: string[], header: typeof REQUIRED_HEADERS[number]) =>
    row[headerIndexes.get(header)!]?.trim() ?? "";

  const timeZone = metadata.properties?.timeZone ?? "UTC";
  const timestampRows = timestampsData.values ?? [];
  const leads = rows
    .map((row, index) => ({ row, rowNumber: index + 2, timestamp: timestampRows[index + 1]?.[0] }))
    .filter(({ row }) => row.some((value) => value.trim() !== ""))
    .map(({ row, rowNumber, timestamp }) => ({
      id: `sheet-row-${rowNumber}`,
      name: cell(row, "Caller Name"),
      phone: cell(row, "Phone"),
      issue: cell(row, "Issue"),
      address: cell(row, "Address"),
      urgency: normalizeUrgency(cell(row, "Urgency")),
      status: normalizeStatus(cell(row, "Status")),
      createdAt: parseSheetTimestamp(timestamp, timeZone, rowNumber),
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return leads;
}
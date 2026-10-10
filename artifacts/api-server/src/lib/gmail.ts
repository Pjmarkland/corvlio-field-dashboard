import { logger } from "./logger";

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function getGmailOAuthConfig():
  | { clientId: string; clientSecret: string; refreshToken: string }
  | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;

  if (!refreshToken) {
    logger.info(
      "Gmail lead email sending is not configured: GMAIL_OAUTH_REFRESH_TOKEN is not set",
    );
    return null;
  }

  if (!clientId || !clientSecret) {
    logger.warn(
      "Gmail lead email sending is not configured: Google OAuth client credentials are not set",
    );
    return null;
  }

  return { clientId, clientSecret, refreshToken };
}

async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const config = getGmailOAuthConfig();
  if (!config) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Google Gmail OAuth refresh failed${data.error ? `: ${data.error}` : ""}`,
    );
  }

  cachedAccessToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizedRecipient(ownerEmail: string | null | undefined): string | null {
  const recipient = ownerEmail?.trim() ?? "";
  if (!recipient || /[\r\n]/.test(recipient)) return null;
  return recipient;
}

/** Reuses the existing OAuth email path; plain text only, no card information. */
export async function sendBillingNotificationEmail(recipientInput: string | null, title: string, body: string): Promise<boolean> {
  const recipient = normalizedRecipient(recipientInput);
  if (!recipient) return false;
  const accessToken = await getAccessToken();
  if (!accessToken) return false;
  const raw = [
    `To: ${recipient}`, "Subject: Corvlio billing notice", "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "", title, "", body,
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    signal: AbortSignal.timeout(15_000), method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: encodeBase64Url(raw) }),
  });
  if (!response.ok) throw new Error(`Billing email delivery failed (${response.status})`);
  return true;
}

export async function sendLeadNotificationEmail(input: {
  ownerEmail: string | null | undefined;
  callerName: string | null;
  phoneNumber: string | null;
  issue: string | null;
}): Promise<boolean> {
  const recipient = normalizedRecipient(input.ownerEmail);
  if (!recipient) {
    logger.info(
      "Skipping Gmail lead notification: business ownerEmail is empty",
    );
    return false;
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return false;

  const messageBody = [
    "A new lead came in.",
    "",
    `Caller name: ${input.callerName || "Not provided"}`,
    `Phone: ${input.phoneNumber || "Not provided"}`,
    `Issue: ${input.issue || "Not provided"}`,
  ].join("\r\n");

  const rawMessage = [
    `To: ${recipient}`,
    "Subject: New lead received",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    messageBody,
  ].join("\r\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: encodeBase64Url(rawMessage) }),
    },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gmail API send failed (${response.status})${errorBody ? `: ${errorBody.slice(0, 300)}` : ""}`,
    );
  }
  return true;
}

export async function sendAdminOperationalFailureEmail(input: {
  source: string;
  summary: string;
  details: string;
  businessId: number | null;
  businessName: string | null;
  occurredAt: string;
}): Promise<boolean> {
  const recipients = [...new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)),
  )];
  if (recipients.length === 0) return false;

  const accessToken = await getAccessToken();
  if (!accessToken) return false;

  const messageBody = [
    "A Corvlio call or lead pipeline failure needs review.",
    "",
    `Source: ${input.source}`,
    `Failure: ${input.summary}`,
    `Business: ${input.businessName || "Unknown"}${input.businessId === null ? "" : ` (ID ${input.businessId})`}`,
    `Details: ${input.details}`,
    `Occurred at: ${input.occurredAt}`,
    "",
    "Review the internal /admin activity page for this failure.",
  ].join("\r\n");
  const rawMessage = [
    `To: ${recipients.join(", ")}`,
    "Subject: Corvlio call pipeline failure",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    messageBody,
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw: encodeBase64Url(rawMessage) }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gmail API admin failure alert failed (${response.status})${errorBody ? `: ${errorBody.slice(0, 300)}` : ""}`,
    );
  }
  return true;
}
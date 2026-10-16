/**
 * APNs (Apple Push Notification service) HTTP/2 adapter.
 *
 * Credentials are read from environment variables:
 *   APNS_KEY       — PEM/p8 private key content (the full .p8 file text)
 *   APNS_KEY_ID    — 10-character Key ID from Apple Developer
 *   APNS_TEAM_ID   — 10-character Team ID from Apple Developer
 *   APNS_BUNDLE_ID — iOS bundle identifier (default: com.corvlio.fielddashboard)
 *   APNS_ENV       — "production" | "sandbox" (default: "sandbox")
 */

import { createSign } from "node:crypto";
import http2 from "node:http2";
import { logger } from "./logger";

const APNS_BUNDLE_ID = process.env["APNS_BUNDLE_ID"] ?? "com.corvlio.fielddashboard";
const APNS_ENV = process.env["APNS_ENV"] ?? "sandbox";
const APNS_HOST =
  APNS_ENV === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";

// APNs tokens are valid for 1 hour; refresh every 50 minutes.
const JWT_LIFETIME_MS = 50 * 60 * 1000;
const APNS_REQUEST_TIMEOUT_MS = 10_000;

let _cachedJwt: { token: string; generatedAt: number } | null = null;
let _apnsSession: http2.ClientHttp2Session | null = null;

// ─── Credentials ──────────────────────────────────────────────────────────────

interface ApnsCredentials {
  key: string;
  keyId: string;
  teamId: string;
}

function getCredentials(): ApnsCredentials | null {
  const key = process.env["APNS_KEY"];
  const keyId = process.env["APNS_KEY_ID"];
  const teamId = process.env["APNS_TEAM_ID"];
  if (!key || !keyId || !teamId) return null;
  return { key, keyId, teamId };
}

/** Returns true when all three APNs secrets are present in the environment. */
export function isApnsConfigured(): boolean {
  return getCredentials() !== null;
}

// ─── JWT ──────────────────────────────────────────────────────────────────────

function buildJwt(key: string, keyId: string, teamId: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat })).toString("base64url");
  const signingInput = `${header}.${payload}`;

  const sign = createSign("SHA256");
  sign.update(signingInput);
  // ieee-p1363 gives raw r||s which is what JWT ES256 requires.
  const signature = sign.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");

  return `${signingInput}.${signature}`;
}

function getJwt(creds: ApnsCredentials): string {
  const now = Date.now();
  if (_cachedJwt && now - _cachedJwt.generatedAt < JWT_LIFETIME_MS) {
    return _cachedJwt.token;
  }
  const token = buildJwt(creds.key, creds.keyId, creds.teamId);
  _cachedJwt = { token, generatedAt: now };
  return token;
}

// ─── HTTP/2 session ───────────────────────────────────────────────────────────

function getSession(): http2.ClientHttp2Session {
  if (_apnsSession && !_apnsSession.destroyed && !_apnsSession.closed) {
    return _apnsSession;
  }
  logger.debug({ host: APNS_HOST }, "Opening APNs HTTP/2 session");
  const session = http2.connect(`https://${APNS_HOST}`);
  session.on("error", (err) => {
    logger.warn({ err: err.message }, "APNs HTTP/2 session error — will reconnect on next send");
    _apnsSession = null;
  });
  session.on("close", () => {
    _apnsSession = null;
  });
  _apnsSession = session;
  return session;
}

/** Tear down the shared HTTP/2 session gracefully (call on server shutdown). */
export function closeApnsSession(): void {
  if (_apnsSession) {
    _apnsSession.close();
    _apnsSession = null;
  }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export type ApnsOutcome =
  | { outcome: "delivered"; apnsId?: string }
  | { outcome: "invalid_token" }
  | { outcome: "error"; statusCode: number; reason?: string };

export async function sendApnsNotification(input: {
  deviceToken: string;
  title: string;
  body: string;
  deepLink: string;
}): Promise<ApnsOutcome> {
  const creds = getCredentials();
  if (!creds) {
    return {
      outcome: "error",
      statusCode: 0,
      reason: "APNs credentials not configured (APNS_KEY / APNS_KEY_ID / APNS_TEAM_ID missing)",
    };
  }

  const jwt = getJwt(creds);
  const session = getSession();

  const apsPayload = JSON.stringify({
    aps: {
      alert: { title: input.title, body: input.body },
      sound: "default",
      badge: 1,
    },
    deepLink: input.deepLink,
  });

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ApnsOutcome) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    let req: http2.ClientHttp2Stream;
    try {
      req = session.request({
        ":method": "POST",
        ":path": `/3/device/${input.deviceToken}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(apsPayload).toString(),
      });
    } catch (err) {
      // Session may have gone away; null it so next call reconnects.
      _apnsSession = null;
      finish({
        outcome: "error",
        statusCode: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let statusCode = 0;
    let apnsId: string | undefined;
    let body = "";
    // Wall-clock deadline, including connection establishment and response body.
    timeout = setTimeout(() => {
      finish({ outcome: "error", statusCode: 0, reason: "APNs request timed out after 10000ms" });
      req.close(http2.constants.NGHTTP2_CANCEL);
    }, APNS_REQUEST_TIMEOUT_MS);
    timeout.unref();

    req.on("response", (headers) => {
      statusCode = Number(headers[":status"]);
      apnsId = headers["apns-id"] as string | undefined;
    });

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (statusCode === 200) {
        finish({ outcome: "delivered", apnsId });
        return;
      }
      if (statusCode === 410) {
        finish({ outcome: "invalid_token" });
        return;
      }
      let reason: string | undefined;
      try {
        const parsed = JSON.parse(body) as { reason?: string };
        reason = parsed.reason;
      } catch {
        reason = body || undefined;
      }
      finish({ outcome: "error", statusCode, reason });
    });

    req.on("error", (err) => {
      _apnsSession = null;
      finish({ outcome: "error", statusCode: 0, reason: err.message });
    });
    req.on("close", () => {
      finish({ outcome: "error", statusCode: 0, reason: "APNs stream closed before response completed" });
    });

    req.write(apsPayload);
    req.end();
  });
}

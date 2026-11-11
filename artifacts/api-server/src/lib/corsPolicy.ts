import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

const CAPACITOR_ORIGINS = new Set([
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
]);

const ADDITIONAL_APP_ORIGINS = new Set([
  "https://app.corvlio.com",
]);

function configuredAppOrigin(env: Record<string, string | undefined>): string | null {
  const configuredBaseUrl = env.PUBLIC_API_BASE_URL?.trim() || env.VITE_NATIVE_API_BASE_URL?.trim();
  if (!configuredBaseUrl) return null;

  try {
    const url = new URL(configuredBaseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedCorsOrigin(
  origin: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (CAPACITOR_ORIGINS.has(origin) || ADDITIONAL_APP_ORIGINS.has(origin)) return true;
  return configuredAppOrigin(env) === origin;
}

export const corsOptions: CorsOptions = {
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Native-Clerk-Client"],
  origin(origin, callback) {
    callback(null, Boolean(origin && isAllowedCorsOrigin(origin)));
  },
};

function isSameOriginRequest(origin: string, protocol: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

function isPublicWebhookPath(path: string): boolean {
  return path === "/api/billing/webhook"
    || path === "/api/webhooks/clerk"
    || path === "/api/webhooks/retell/pre-call"
    || path === "/api/webhooks/retell/post-call";
}

export const rejectUnexpectedOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get("Origin");
  if (
    !origin
    || isAllowedCorsOrigin(origin)
    || isSameOriginRequest(origin, req.protocol, req.get("host"))
    || isPublicWebhookPath(req.path)
  ) {
    next();
    return;
  }
  res.status(403).json({ error: "Origin not allowed" });
};

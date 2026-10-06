/** Production calls require an explicit opt-in. Never infer it from client state. */
export function ownerDemoCallingEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    || process.env.ENABLE_PRODUCTION_OWNER_DEMO_CALLS === "true";
}

export function ownerDemoWebhookUrl(): string | null {
  if (process.env.NODE_ENV !== "production") {
    const domain = process.env.REPLIT_DEV_DOMAIN;
    return domain ? `https://${domain}/api/webhooks/retell/post-call` : null;
  }
  // Production tests must not send their results to a development app.
  const base = process.env.PUBLIC_API_BASE_URL?.trim();
  if (!base) return null;
  try {
    const url = new URL(`${base.replace(/\/+$/, "")}/api/webhooks/retell/post-call`);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

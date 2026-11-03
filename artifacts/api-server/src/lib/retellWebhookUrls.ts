export type AdminRetellWebhookUrls = {
  configured: boolean;
  preCallWebhookUrl: string | null;
  postCallWebhookUrl: string | null;
};

export function getAdminRetellWebhookUrls(
  env: Record<string, string | undefined> = process.env,
): AdminRetellWebhookUrls {
  const configuredBase = env.PUBLIC_API_BASE_URL?.trim()
    || env.VITE_NATIVE_API_BASE_URL?.trim();
  if (!configuredBase) {
    return { configured: false, preCallWebhookUrl: null, postCallWebhookUrl: null };
  }

  try {
    const base = new URL(configuredBase);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      return { configured: false, preCallWebhookUrl: null, postCallWebhookUrl: null };
    }
    return {
      configured: true,
      preCallWebhookUrl: new URL("/api/webhooks/retell/pre-call", base.origin).href,
      postCallWebhookUrl: new URL("/api/webhooks/retell/post-call", base.origin).href,
    };
  } catch {
    return { configured: false, preCallWebhookUrl: null, postCallWebhookUrl: null };
  }
}

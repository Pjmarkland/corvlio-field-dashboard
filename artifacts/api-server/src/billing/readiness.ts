import { billingGate, isConfiguredReplitHost, publicApiBase } from "./policy";

function stripeKeyMode(key: string | undefined): "live" | "test" | "unknown" | "missing" {
  if (!key) return "missing";
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return "unknown";
}

function webhookUrl(base: URL): URL {
  const prefix = base.pathname.replace(/\/+$/, "");
  const apiPath = prefix.endsWith("/api") ? prefix : `${prefix}/api`;
  return new URL(`${apiPath}/billing/webhook`, base.origin);
}

export async function checkBillingReadiness(env: NodeJS.ProcessEnv = process.env) {
  const base = publicApiBase(env);
  const gate = billingGate(env);
  const endpoint = base ? webhookUrl(base) : null;
  const probeAllowed = Boolean(base && endpoint && isConfiguredReplitHost(base, env));
  let webhookReachable: boolean | null = null;

  if (probeAllowed && endpoint) {
    try {
      // An unsigned request is rejected before signature verification or Stripe access.
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      webhookReachable = response.status === 401;
    } catch {
      webhookReachable = false;
    }
  }

  return {
    enabled: gate.enabled,
    mode: gate.mode,
    reason: gate.reason,
    liveModeOptIn: env.STRIPE_LIVE_MODE_ENABLED === "true",
    runningInProduction: env.NODE_ENV === "production",
    secretKeyPresent: Boolean(env.STRIPE_SECRET_KEY),
    secretKeyMode: stripeKeyMode(env.STRIPE_SECRET_KEY),
    webhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET),
    webhookSecretValid: Boolean(env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")),
    publicApiBaseValid: Boolean(base),
    webhookUrl: endpoint?.toString() ?? null,
    webhookReachable,
  };
}

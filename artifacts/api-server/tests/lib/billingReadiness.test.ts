import { afterEach, describe, expect, it, vi } from "vitest";
import { checkBillingReadiness } from "../../src/billing/readiness";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin Stripe readiness probe", () => {
  it("reports live readiness without returning secret values and probes the configured Replit endpoint", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_LIVE_MODE_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_sensitive_test_value");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_sensitive_test_value");
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://billing.example.test/api");
    vi.stubEnv("REPLIT_DOMAINS", "billing.example.test");
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkBillingReadiness();
    expect(result).toMatchObject({ enabled: true, mode: "live", secretKeyPresent: true,
      secretKeyMode: "live", webhookSecretValid: true, webhookReachable: true });
    expect(result.webhookUrl).toBe("https://billing.example.test/api/billing/webhook");
    expect(JSON.stringify(result)).not.toContain("sensitive_test_value");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect((fetchMock.mock.calls[0]?.[0] as URL).hostname).toBe("billing.example.test");
  });

  it("does not probe a host outside configured Replit domains", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_LIVE_MODE_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_dummy");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_dummy");
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://not-configured.example/api");
    vi.stubEnv("REPLIT_DOMAINS", "billing.example.test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkBillingReadiness();
    expect(result.webhookReachable).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

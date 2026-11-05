import { afterEach, describe, expect, it, vi } from "vitest";
import { checkBillingReadiness } from "../../src/billing/readiness";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin Stripe readiness probe", () => {
  it.each([
    ["sk_live_sensitive_test_value", "live"],
    ["rk_live_sensitive_test_value", "live_restricted"],
  ])("reports live readiness for key type %s without returning secret values", async (secretKey, secretKeyMode) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_LIVE_MODE_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", secretKey);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_sensitive_test_value");
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://billing.example.test/api");
    vi.stubEnv("REPLIT_DOMAINS", "billing.example.test");
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkBillingReadiness();
    expect(result).toMatchObject({ enabled: true, mode: "live", secretKeyPresent: true,
      secretKeyMode, webhookSecretValid: true, webhookReachable: true });
    expect(result.webhookUrl).toBe("https://billing.example.test/api/billing/webhook");
    expect(JSON.stringify(result)).not.toContain("sensitive_test_value");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect((fetchMock.mock.calls[0]?.[0] as URL).hostname).toBe("billing.example.test");
  });

  it("recognizes restricted test keys in test mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_LIVE_MODE_ENABLED", "false");
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_sensitive_test_value");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_value");
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://billing.example.test/api");

    const result = await checkBillingReadiness();
    expect(result).toMatchObject({
      enabled: true,
      mode: "test",
      secretKeyMode: "test_restricted",
      webhookSecretValid: true,
      webhookReachable: null,
    });
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

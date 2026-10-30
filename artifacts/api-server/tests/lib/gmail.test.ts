import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("../../src/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));
const lead = { ownerEmail: "owner@example.test", callerName: "Sam", phoneNumber: "+15550000001", issue: "Leak" };
const token = () => new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }), { status: 200 });
const disabled = () => new Response(JSON.stringify({ error: {
  message: "Gmail API has not been used in project 1028015564678 before or it is disabled.",
  details: [{ reason: "SERVICE_DISABLED", metadata: { consumer: "projects/1028015564678" } }],
} }), { status: 403 });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("GMAIL_OAUTH_REFRESH_TOKEN", "test-refresh-token");
  vi.stubEnv("ADMIN_EMAILS", "admin@example.test");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Gmail lead transport", () => {
  it("sends the owner alert using the existing OAuth path and encoded lead details", async () => {
    mocks.fetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { sendLeadNotificationEmail } = await import("../../src/lib/gmail");
    expect(await sendLeadNotificationEmail(lead)).toBe(true);
    const [url, request] = mocks.fetch.mock.calls[1];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const message = Buffer.from(JSON.parse(request.body).raw, "base64url").toString("utf8");
    expect(message).toContain("To: owner@example.test");
    expect(message).toContain("Caller name: Sam");
    expect(message).toContain("Phone: +15550000001");
    expect(message).toContain("Issue: Leak");
  });
  it("reports the disabled API and exact project without truncating the remediation", async () => {
    mocks.fetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(disabled());
    const { sendLeadNotificationEmail } = await import("../../src/lib/gmail");
    await expect(sendLeadNotificationEmail(lead)).rejects.toThrow(
      "Gmail API lead email failed (403): Gmail API is not enabled for Google Cloud project 1028015564678. Enable gmail.googleapis.com",
    );
  });
  it("gives the same actionable diagnosis for the admin operational-failure alert", async () => {
    mocks.fetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(disabled());
    const { sendAdminOperationalFailureEmail } = await import("../../src/lib/gmail");
    await expect(sendAdminOperationalFailureEmail({
      source: "lead_gmail_notification", summary: "Delivery failed", details: "Test",
      businessId: 7, businessName: "Example", occurredAt: "2026-10-11T00:00:00Z",
    })).rejects.toThrow("Gmail API admin failure alert failed (403): Gmail API is not enabled for Google Cloud project 1028015564678");
  });
  it("discards a rejected cached token so the queued retry refreshes it", async () => {
    mocks.fetch.mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { sendLeadNotificationEmail } = await import("../../src/lib/gmail");
    await expect(sendLeadNotificationEmail(lead)).rejects.toThrow("Cached access token discarded");
    expect(await sendLeadNotificationEmail(lead)).toBe(true);
    expect(mocks.fetch.mock.calls.map(args => args[0])).toEqual([
      "https://oauth2.googleapis.com/token", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "https://oauth2.googleapis.com/token", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    ]);
  });
  it("does not include an unparsed provider body or credentials in failures", async () => {
    mocks.fetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response("test-access-token private body", { status: 503 }));
    const { sendLeadNotificationEmail } = await import("../../src/lib/gmail");
    await expect(sendLeadNotificationEmail(lead)).rejects.toThrow(
      "Gmail API lead email failed (503): Delivery failed; the persisted outbox will retry.",
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), update: vi.fn(), insert: vi.fn(), select: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: m, businessesTable: { id: "id", clerkUserId: "user" }, ownerDemoCallsTable: { id: "id", businessId: "business", createdAt: "created" },
}));
import { placeOwnerDemoCall, validateDemoConfirmation } from "../../src/lib/ownerDemoCall";
import type { Business } from "@workspace/db";
const business = {
  id: 7, clerkUserId: "owner", businessName: "Test Plumbing", ownerPhone: "+15551230001",
  retellPhoneNumber: "+15551230002", isSample: false, timeZone: "America/New_York", businessHours: "Mon-Fri 09:00-17:00",
} as Business;
let used = 0;
let current: Business;
let calls: { url: string; options: RequestInit }[];
beforeEach(() => {
  vi.clearAllMocks();
  current = business; used = 0; calls = [];
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEV_DOMAIN", "development.example");
  vi.stubEnv("RETELL_SHARED_AGENT_ID", "draft-agent"); vi.stubEnv("RETELL_API_KEY", "test-placeholder");
  m.select.mockImplementation(() => ({ from: () => ({ where: () => ({ for: async () => [current], then: (fn: (x: unknown) => unknown) => Promise.resolve([{ used }]).then(fn) }) }) }));
  m.insert.mockImplementation(() => ({ values: async () => { used++; } }));
  m.update.mockImplementation(() => ({ set: () => ({ where: async () => {} }) }));
  m.transaction.mockImplementation(async fn => fn({ ...m, execute: async () => {} }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    const result = url.includes("get-phone-number") ? { phone_number_type: "retell-twilio" }
      : url.includes("list-agent") ? { items: [{ version: 0, is_published: true }, { version: 1, is_published: false }], has_more: false }
      : url.includes("get-agent") ? { is_published: false, response_engine: { type: "retell-llm", llm_id: "draft-llm", version: 1 } }
      : url.includes("get-retell") ? { is_published: false } : { call_id: "demo-call" };
    return new Response(JSON.stringify(result), { status: 200 });
  }));
});
describe("owner-only development demo calls", () => {
  it.each([
    [null, true], ["+15559990000", true], [business.ownerPhone, false],
  ])("rejects unconfirmed or different destinations before contacting Retell", (number, confirmed) => {
    expect(() => validateDemoConfirmation(business, number as string, confirmed)).toThrow("Confirm");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never provisions a missing number or calls a sample business", async () => {
    for (const b of [{ ...business, retellPhoneNumber: null }, { ...business, isSample: true }]) {
      await expect(placeOwnerDemoCall(b, business.ownerPhone!, true)).rejects.toThrow("No number will be purchased");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(placeOwnerDemoCall(business, business.ownerPhone!, true)).rejects.toThrow("development");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses only the existing business number, confirmed owner, unpublished versions and development webhook", async () => {
    expect(await placeOwnerDemoCall(business, business.ownerPhone!, true, "after_hours")).toMatchObject({ callId: "demo-call" });
    const writes = calls.filter(c => c.options.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe("https://api.retellai.com/v2/create-phone-call");
    expect(JSON.parse(writes[0].options.body as string)).toMatchObject({
      from_number: business.retellPhoneNumber, to_number: business.ownerPhone, override_agent_version: 1,
      metadata: { corvlio_call_type: "owner_test" },
      agent_override: { agent: { max_call_duration_ms: 300000, webhook_url: "https://development.example/api/webhooks/retell/post-call" } },
      retell_llm_dynamic_variables: { business_is_open: "false", transfer_available: "false", business_name: "Test Plumbing" },
    });
  });
  it("reserves at most three attempts and rejects the fourth without dialing", async () => {
    for (let i = 0; i < 3; i++) await placeOwnerDemoCall(business, business.ownerPhone!, true);
    await expect(placeOwnerDemoCall(business, business.ownerPhone!, true)).rejects.toMatchObject({ status: 429 });
    expect(calls.filter(c => c.options.method === "POST")).toHaveLength(3);
  });
  it("reads every version page before selecting the newest unpublished draft", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    const listUrls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (!String(url).includes("list-agent-versions")) return original(url, options);
      listUrls.push(String(url));
      const cursor = new URL(String(url)).searchParams.get("pagination_key");
      const page = cursor === null
        ? { items: [{ version: 0, is_published: true }], has_more: true, pagination_key: "next /+?& page" }
        : { items: [{ version: 4, is_published: false }], has_more: false };
      return new Response(JSON.stringify(page), { status: 200 });
    });
    await placeOwnerDemoCall(business, business.ownerPhone!, true);
    expect(listUrls).toHaveLength(2);
    expect(new URL(listUrls[1]).searchParams.get("pagination_key")).toBe("next /+?& page");
    const write = calls.find(c => c.options.method === "POST")!;
    expect(JSON.parse(write.options.body as string).override_agent_version).toBe(4);
  });
  it("does not reserve an attempt or dial if a later list page fails", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (!String(url).includes("list-agent-versions")) return original(url, options);
      const cursor = new URL(String(url)).searchParams.get("pagination_key");
      return cursor === null
        ? new Response(JSON.stringify({ items: [{ version: 1, is_published: false }], has_more: true, pagination_key: "next" }))
        : new Response("Unavailable", { status: 503 });
    });
    await expect(placeOwnerDemoCall(business, business.ownerPhone!, true)).rejects.toMatchObject({ status: 502 });
    expect(used).toBe(0);
    expect(calls.some(c => c.options.method === "POST")).toBe(false);
  });
  it("rechecks saved numbers inside the rate-limit lock", async () => {
    current = { ...business, ownerPhone: "+15559990000" };
    await expect(placeOwnerDemoCall(business, business.ownerPhone!, true)).rejects.toThrow("changed");
    expect(calls.some(c => c.options.method === "POST")).toBe(false);
  });
  it("does not retry ambiguous provider failures and consumes the reserved attempt", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (String(url).includes("create-phone-call")) throw new Error("Timeout");
      return original(url, options);
    });
    await expect(placeOwnerDemoCall(business, business.ownerPhone!, true)).rejects.toThrow("don't retry");
    expect(used).toBe(1);
  });
});
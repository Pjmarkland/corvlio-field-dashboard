import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TARGET_EMAIL } from "../../src/lib/appReviewOwnerDemoData.mjs";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  info: vi.fn(),
  fetch: vi.fn(),
}));

// Exercise the installed SDK's real serialization/deserialization, but with
// exclusively fictional credentials and an intercepted transport.
vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkClient: actual.createClerkClient({
      secretKey: "sk_test_review_fixture",
      apiUrl: "https://clerk-review.example.test",
    }),
  };
});
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));
vi.mock("../../src/lib/logger", () => ({ logger: { info: mocks.info } }));

const userId = "user_review";
const business = { id: 31, clerkUserId: userId, isInternal: false };
let bypass: unknown;
let email: string;
let verified: string;
let updateStatus: number;
let confirmed: boolean;
let calls: { url: string; method: string; body: unknown }[];

function user(flag: unknown) {
  return {
    object: "user",
    id: userId,
    email_addresses: [{
      object: "email_address", id: "idn_review", email_address: email, verification: { status: verified },
      linked_to: [],
    }],
    phone_numbers: [], web3_wallets: [], external_accounts: [], enterprise_accounts: [],
    bypass_client_trust: flag,
    public_metadata: {}, private_metadata: {}, unsafe_metadata: {},
  };
}

async function request() {
  const { maybeSeedAppReviewOwnerDemo } = await import("../../src/lib/appReviewOwnerDemo");
  return maybeSeedAppReviewOwnerDemo(userId, business);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  bypass = false;
  email = TARGET_EMAIL.toUpperCase();
  verified = "verified";
  updateStatus = 200;
  confirmed = true;
  calls = [];
  mocks.connect.mockResolvedValue({
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("SELECT id, clerk_user_id")
        ? [{ id: 31, clerk_user_id: userId, is_internal: false }]
        : sql.includes("SELECT id FROM leads WHERE business_id") ? [{ id: 99 }] : [],
    })),
    release: vi.fn(),
  });
  mocks.fetch.mockImplementation(async (input: string | URL, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({
      url: input.toString(), method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(
      method === "PATCH" && updateStatus !== 200
        ? { errors: [{ message: "private provider detail", code: "fixture_error" }] }
        : user(method === "PATCH" ? confirmed : bypass),
    ), { status: method === "PATCH" ? updateStatus : 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("review exemption through the deployed Clerk adapter", () => {
  it("sends exactly one PATCH with only bypass_client_trust and emits one personal-data-free success line", async () => {
    expect(await request()).toBe("skipped");
    expect(await request()).toBe("skipped");
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([{
      url: `https://clerk-review.example.test/v1/users/${userId}`,
      method: "PATCH",
      body: { bypass_client_trust: true },
    }]);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { event: "app_review_owner_client_trust_bypass", outcome: "enabled" },
      "App Review device verification exemption",
    );
    const logged = JSON.stringify(mocks.info.mock.calls);
    expect(logged).not.toContain(userId);
    expect(logged).not.toContain(TARGET_EMAIL);
  });

  it.each([true, undefined, null, "false", 0])("never PATCHes an already enabled or malformed raw flag (%s)", async (flag) => {
    bypass = flag;
    expect(await request()).toBe("skipped");
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it.each([
    ["other@example.test", "verified"],
    ["pjmarkland08@gmail.com", "verified"],
    [TARGET_EMAIL, "unverified"],
  ])("never PATCHes an ineligible identity (%s, %s)", async (address, status) => {
    email = address;
    verified = status;
    expect(await request()).toBe("skipped");
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("silently ignores a rejected PATCH without retrying on later requests", async () => {
    updateStatus = 403;
    expect(await request()).toBe("skipped");
    expect(await request()).toBe("skipped");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("does not log success unless Clerk confirms the flag was enabled", async () => {
    confirmed = false;
    expect(await request()).toBe("skipped");
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

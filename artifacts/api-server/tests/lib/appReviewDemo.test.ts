import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  getUserList: vi.fn(),
  businesses: [] as Record<string, unknown>[],
  activity: {
    has_calls: false,
    has_provisioning_attempt: false,
    has_notifications: false,
    has_billing_account: false,
    has_billing_event: false,
    has_billing_notice: false,
    has_invoice: false,
  },
  leads: [] as { retell_call_id: string | null }[],
  otherOwners: [] as Record<string, unknown>[],
  insertedLeads: [] as unknown[][],
  statements: [] as { sql: string; values: unknown[] }[],
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mocks.poolQuery, connect: mocks.connect },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUserList: mocks.getUserList } },
}));

import {
  APP_REVIEW_DEMO_NAME,
  AppReviewDemoError,
  getAppReviewDemoStatus,
  linkAppReviewDemoEmail,
  resetAppReviewDemo,
} from "../../src/lib/appReviewDemo";

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: 52,
    business_name: APP_REVIEW_DEMO_NAME,
    owner_email: null,
    clerk_user_id: null,
    is_sample: true,
    is_internal: false,
    retell_phone_number: null,
    retell_agent_id: null,
    chosen_plan: null,
    manual_payment_state: null,
    first_invoice_paid_at: null,
    ...overrides,
  };
}

function setupClient() {
  mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    mocks.statements.push({ sql, values });
    if (sql.includes("WHERE business_name = $1") && sql.includes("FOR UPDATE")) {
      return { rows: mocks.businesses };
    }
    if (sql.includes("AS has_calls")) return { rows: [mocks.activity] };
    if (sql.includes("SELECT retell_call_id")) return { rows: mocks.leads };
    if (sql.includes("WHERE clerk_user_id = $1 AND id <> $2")) return { rows: mocks.otherOwners };
    if (sql.includes("SET clerk_user_id = $2")) return { rows: [] };
    if (sql.includes("SELECT count(*)::int AS count")) return { rows: [{ count: mocks.leads.length }] };
    if (sql.startsWith("INSERT INTO businesses")) return { rows: [business()] };
    if (sql.startsWith("UPDATE businesses")) return { rows: [mocks.businesses[0] ?? business()] };
    if (sql.startsWith("INSERT INTO leads")) {
      mocks.insertedLeads.push(values);
      return { rows: [] };
    }
    return { rows: [] };
  });
  mocks.connect.mockResolvedValue({
    query: mocks.clientQuery,
    release: mocks.release,
  });
}

describe("App Review demo", () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.connect.mockReset();
    mocks.clientQuery.mockReset();
    mocks.release.mockReset();
    mocks.getUserList.mockReset().mockResolvedValue({ data: [] });
    mocks.businesses = [];
    mocks.activity = {
      has_calls: false,
      has_provisioning_attempt: false,
      has_notifications: false,
      has_billing_account: false,
      has_billing_event: false,
      has_billing_notice: false,
      has_invoice: false,
    };
    mocks.leads = [];
    mocks.otherOwners = [];
    mocks.insertedLeads = [];
    mocks.statements = [];
    setupClient();
  });

  it("reports an uncreated demo without creating records", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    await expect(getAppReviewDemoStatus()).resolves.toEqual({
      exists: false,
      businessId: null,
      businessName: null,
      ownerEmail: null,
      linked: false,
      leadCount: 0,
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("creates exactly eight tagged fictional leads without contacting Clerk or provisioning", async () => {
    const result = await resetAppReviewDemo();
    expect(result).toMatchObject({
      exists: true,
      businessId: 52,
      businessName: APP_REVIEW_DEMO_NAME,
      linked: false,
      leadCount: 8,
    });
    expect(mocks.insertedLeads).toHaveLength(8);
    expect(mocks.insertedLeads.map((values) => values[2])).toEqual([
      "corvlio-app-review-demo-seed-001",
      "corvlio-app-review-demo-seed-002",
      "corvlio-app-review-demo-seed-003",
      "corvlio-app-review-demo-seed-004",
      "corvlio-app-review-demo-seed-005",
      "corvlio-app-review-demo-seed-006",
      "corvlio-app-review-demo-seed-007",
      "corvlio-app-review-demo-seed-008",
    ]);
    expect(mocks.statements.some(({ sql }) => sql.startsWith("DELETE FROM leads"))).toBe(true);
    expect(mocks.statements.some(({ sql }) => sql === "COMMIT")).toBe(true);
    expect(mocks.getUserList).not.toHaveBeenCalled();
  });

  it("refuses to reset a real business with the reserved demo name", async () => {
    mocks.businesses = [business({ is_sample: false, clerk_user_id: "real-owner" })];
    await expect(resetAppReviewDemo()).rejects.toBeInstanceOf(AppReviewDemoError);
    expect(mocks.statements.some(({ sql }) => sql.startsWith("INSERT INTO businesses"))).toBe(false);
    expect(mocks.statements.some(({ sql }) => sql.startsWith("DELETE FROM leads"))).toBe(false);
    expect(mocks.statements.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
  });

  it("can reset the same linked sample again while preserving its reviewer and deleting only tagged leads", async () => {
    mocks.businesses = [business({
      clerk_user_id: "user_reviewer",
      owner_email: "reviewer@example.test",
    })];
    mocks.leads = Array.from({ length: 8 }, (_, index) => ({
      retell_call_id: `corvlio-app-review-demo-seed-${String(index + 1).padStart(3, "0")}`,
    }));
    const result = await resetAppReviewDemo();
    const deleteCall = mocks.statements.find(({ sql }) => sql.startsWith("DELETE FROM leads"));
    expect(result).toMatchObject({
      exists: true,
      businessId: 52,
      ownerEmail: "reviewer@example.test",
      linked: true,
      leadCount: 8,
    });
    expect(deleteCall?.values).toEqual([52, "corvlio-app-review-demo-seed-%"]);
    expect(mocks.insertedLeads).toHaveLength(8);
  });

  it("refuses to reset a sample containing any non-demo lead", async () => {
    mocks.businesses = [business()];
    mocks.leads = [{ retell_call_id: "real-provider-call" }];
    await expect(resetAppReviewDemo()).rejects.toBeInstanceOf(AppReviewDemoError);
    expect(mocks.statements.some(({ sql }) => sql.startsWith("DELETE FROM leads"))).toBe(false);
  });

  it("links only an existing verified Clerk email and preserves the lead set", async () => {
    mocks.businesses = [business()];
    mocks.leads = [{ retell_call_id: "corvlio-app-review-demo-seed-001" }];
    mocks.getUserList.mockResolvedValue({
      data: [{
        id: "user_reviewer",
        emailAddresses: [{
          emailAddress: "reviewer@example.test",
          verification: { status: "verified" },
        }],
      }],
    });
    const result = await linkAppReviewDemoEmail(" REVIEWER@example.test ");
    expect(result).toMatchObject({
      exists: true,
      businessId: 52,
      ownerEmail: "reviewer@example.test",
      linked: true,
      leadCount: 1,
    });
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET clerk_user_id = $2"),
      [52, "user_reviewer", "reviewer@example.test"],
    );
    expect(mocks.statements.some(({ sql }) => sql.startsWith("DELETE FROM leads"))).toBe(false);
  });

  it("refuses to link a Clerk account already assigned to another business", async () => {
    mocks.businesses = [business()];
    mocks.getUserList.mockResolvedValue({
      data: [{
        id: "user_reviewer",
        emailAddresses: [{
          emailAddress: "reviewer@example.test",
          verification: { status: "verified" },
        }],
      }],
    });
    mocks.otherOwners = [{ id: 3, business_name: "Existing customer" }];
    await expect(linkAppReviewDemoEmail("reviewer@example.test")).rejects.toThrow(
      "This account already owns another business",
    );
    expect(mocks.statements.some(({ sql }) => sql.includes("SET clerk_user_id = $2"))).toBe(false);
  });

  it("does not silently replace an account already linked to the demo", async () => {
    mocks.businesses = [business({
      clerk_user_id: "previous_reviewer",
      owner_email: "previous@example.test",
    })];
    mocks.getUserList.mockResolvedValue({
      data: [{
        id: "user_reviewer",
        emailAddresses: [{
          emailAddress: "reviewer@example.test",
          verification: { status: "verified" },
        }],
      }],
    });
    await expect(linkAppReviewDemoEmail("reviewer@example.test")).rejects.toThrow(
      "App Review Demo is already linked to another account",
    );
    expect(mocks.statements.some(({ sql }) => sql.includes("SET clerk_user_id = $2"))).toBe(false);
  });
});

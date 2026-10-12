import { describe, expect, it, vi } from "vitest";
vi.mock("@clerk/express", () => ({ clerkClient: { users: { deleteUser: vi.fn() } } }));
vi.mock("@workspace/db", () => ({ pool: {} }));
import { deleteAccount, paidDeletionBlocked, type DeletionDependencies } from "../../src/lib/accountDeletion";

function fixture() {
  const state = { job: null as string | null, business: { id: 7, clerk_user_id: "user_owner",
    business_name: "Demo repair", retell_phone_number: "+12395550101", retell_agent_id: "agent_shared", provisioning_state: "ready" },
    billing: [] as any[], attempts: [] as any[], deleted: false, resources: [] as any[] };
  const calls: { sql: string; args: any[] }[] = [];
  let snapshot: any;
  let fail = false;
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    calls.push({ sql, args });
    if (sql === "BEGIN") snapshot = structuredClone(state);
    if (sql === "ROLLBACK") Object.assign(state, snapshot);
    if (sql.startsWith("SELECT status FROM account_deletions")) return { rows: state.job ? [{ status: state.job }] : [] };
    if (sql.startsWith("SELECT id FROM businesses")) return { rows: state.deleted ? [] : [{ id: 7 }] };
    if (sql.startsWith("SELECT * FROM businesses")) return { rows: state.deleted ? [] : [state.business] };
    if (sql.startsWith("SELECT * FROM billing_accounts")) return { rows: state.billing };
    if (sql.startsWith("SELECT * FROM provisioning_attempts")) return { rows: state.attempts };
    if (sql.startsWith("INSERT INTO pending_retell_releases")) state.resources.push(args);
    if (sql.startsWith("INSERT INTO account_deletions")) state.job = "pending";
    if (sql.startsWith("DELETE FROM leads") && fail) throw new Error("Simulated database failure");
    if (sql.startsWith("DELETE FROM businesses")) state.deleted = true;
    if (sql.startsWith("UPDATE account_deletions SET status")) state.job = "completed";
    if (sql.startsWith("UPDATE account_deletions SET attempts")) return { rows: state.job === "pending" ? [{ status: "pending" }] : [] };
    return { rows: [] };
  });
  const release = vi.fn();
  const deleteUser = vi.fn().mockResolvedValue({});
  const deps: DeletionDependencies = { pool: { query, connect: async () => ({ query, release }) }, deleteUser };
  return { state, calls, deps, deleteUser, fail: () => { fail = true; } };
}
describe("account deletion safety", () => {
  it("commits owned cleanup before calling Clerk, preserves resources and is idempotent", async () => {
    const f = fixture();
    f.deleteUser.mockImplementation(async id => {
      expect(id).toBe("user_owner");
      expect(f.state.deleted).toBe(true);
      expect(f.calls.at(-2)?.sql).toBe("COMMIT");
    });
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.state.resources).toEqual([["business:7", 7, "Demo repair", "+12395550101", "agent_shared", "ready"]]);
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.deleteUser).toHaveBeenCalledOnce();
    expect(f.calls.filter(c => c.sql.startsWith("DELETE FROM businesses"))).toHaveLength(1);
  });
  it.each(["active", "past_due", "suspended", "unpaid"])("refuses %s subscriptions before any deletion or Clerk call", async status => {
    const f = fixture(); f.state.billing = [{ state: { status, plan: "starter" } }];
    await expect(deleteAccount("user_owner", f.deps)).rejects.toThrow("Contact hello@corvlio.com");
    expect(f.calls.some(c => c.sql.startsWith("DELETE"))).toBe(false);
    expect(f.deleteUser).not.toHaveBeenCalled();
    expect(f.state.resources).toEqual([]);
  });
  it("checks pending checkout and uncertain subscription state, allows canceled accounts", () => {
    expect(paidDeletionBlocked({ state: { status: "not_subscribed", pendingCheckout: { id: "cs_mock" } } })).toBe(true);
    expect(paidDeletionBlocked({ state: { status: "unknown" }, stripe_subscription_id: "sub_mock" })).toBe(true);
    expect(paidDeletionBlocked({ state: { status: "canceled", plan: "starter" } })).toBe(false);
    expect(paidDeletionBlocked({ state: { status: "not_subscribed" } })).toBe(false);
  });
  it("keeps a durable pending job on Clerk failure; retry does not repeat database deletion", async () => {
    const f = fixture(); f.deleteUser.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect(await deleteAccount("user_owner", f.deps)).toBe("pending");
    expect(f.state.deleted).toBe(true);
    expect(f.state.job).toBe("pending");
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.calls.filter(c => c.sql.startsWith("DELETE FROM leads"))).toHaveLength(1);
  });
  it("treats a missing Clerk user as already deleted", async () => {
    const f = fixture(); f.deleteUser.mockRejectedValue({ status: 404 });
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
  });
  it("rolls back all local cleanup and resource snapshots on SQL failure, without calling Clerk", async () => {
    const f = fixture(); f.fail();
    await expect(deleteAccount("user_owner", f.deps)).rejects.toThrow("Simulated");
    expect(f.state.job).toBeNull(); expect(f.state.deleted).toBe(false); expect(f.state.resources).toEqual([]);
    expect(f.deleteUser).not.toHaveBeenCalled();
  });
  it("only deletes records scoped to the authenticated owner or their business IDs", async () => {
    const f = fixture(); await deleteAccount("user_owner", f.deps);
    for (const call of f.calls.filter(c => c.sql.startsWith("DELETE"))) {
      expect(call.sql).toContain("WHERE");
      if (call.sql.includes("clerk_user_id")) expect(call.args[0]).toBe("user_owner");
      else expect(call.args[0]).toEqual(expect.arrayContaining([call.sql.includes("text[]") ? "7" : 7]));
      expect(JSON.stringify(call.args)).not.toContain("user_other");
    }
  });
  it("retains uncertain phone purchases, but refuses a provisioning record belonging to another business", async () => {
    const f = fixture(); f.state.attempts = [{ id: 8, clerk_user_id: "user_owner", business_id: 7, purchased_number: null, status: "reserved" }];
    await deleteAccount("user_owner", f.deps);
    expect(f.state.resources).toHaveLength(2);
    const other = fixture(); other.state.attempts = [{ id: 9, clerk_user_id: "user_owner", business_id: 99, purchased_number: "+12395550109", status: "purchased" }];
    await expect(deleteAccount("user_owner", other.deps)).rejects.toThrow("Ownership conflict");
    expect(other.deleteUser).not.toHaveBeenCalled();
    const otherActor = fixture(); otherActor.state.attempts = [{ id: 10, clerk_user_id: "user_other", business_id: 7, purchased_number: "+12395550101", status: "purchased" }];
    await expect(deleteAccount("user_owner", otherActor.deps)).rejects.toThrow("ownership conflict");
    expect(otherActor.deleteUser).not.toHaveBeenCalled();
    expect(otherActor.state.resources).toEqual([]);
  });
  it("signed user.deleted cleanup does not call Clerk again", async () => {
    const f = fixture(); expect(await deleteAccount("user_owner", f.deps, true)).toBe("completed");
    expect(f.deleteUser).not.toHaveBeenCalled();
  });
  it("deletes a Clerk identity that has not completed business onboarding", async () => {
    const f = fixture(); f.state.deleted = true;
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.deleteUser).toHaveBeenCalledWith("user_owner");
    expect(f.state.resources).toEqual([]);
  });
});

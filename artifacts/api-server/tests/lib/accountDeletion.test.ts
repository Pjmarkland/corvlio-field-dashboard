import { describe, expect, it, vi } from "vitest";
vi.mock("@clerk/express", () => ({ clerkClient: { users: { deleteUser: vi.fn() } } }));
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("../../src/lib/notificationService", () => ({ runNotificationOutboxNow: vi.fn().mockResolvedValue(undefined) }));
import {
  accountDeletionEligibility,
  deleteAccount,
  type DeletionDependencies,
} from "../../src/lib/accountDeletion";
import { processPendingStripeCancellations } from "../../src/lib/accountDeletionWorker";

function fixture() {
  const state = { job: null as string | null, business: { id: 7, clerk_user_id: "user_owner",
    business_name: "Demo repair", retell_phone_number: "+12395550101", retell_agent_id: "agent_shared", provisioning_state: "ready" },
    billing: [] as any[], attempts: [] as any[], invoices: [] as any[], deleted: false,
    resources: [] as any[], cancellations: [] as any[], operationalAlerts: [] as any[] };
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
    if (sql.includes("FROM manual_invoices WHERE")) return { rows: state.invoices };
    if (sql.startsWith("SELECT * FROM provisioning_attempts")) return { rows: state.attempts };
    if (sql.startsWith("INSERT INTO pending_retell_releases")) state.resources.push(args);
    if (sql.startsWith("INSERT INTO pending_billing_cancellations")) state.cancellations.push(args);
    if (sql.startsWith("INSERT INTO operational_failures")) state.operationalAlerts.push(args);
    if (sql.startsWith("INSERT INTO account_deletions")) state.job = "pending";
    if (sql.startsWith("UPDATE manual_invoices SET business_name")) {
      state.invoices = state.invoices.map(invoice => ({ ...invoice, business_name: "Deleted account" }));
    }
    if (sql.startsWith("DELETE FROM leads") && fail) throw new Error("Simulated database failure");
    if (sql.startsWith("DELETE FROM businesses")) state.deleted = true;
    if (sql.startsWith("UPDATE pending_billing_cancellations SET status='completed'")) {
      state.cancellations = state.cancellations.map(job => job[0] === args[0] ? [...job, "completed"] : job);
    }
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
  it("protects verified admins before acquiring a database connection",async()=>{
    const f=fixture();f.deps.isProtectedUser=async()=>true;
    await expect(deleteAccount("user_owner",f.deps)).rejects.toMatchObject({status:403});
    expect(f.calls).toHaveLength(0);expect(f.deleteUser).not.toHaveBeenCalled();
  });
  it("protects an internal owner even when not an admin",async()=>{
    const f=fixture();Object.assign(f.state.business,{is_internal:true});
    await expect(deleteAccount("user_owner",f.deps)).rejects.toMatchObject({status:403});
    expect(f.calls.some(c=>c.sql.startsWith("DELETE"))).toBe(false);
    expect(f.deleteUser).not.toHaveBeenCalled();
  });
  it("allows deletion of a non-internal sample business and removes its leads", async () => {
    const f = fixture();
    Object.assign(f.state.business, { is_sample: true, is_internal: false });
    const eligibilityDeps: DeletionDependencies = {
      ...f.deps,
      pool: {
        ...f.deps.pool,
        query: vi.fn().mockResolvedValue({ rows: [{ is_internal: false }] }),
      },
      isProtectedUser: async () => false,
    };

    expect(await accountDeletionEligibility("user_owner", eligibilityDeps)).toEqual({
      allowed: true,
      reason: null,
    });
    await expect(deleteAccount("user_owner", f.deps)).resolves.toBe("completed");
    expect(f.calls.some(c => c.sql.startsWith("DELETE FROM leads"))).toBe(true);
    expect(f.calls.some(c => c.sql.startsWith("DELETE FROM businesses"))).toBe(true);
    expect(f.deleteUser).toHaveBeenCalledOnce();
  });
  it("anonymizes retained invoices and balance alerts while retaining accounting references",async()=>{
    const f=fixture();
    f.state.invoices=[{id:23,business_id:7,business_name:"Demo repair",monthly_cents:5000,setup_cents:2500,
      paid_at:null,payment_reference:"cash receipt 123"}];
    await deleteAccount("user_owner",f.deps);
    expect(f.state.invoices[0].business_name).toBe("Deleted account");
    expect(f.state.invoices[0].payment_reference).toBe("cash receipt 123");
    expect(f.calls.some(c => c.sql.startsWith("UPDATE manual_invoices SET business_name='Deleted account'"))).toBe(true);
    expect(f.calls.some(c=>c.sql.startsWith("DELETE FROM invoice_emails"))).toBe(true);
    expect(f.calls.some(c=>c.sql.startsWith("DELETE FROM manual_invoices"))).toBe(false);
    expect(f.state.operationalAlerts).toEqual([
      expect.arrayContaining(["account-deletion-balance:7", expect.any(String), "Deleted account"]),
    ]);
    expect(f.calls.some(c=>c.sql.startsWith("UPDATE billing_events SET business_id = NULL"))).toBe(true);
    expect(f.calls.some(c=>c.sql.startsWith("DELETE FROM billing_accounts"))).toBe(true);
  });
  it("removes support content, push credentials, and business-scoped operational records", async () => {
    const f = fixture();
    await deleteAccount("user_owner", f.deps);
    for (const table of ["notification_devices", "web_push_subscriptions", "support_requests",
      "owner_sms_messages", "retell_system_alerts", "business_admin_events"]) {
      expect(f.calls.some(c => c.sql.startsWith(`DELETE FROM ${table}`))).toBe(true);
    }
  });
  it("removes reminder and email test history before identity deletion",async()=>{
    const f=fixture();await deleteAccount("user_owner",f.deps);
    for(const prefix of ["DELETE FROM invoice_emails","DELETE FROM email_health_attempts"])
      expect(f.calls.some(c=>c.sql.startsWith(prefix))).toBe(true);
  });
  it("commits owned cleanup before calling Clerk, preserves resources and is idempotent", async () => {
    const f = fixture();
    f.deleteUser.mockImplementation(async id => {
      expect(id).toBe("user_owner");
      expect(f.state.deleted).toBe(true);
      expect(f.calls.at(-2)?.sql).toBe("COMMIT");
    });
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.state.resources).toEqual([["business:7", 7, "Deleted account", "+12395550101", "agent_shared", "ready"]]);
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.deleteUser).toHaveBeenCalledOnce();
    expect(f.calls.filter(c => c.sql.startsWith("DELETE FROM businesses"))).toHaveLength(1);
  });
  it.each(["active", "past_due", "suspended", "unpaid"])("deletes the account and cancels a %s subscription", async status => {
    const f = fixture();
    f.state.billing = [{ business_id: 7, state: { status, plan: "starter", subscriptionId: "sub_test_123" },
      stripe_subscription_id: "sub_test_123" }];
    const cancel = vi.fn().mockResolvedValue(undefined);
    f.deps.cancelStripeResources = cancel;
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.state.deleted).toBe(true);
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "sub_test_123",
      checkoutSessionId: null,
    }));
    expect(f.state.cancellations[0]?.at(-1)).toBe("completed");
  });
  it("expires a pending checkout and retains a retry job when Stripe cancellation fails", async () => {
    const f = fixture();
    f.state.billing = [{ business_id: 7, state: { status: "unknown", pendingCheckout: { id: "cs_test_pending" } },
      stripe_subscription_id: null }];
    f.deps.cancelStripeResources = vi.fn().mockRejectedValue(new Error("Stripe temporarily unavailable"));
    f.deps.alertStripeCancellationFailure = vi.fn().mockResolvedValue(undefined);
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.state.deleted).toBe(true);
    expect(f.deps.cancelStripeResources).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: null,
      checkoutSessionId: "cs_test_pending",
    }));
    expect(f.calls.some(c => c.sql.includes("status='pending'") && c.sql.includes("next_attempt_at"))).toBe(true);
    expect(f.deps.alertStripeCancellationFailure).toHaveBeenCalledOnce();
  });
  it("retries a queued Stripe cancellation on the worker and completes the job", async () => {
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.includes("WITH due AS")) return { rows: [{
        id: 42, source_key: "account-deletion:7:fingerprint", business_id: 7, business_name: "Deleted account",
        subscription_id: "sub_test_123", checkout_session_id: null,
      }] };
      return { rows: [] };
    }) };
    const cancel = vi.fn().mockRejectedValueOnce(new Error("Temporary Stripe outage")).mockResolvedValueOnce(undefined);
    const alert = vi.fn().mockResolvedValue(undefined);
    const deps = { pool, cancelStripeResources: cancel, alertStripeCancellationFailure: alert };
    await processPendingStripeCancellations(deps);
    await processPendingStripeCancellations(deps);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls.filter(([sql]) => sql.includes("SET status='pending'"))).toHaveLength(1);
    expect(pool.query.mock.calls.filter(([sql]) => sql.includes("SET status='completed'"))).toHaveLength(1);
  });
  it("alerts admins when an unresolved subscription has no provider identifier", async () => {
    const f = fixture();
    f.state.billing = [{ business_id: 7, state: { status: "active", plan: "starter" }, stripe_subscription_id: null }];
    expect(await deleteAccount("user_owner", f.deps)).toBe("completed");
    expect(f.state.deleted).toBe(true);
    expect(f.state.operationalAlerts[0]?.[0]).toBe("account-deletion-billing-missing:7");
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
      if (call.sql.includes("clerk_user_id") || call.sql.includes("actor_user_id")) expect(call.args[0]).toBe("user_owner");
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

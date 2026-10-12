import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
type SqlResult = { rows: Record<string, any>[] };
type SqlQuery = (text: string, values?: any[]) => Promise<SqlResult>;
type SqlClient = { query: SqlQuery; release: () => void };

export class AccountDeletionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export function paidDeletionBlocked(account: { state: Record<string, unknown>; stripe_subscription_id?: string | null }) {
  const s = account.state;
  // Always enforce stored obligations, regardless of BILLING_ENABLED or native UI.
  return Boolean(s.pendingCheckout)
    || ["active", "past_due", "unpaid", "suspended"].includes(String(s.status))
    || (Boolean(s.plan || s.subscriptionId || account.stripe_subscription_id)
      && !["not_subscribed", "canceled", "incomplete_expired"].includes(String(s.status)));
}

export type DeletionDependencies = {
  pool: { connect: () => Promise<SqlClient>; query: SqlQuery };
  deleteUser: (id: string) => Promise<unknown>;
};
const defaults: DeletionDependencies = { pool, deleteUser: id => clerkClient.users.deleteUser(id) };

async function preserveResources(client: SqlClient, businesses: any[], attempts: any[], userId: string) {
  const add = (key: string, businessId: number | null, name: string, phone: string | null, agent: string | null, state: string | null) =>
    client.query(`INSERT INTO pending_retell_releases
      (source_key, business_id, business_name, phone_number, agent_id, provisioning_status)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_key) DO NOTHING`, [key, businessId, name, phone, agent, state]);
  for (const business of businesses) {
    if (business.retell_phone_number || business.retell_agent_id) {
      await add(`business:${business.id}`, business.id, business.business_name,
        business.retell_phone_number, business.retell_agent_id, business.provisioning_state);
    }
  }
  for (const attempt of attempts) {
    const business = businesses.find(b => b.id === attempt.business_id);
    if (attempt.clerk_user_id !== userId) throw new AccountDeletionError("Phone provisioning ownership conflict. Contact hello@corvlio.com.");
    if (attempt.business_id && !business) throw new AccountDeletionError("Ownership conflict in phone provisioning. Contact hello@corvlio.com.");
    if (attempt.purchased_number && attempt.purchased_number === business?.retell_phone_number) continue;
    // Preserve uncertain purchase journals even when no number was returned.
    await add(`purchase:${attempt.id}`, attempt.business_id, business?.business_name ?? "Deleted account — unlinked phone purchase",
      attempt.purchased_number, null, attempt.status);
  }
}

/** Database phase is all-or-nothing. Identity deletion only starts after commit. */
export async function removeOwnedAppData(userId: string, deps = defaults) {
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`account-deletion:${userId}`]);
    const existing = await client.query("SELECT status FROM account_deletions WHERE clerk_user_id = $1", [userId]);
    if (existing.rows[0]) { await client.query("COMMIT"); return existing.rows[0].status; }
    // Acquire billing's existing lock BEFORE row locks: same ordering as billing.
    const owned = await client.query("SELECT id FROM businesses WHERE clerk_user_id = $1 ORDER BY id", [userId]);
    for (const row of owned.rows) {
      await client.query("SELECT pg_advisory_xact_lock(62741, $1)", [row.id]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`deleted-business:${row.id}`]);
    }
    const { rows: businesses } = await client.query("SELECT * FROM businesses WHERE clerk_user_id = $1 ORDER BY id FOR UPDATE", [userId]);
    if (businesses.some(b => !owned.rows.some(o => o.id === b.id))) throw new AccountDeletionError("Business ownership changed. Please retry.");
    const ids = businesses.map(b => b.id);
    const billing = await client.query("SELECT * FROM billing_accounts WHERE business_id = ANY($1::int[]) FOR UPDATE", [ids]);
    if (billing.rows.some(paidDeletionBlocked)) {
      throw new AccountDeletionError("Account deletion is blocked while a paid subscription is active, past due, or unresolved. Contact hello@corvlio.com for support.");
    }
    const attempts = await client.query(
      "SELECT * FROM provisioning_attempts WHERE clerk_user_id = $1 OR business_id = ANY($2::int[]) FOR UPDATE", [userId, ids]);
    await preserveResources(client, businesses, attempts.rows, userId);
    await client.query("INSERT INTO account_deletions (clerk_user_id, business_ids) VALUES ($1, $2::int[]) ON CONFLICT DO NOTHING", [userId, ids]);
    // Devices are unregistered first; delivery attempts cascade from devices/events.
    await client.query("DELETE FROM notification_devices WHERE clerk_user_id = $1", [userId]);
    for (const table of ["notification_events", "notification_seen_leads", "notification_poll_state"]) {
      await client.query(`DELETE FROM ${table} WHERE business_id = ANY($1::text[])`, [ids.map(String)]);
    }
    for (const table of ["billing_notices", "billing_events", "billing_accounts", "operational_failures",
      "owner_demo_calls", "retell_call_records", "leads"]) {
      await client.query(`DELETE FROM ${table} WHERE business_id = ANY($1::int[])`, [ids]);
    }
    await client.query("DELETE FROM provisioning_attempts WHERE clerk_user_id = $1 OR business_id = ANY($2::int[])", [userId, ids]);
    await client.query("DELETE FROM businesses WHERE clerk_user_id = $1 AND id = ANY($2::int[])", [userId, ids]);
    await client.query("COMMIT");
    return "pending";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function finishIdentityDeletion(userId: string, deps = defaults, alreadyDeleted = false): Promise<"completed" | "pending"> {
  const row = await deps.pool.query("SELECT status FROM account_deletions WHERE clerk_user_id = $1", [userId]);
  if (!row.rows[0]) throw new AccountDeletionError("No committed account deletion request.", 409);
  if (row.rows[0].status === "completed") return "completed";
  try {
    if (!alreadyDeleted) {
      try { await deps.deleteUser(userId); }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    }
    await deps.pool.query("UPDATE account_deletions SET status = 'completed', completed_at = now(), last_error = NULL WHERE clerk_user_id = $1", [userId]);
    return "completed";
  } catch {
    try {
      const retry = await deps.pool.query(`UPDATE account_deletions SET attempts = attempts + 1,
        last_error = 'clerk_unavailable', next_attempt_at = now() + interval '5 minutes'
        WHERE clerk_user_id = $1 AND status = 'pending' RETURNING status`, [userId]);
      return retry.rows.length ? "pending" : "completed";
    } catch {
      // The outbox was committed before calling Clerk, so even a retry-metadata
      // write failure is still a durable pending request, not a failed deletion.
      return "pending";
    }
  }
}

export async function deleteAccount(userId: string, deps = defaults, alreadyDeleted = false) {
  await removeOwnedAppData(userId, deps);
  return finishIdentityDeletion(userId, deps, alreadyDeleted);
}

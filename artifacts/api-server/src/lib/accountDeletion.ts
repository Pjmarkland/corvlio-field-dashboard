import { clerkClient } from "@clerk/express";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { hasVerifiedAdminEmail, parseAdminEmails } from "../middlewares/requireAdmin";
import { invoiceNumber } from "../invoicing/policy";
import {
  alertStripeCancellationFailure,
  cancelStripeResourcesForDeletion,
  type DeletedAccountBillingResources,
} from "../billing/accountDeletion";
import { logger } from "./logger";
type SqlResult = { rows: Record<string, any>[] };
type SqlQuery = (text: string, values?: any[]) => Promise<SqlResult>;
type SqlClient = { query: SqlQuery; release: () => void };

export class AccountDeletionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export type DeletionDependencies = {
  pool: { connect: () => Promise<SqlClient>; query: SqlQuery };
  deleteUser: (id: string) => Promise<unknown>;
  isProtectedUser?: (id: string) => Promise<boolean>;
  cancelStripeResources?: (resources: DeletedAccountBillingResources) => Promise<void>;
  alertStripeCancellationFailure?: (resources: DeletedAccountBillingResources, error: unknown) => Promise<void>;
  dispatchAccountDeletionAlerts?: () => Promise<void>;
};
async function dispatchAccountDeletionAlerts() {
  const { runNotificationOutboxNow } = await import("./notificationService");
  await runNotificationOutboxNow();
}
const defaults: DeletionDependencies = { pool, deleteUser: id => clerkClient.users.deleteUser(id),
  cancelStripeResources: cancelStripeResourcesForDeletion,
  alertStripeCancellationFailure,
  dispatchAccountDeletionAlerts,
  isProtectedUser: async id => {
    try {return hasVerifiedAdminEmail((await clerkClient.users.getUser(id)).emailAddresses,parseAdminEmails(process.env.ADMIN_EMAILS));}
    catch(e) {if((e as {status?:number}).status===404)return false;throw e;}
  },
};
const protectedReason = "Protected admin and internal business accounts cannot be deleted from this screen.";
export async function accountDeletionEligibility(userId:string,deps=defaults) {
  if (await deps.isProtectedUser?.(userId)) return {allowed:false,reason:protectedReason};
  const result=await deps.pool.query("SELECT is_internal FROM businesses WHERE clerk_user_id=$1",[userId]);
  return result.rows.some(b=>b.is_internal) ? {allowed:false,reason:protectedReason} : {allowed:true,reason:null};
}

async function preserveResources(client: SqlClient, businesses: any[], attempts: any[], userId: string) {
  const add = (key: string, businessId: number | null, name: string, phone: string | null, agent: string | null, state: string | null) =>
    client.query(`INSERT INTO pending_retell_releases
      (source_key, business_id, business_name, phone_number, agent_id, provisioning_status)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_key) DO NOTHING`, [key, businessId, name, phone, agent, state]);
  for (const business of businesses) {
    if (business.retell_phone_number || business.retell_agent_id) {
      await add(`business:${business.id}`, business.id, "Deleted account",
        business.retell_phone_number, business.retell_agent_id, business.provisioning_state);
    }
  }
  for (const attempt of attempts) {
    const business = businesses.find(b => b.id === attempt.business_id);
    if (attempt.clerk_user_id !== userId) throw new AccountDeletionError("Phone provisioning ownership conflict. Please retry.");
    if (attempt.business_id && !business) throw new AccountDeletionError("Ownership conflict in phone provisioning. Please retry.");
    if (attempt.purchased_number && attempt.purchased_number === business?.retell_phone_number) continue;
    // Preserve uncertain purchase journals even when no number was returned.
    await add(`purchase:${attempt.id}`, attempt.business_id, "Deleted account",
      attempt.purchased_number, null, attempt.status);
  }
}

/** Database phase is all-or-nothing. Identity deletion only starts after commit. */
export async function removeOwnedAppData(userId: string, deps = defaults) {
  if (await deps.isProtectedUser?.(userId)) throw new AccountDeletionError(protectedReason,403);
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`account-deletion:${userId}`]);
    const existing = await client.query("SELECT status FROM account_deletions WHERE clerk_user_id = $1", [userId]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return {
        status: existing.rows[0].status,
        balanceAlertQueued: false,
        billingReviewAlertQueued: false,
        billingCancellations: [] as DeletedAccountBillingResources[],
      };
    }
    // Acquire billing's existing lock BEFORE row locks: same ordering as billing.
    const owned = await client.query("SELECT id FROM businesses WHERE clerk_user_id = $1 ORDER BY id", [userId]);
    for (const row of owned.rows) {
      await client.query("SELECT pg_advisory_xact_lock(62741, $1)", [row.id]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`deleted-business:${row.id}`]);
    }
    const { rows: businesses } = await client.query("SELECT * FROM businesses WHERE clerk_user_id = $1 ORDER BY id FOR UPDATE", [userId]);
    if (businesses.some(b => !owned.rows.some(o => o.id === b.id))) throw new AccountDeletionError("Business ownership changed. Please retry.");
    const ids = businesses.map(b => b.id);
    if (businesses.some(b=>b.is_internal)) throw new AccountDeletionError(protectedReason,403);
    const billing = await client.query("SELECT * FROM billing_accounts WHERE business_id = ANY($1::int[]) FOR UPDATE", [ids]);
    const unpaid = await client.query(
      `SELECT id,business_id,business_name,monthly_cents,setup_cents
       FROM manual_invoices WHERE business_id = ANY($1::int[]) AND paid_at IS NULL ORDER BY id`,
      [ids],
    );
    const attempts = await client.query(
      "SELECT * FROM provisioning_attempts WHERE clerk_user_id = $1 OR business_id = ANY($2::int[]) FOR UPDATE", [userId, ids]);
    await preserveResources(client, businesses, attempts.rows, userId);
    const unpaidByBusiness = new Map<number, Array<{ id: number; business_name: string; monthly_cents: number; setup_cents: number }>>();
    for (const invoice of unpaid.rows) {
      const list = unpaidByBusiness.get(invoice.business_id) ?? [];
      list.push(invoice);
      unpaidByBusiness.set(invoice.business_id, list);
    }
    let balanceAlertQueued = false;
    let billingReviewAlertQueued = false;
    const billingCancellations: DeletedAccountBillingResources[] = [];
    for (const business of businesses) {
      const invoices = unpaidByBusiness.get(business.id) ?? [];
      const billingAccount = billing.rows.find(row => row.business_id === business.id);
      const billingState = billingAccount?.state as Record<string, unknown> | undefined;
      const subscriptionId = billingAccount?.stripe_subscription_id
        ?? (typeof billingState?.subscriptionId === "string" ? billingState.subscriptionId : null);
      const pendingCheckout = billingState?.pendingCheckout;
      const checkoutSessionId = pendingCheckout && typeof pendingCheckout === "object"
        && "id" in pendingCheckout && typeof pendingCheckout.id === "string"
        ? pendingCheckout.id : null;
      const terminalSubscription = ["canceled", "incomplete_expired"].includes(String(billingState?.status));
      const needsCancellation = Boolean(checkoutSessionId || (subscriptionId && !terminalSubscription));
      const resourceFingerprint = createHash("sha256")
        .update(`${subscriptionId ?? ""}:${checkoutSessionId ?? ""}`)
        .digest("hex");
      if (needsCancellation) {
        const resources: DeletedAccountBillingResources = {
          sourceKey: `account-deletion:${business.id}:${resourceFingerprint}`,
          businessId: business.id,
          businessName: "Deleted account",
          subscriptionId: terminalSubscription ? null : subscriptionId,
          checkoutSessionId,
        };
        await client.query(
          `INSERT INTO pending_billing_cancellations
            (source_key,business_id,business_name,subscription_id,checkout_session_id)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_key) DO NOTHING`,
          [resources.sourceKey, resources.businessId, resources.businessName, resources.subscriptionId, resources.checkoutSessionId],
        );
        billingCancellations.push(resources);
      } else if (["active", "past_due", "unpaid", "suspended"].includes(String(billingState?.status))) {
        await client.query(
          `INSERT INTO operational_failures
            (event_key,source,summary,details,business_id,business_name)
           VALUES ($1,'account_deletion_billing','Subscription cleanup needs admin review',
             'The billing record indicated an active or unresolved subscription but had no Stripe subscription or Checkout session ID.',NULL,$2)
           ON CONFLICT (event_key) DO NOTHING`,
          [`account-deletion-billing-missing:${business.id}`, "Deleted account"],
        );
        billingReviewAlertQueued = true;
      }
      const providerPastDue = ["past_due", "unpaid", "suspended"].includes(String(billingState?.status));
      if (invoices.length === 0 && !providerPastDue) continue;
      const amountCents = invoices.reduce((sum, invoice) => sum + invoice.monthly_cents + invoice.setup_cents, 0);
      const invoiceLines = invoices.map(invoice =>
        `${invoiceNumber(invoice.id)}: $${((invoice.monthly_cents + invoice.setup_cents) / 100).toFixed(2)}`,
      );
      const details = [
        invoices.length ? `Unpaid manual invoices: ${invoiceLines.join("; ")}.` : "",
        invoices.length ? `Known manual-invoice balance: $${(amountCents / 100).toFixed(2)}.` : "",
        providerPastDue
          ? `Billing provider reports ${String(billingState?.status)}; review its invoice history.`
          : "",
      ].filter(Boolean).join(" ");
      const invoiceBusinessName = invoices[0]?.business_name ?? business.business_name ?? "Deleted account";
      await client.query(
        `INSERT INTO operational_failures
          (event_key,source,summary,details,business_id,business_name)
         VALUES ($1,'account_deletion_balance','Outstanding balance after account deletion',$2,NULL,$3)
         ON CONFLICT (event_key) DO NOTHING`,
        [`account-deletion-balance:${business.id}`, details, invoiceBusinessName],
      );
      balanceAlertQueued = true;
    }
    await client.query("INSERT INTO account_deletions (clerk_user_id, business_ids) VALUES ($1, $2::int[]) ON CONFLICT DO NOTHING", [userId, ids]);
    // Devices are unregistered first; delivery attempts cascade from devices/events.
    await client.query("DELETE FROM notification_devices WHERE clerk_user_id = $1", [userId]);
    for (const table of ["notification_events", "notification_seen_leads", "notification_poll_state"]) {
      await client.query(`DELETE FROM ${table} WHERE business_id = ANY($1::text[])`, [ids.map(String)]);
    }
    for (const table of ["billing_notices", "operational_failures",
      "owner_demo_calls", "retell_call_records", "leads"]) {
      await client.query(`DELETE FROM ${table} WHERE business_id = ANY($1::int[])`, [ids]);
    }
    // Keep the financial event ledger, but detach its owner actor and business FK.
    await client.query("UPDATE billing_events SET business_id = NULL, actor = NULL WHERE business_id = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM billing_accounts WHERE business_id = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM provisioning_attempts WHERE clerk_user_id = $1 OR business_id = ANY($2::int[])", [userId, ids]);
    // Remove pending invoice/reminder jobs before removing their invoices.
    await client.query("DELETE FROM invoice_emails WHERE invoice_id IN (SELECT id FROM manual_invoices WHERE business_id=ANY($1::int[]))",[ids]);
    await client.query("DELETE FROM email_health_attempts WHERE actor_user_id=$1",[userId]);
    await client.query("DELETE FROM businesses WHERE clerk_user_id = $1 AND id = ANY($2::int[])", [userId, ids]);
    await client.query("COMMIT");
    return { status: "pending", balanceAlertQueued, billingReviewAlertQueued, billingCancellations };
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
  const cleanup = await removeOwnedAppData(userId, deps);
  if ((cleanup.balanceAlertQueued || cleanup.billingReviewAlertQueued) && deps.dispatchAccountDeletionAlerts) {
    // The operational-failure worker sends the durable alert to PJ/admins.
    // It runs independently and retries if Gmail is temporarily unavailable.
    void deps.dispatchAccountDeletionAlerts().catch(error => logger.warn(
      { error: error instanceof Error ? error.message : "Unknown outbox error" },
      "Account deletion alert dispatch failed; durable alert remains queued",
    ));
  }
  for (const resources of cleanup.billingCancellations) {
    if (!deps.cancelStripeResources) continue;
    try {
      await deps.cancelStripeResources(resources);
      await deps.pool.query(
        `UPDATE pending_billing_cancellations SET status='completed',resolved_at=now(),
         claim_until=NULL,last_error=NULL WHERE source_key=$1`,
        [resources.sourceKey],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 400) : "Unknown Stripe cancellation error";
      try {
        await deps.pool.query(
          `UPDATE pending_billing_cancellations
           SET status='pending',attempts=attempts+1,last_error=$2,
             next_attempt_at=now()+interval '5 minutes',claim_until=NULL
           WHERE source_key=$1`,
          [resources.sourceKey, message],
        );
        await deps.alertStripeCancellationFailure?.(resources, error);
      } catch (queueError) {
        logger.error(
          { error: queueError instanceof Error ? queueError.message : "Unknown retry error" },
          "Stripe account-deletion cleanup remains queued but retry metadata could not be updated",
        );
      }
    }
  }
  return finishIdentityDeletion(userId, deps, alreadyDeleted);
}

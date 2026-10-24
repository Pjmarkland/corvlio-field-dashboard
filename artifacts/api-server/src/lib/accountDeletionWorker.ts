import { pool } from "@workspace/db";
import { finishIdentityDeletion } from "./accountDeletion";
import { logger } from "./logger";
import { databaseErrorFields } from "@workspace/db/errors";
import {
  alertStripeCancellationFailure,
  cancelStripeResourcesForDeletion,
  type DeletedAccountBillingResources,
} from "../billing/accountDeletion";
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | null = null;
export function startAccountDeletionWorker() {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = (async () => {
      const result = await pool.query("SELECT clerk_user_id FROM account_deletions WHERE status = 'pending' AND next_attempt_at <= now() LIMIT 20");
      for (const row of result.rows) await finishIdentityDeletion(row.clerk_user_id);
      await processPendingStripeCancellations();
    })().catch(error => logger.error(databaseErrorFields(error), "Account deletion retry failed; requests remain queued."))
      .finally(() => { running = null; });
  };
  timer = setInterval(run, 5 * 60_000);
  timer.unref();
}

async function processPendingStripeCancellations() {
  const claimed = await pool.query(`
    WITH due AS (
      SELECT id FROM pending_billing_cancellations
      WHERE (status='pending' AND next_attempt_at <= now())
         OR (status='processing' AND claim_until <= now())
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT 10
    )
    UPDATE pending_billing_cancellations AS queued
    SET status='processing', attempts=queued.attempts+1, claim_until=now()+interval '2 minutes'
    FROM due WHERE queued.id=due.id
    RETURNING queued.*
  `);
  for (const row of claimed.rows) {
    const resources: DeletedAccountBillingResources = {
      sourceKey: row.source_key,
      businessId: row.business_id,
      businessName: row.business_name,
      subscriptionId: row.subscription_id,
      checkoutSessionId: row.checkout_session_id,
    };
    try {
      await cancelStripeResourcesForDeletion(resources);
      await pool.query(
        `UPDATE pending_billing_cancellations SET status='completed',resolved_at=now(),
         claim_until=NULL,last_error=NULL WHERE id=$1`,
        [row.id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 400) : "Unknown Stripe cancellation error";
      await pool.query(
        `UPDATE pending_billing_cancellations
         SET status='pending',last_error=$2,claim_until=NULL,
           next_attempt_at=now()+LEAST(interval '6 hours',interval '1 minute'*power(2,LEAST(attempts,12)))
         WHERE id=$1`,
        [row.id, message],
      );
      await alertStripeCancellationFailure(resources, error);
      logger.warn({ sourceKey: resources.sourceKey }, "Stripe account-deletion cancellation retry scheduled");
    }
  }
}
export async function stopAccountDeletionWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await running;
}

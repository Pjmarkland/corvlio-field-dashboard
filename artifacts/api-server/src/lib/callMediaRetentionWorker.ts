import { pool } from "@workspace/db";
import { logger } from "./logger";
import { deleteRetellCall } from "./retellCallDeletion";

export const CALL_MEDIA_RETENTION_MONTHS = 12;
const BATCH_SIZE = 50;
const PERSONAL_DATA_BATCH_SIZE = 500;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

type RetentionRow = { id: number; call_id: string; business_id: number; lead_id: number | null };
type OrphanLeadRow = { id: number; call_id: string | null; business_id: number };
type RetentionDependencies = {
  query: typeof pool.query;
  removeCall: typeof deleteRetellCall;
  now: () => Date;
};

const defaults: RetentionDependencies = {
  query: pool.query.bind(pool),
  removeCall: deleteRetellCall,
  now: () => new Date(),
};
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | null = null;

function subtractMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export async function runCallMediaRetentionNow(deps: RetentionDependencies = defaults) {
  const cutoff = subtractMonths(deps.now(), CALL_MEDIA_RETENTION_MONTHS);
  let deletedCount = 0;
  let failedCount = 0;

  const expiredRecords = await deps.query<RetentionRow>(
    `SELECT r.id, r.retell_call_id AS call_id, r.business_id, r.lead_id
     FROM retell_call_records r
     WHERE r.call_started_at <= $1 AND r.media_retention_completed_at IS NULL
     ORDER BY r.call_started_at, r.id
     LIMIT $2`,
    [cutoff, BATCH_SIZE],
  );
  for (const row of expiredRecords.rows) {
    try {
      await deps.removeCall(row.call_id);
      await deps.query(
        `UPDATE retell_call_records
         SET media_retention_completed_at = now()
         WHERE id = $1 AND media_retention_completed_at IS NULL`,
        [row.id],
      );
      await deps.query(
        `UPDATE leads
         SET transcript = NULL, recording_url = NULL, media_retention_completed_at = now()
         WHERE business_id = $1 AND media_retention_completed_at IS NULL
           AND (id = $2 OR retell_call_id = $3)`,
        [row.business_id, row.lead_id, row.call_id],
      );
      deletedCount += 1;
    } catch {
      failedCount += 1;
      logger.warn({ leadId: row.lead_id }, "Call media retention deletion deferred");
    }
  }

  const unlinkedLeads = await deps.query<OrphanLeadRow>(
    `SELECT l.id,
       COALESCE(l.retell_call_id, (
         SELECT r.retell_call_id FROM retell_call_records r
         WHERE r.lead_id = l.id AND r.business_id = l.business_id
         ORDER BY r.id LIMIT 1
       )) AS call_id,
       l.business_id
     FROM leads l
     WHERE l.created_at <= $1 AND l.media_retention_completed_at IS NULL
       AND (l.transcript IS NOT NULL OR l.recording_url IS NOT NULL OR l.retell_call_id IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM retell_call_records r
         WHERE r.business_id = l.business_id
           AND (r.lead_id = l.id OR (l.retell_call_id IS NOT NULL AND r.retell_call_id = l.retell_call_id))
           AND r.call_started_at IS NOT NULL
       )
     ORDER BY l.created_at, l.id
     LIMIT $2`,
    [cutoff, BATCH_SIZE],
  );
  for (const row of unlinkedLeads.rows) {
    try {
      if (row.call_id) await deps.removeCall(row.call_id);
      const cleared = await deps.query(
        `UPDATE leads
         SET transcript = NULL, recording_url = NULL, media_retention_completed_at = now()
         WHERE id = $1 AND created_at <= $2 AND media_retention_completed_at IS NULL`,
        [row.id, cutoff],
      );
      if (cleared.rowCount) deletedCount += 1;
    } catch {
      failedCount += 1;
      // Deliberately log only the lead identifier, never provider bodies or media.
      logger.warn({ leadId: row.id }, "Call media retention deletion deferred");
    }
  }

  const scrubbedLeads = await deps.query<{ id: number }>(
    `WITH expired AS (
       SELECT id
       FROM leads
       WHERE created_at <= $1
         AND personal_data_retention_completed_at IS NULL
         AND (
           caller_name IS NOT NULL OR phone_number IS NOT NULL OR caller_id IS NOT NULL
           OR callback_number IS NOT NULL OR spam_caller_number IS NOT NULL
           OR transcript IS NOT NULL OR summary IS NOT NULL OR recording_url IS NOT NULL
           OR private_notes IS NOT NULL OR issue_reason IS NOT NULL OR address IS NOT NULL
           OR availability IS NOT NULL OR trade_intake_answers IS NOT NULL
         )
       ORDER BY created_at, id
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     ),
     scrubbed AS (
       UPDATE leads l
       SET caller_name = NULL,
           phone_number = NULL,
           caller_id = NULL,
           callback_number = NULL,
           spam_caller_number = NULL,
           transcript = NULL,
           summary = NULL,
           recording_url = NULL,
           private_notes = NULL,
           issue_reason = NULL,
           address = NULL,
           availability = NULL,
           trade_intake_answers = NULL,
           personal_data_retention_completed_at = now()
       WHERE l.id IN (SELECT id FROM expired)
       RETURNING l.id, l.business_id
     ),
     archived_notifications AS (
       UPDATE notification_events n
       SET title = 'Archived lead notification',
           body = 'Lead content removed after the 12-month retention period.',
           status = CASE WHEN n.status = 'queued' THEN 'failed' ELSE n.status END,
           email_status = CASE WHEN n.email_status = 'queued' THEN 'skipped' ELSE n.email_status END,
           last_error = NULL,
           email_last_error = NULL
       FROM scrubbed s
       WHERE n.lead_id = s.id::text
         AND n.business_id = s.business_id::text
         AND n.created_at <= $1
       RETURNING n.id
     )
     SELECT id FROM scrubbed`,
    [cutoff, PERSONAL_DATA_BATCH_SIZE],
  );
  const scrubbedPendingCalls = await deps.query(
    `UPDATE retell_pending_calls
     SET caller_number = NULL
     WHERE call_started_at <= $1 AND caller_number IS NOT NULL`,
    [cutoff],
  );
  deletedCount += scrubbedLeads.rowCount ?? 0;
  deletedCount += scrubbedPendingCalls.rowCount ?? 0;

  if (deletedCount || failedCount) {
    logger.info({ deletedCount, failedCount }, "Call media retention batch completed");
  }
  return { deletedCount, failedCount };
}

export function startCallMediaRetentionWorker() {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = runCallMediaRetentionNow()
      .then(() => undefined)
      .catch(() => { logger.warn("Call media retention batch could not run"); })
      .finally(() => { running = null; });
  };
  void run();
  timer = setInterval(run, RETENTION_INTERVAL_MS);
  timer.unref();
}

export async function stopCallMediaRetentionWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await running;
}

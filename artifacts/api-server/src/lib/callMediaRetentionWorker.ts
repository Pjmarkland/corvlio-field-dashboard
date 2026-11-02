import { pool } from "@workspace/db";
import { logger } from "./logger";
import { deleteRetellCall } from "./retellCallDeletion";

export const CALL_MEDIA_RETENTION_MONTHS = 12;
const BATCH_SIZE = 50;
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

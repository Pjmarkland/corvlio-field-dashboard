import { pool } from "@workspace/db";
import { finishIdentityDeletion } from "./accountDeletion";
import { logger } from "./logger";
import { databaseErrorFields } from "@workspace/db/errors";
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | null = null;
export function startAccountDeletionWorker() {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = (async () => {
      const result = await pool.query("SELECT clerk_user_id FROM account_deletions WHERE status = 'pending' AND next_attempt_at <= now() LIMIT 20");
      for (const row of result.rows) await finishIdentityDeletion(row.clerk_user_id);
    })().catch(error => logger.error(databaseErrorFields(error), "Account deletion retry failed; requests remain queued."))
      .finally(() => { running = null; });
  };
  timer = setInterval(run, 5 * 60_000);
  timer.unref();
}
export async function stopAccountDeletionWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await running;
}

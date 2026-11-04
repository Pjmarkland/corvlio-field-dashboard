import { db, retellPendingCallsTable } from "@workspace/db";
import { and, asc, eq, lte } from "drizzle-orm";
import { sendOwnerLeadSms } from "./ownerSms";
import { logger } from "./logger";
import { runNotificationOutboxNow } from "./notificationService";
import { persistPendingCallFallback } from "./retellPersistence";

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 50;

let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | null = null;

export async function runRetellPendingCallSweep(now = new Date()) {
  const dueCalls = await db
    .select({ callId: retellPendingCallsTable.retellCallId })
    .from(retellPendingCallsTable)
    .where(and(
      eq(retellPendingCallsTable.status, "pending"),
      lte(retellPendingCallsTable.deadlineAt, now),
    ))
    .orderBy(asc(retellPendingCallsTable.deadlineAt))
    .limit(BATCH_SIZE);
  let leadsCreated = 0;

  for (const pending of dueCalls) {
    try {
      const result = await persistPendingCallFallback(pending.callId, now);
      if (!result) continue;
      leadsCreated += 1;
      if (!result.notify) continue;
      void runNotificationOutboxNow().catch(() => {
        logger.warn({ leadId: result.leadId }, "Fallback lead notification delivery failed");
      });
      void sendOwnerLeadSms(result.businessId, result.leadId).catch(() => {
        logger.warn({ leadId: result.leadId }, "Fallback lead SMS delivery failed");
      });
    } catch (error) {
      logger.error({
        callId: pending.callId,
        error: error instanceof Error ? error.message : "Unknown error",
      }, "Pending Retell call fallback could not be created");
    }
  }
  return { dueCalls: dueCalls.length, leadsCreated };
}

export function startRetellPendingCallWorker() {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = runRetellPendingCallSweep()
      .then(() => undefined)
      .catch((error) => {
        logger.error({
          error: error instanceof Error ? error.message : "Unknown error",
        }, "Pending Retell call sweep failed");
      })
      .finally(() => { running = null; });
  };
  void run();
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
}

export async function stopRetellPendingCallWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await running;
}

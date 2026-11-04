import { and, eq, lt, or } from "drizzle-orm";
import { db, retellWebhookEventsTable } from "@workspace/db";

const STALE_PROCESSING_AFTER_MS = 5 * 60_000;

export type RetellEventType = "call_analyzed" | "call_ended";

export async function claimRetellWebhookEvent(
  callId: string,
  eventType: RetellEventType,
  now = new Date(),
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_AFTER_MS);
  const [claimed] = await db
    .insert(retellWebhookEventsTable)
    .values({ callId, eventType, state: "processing", startedAt: now })
    .onConflictDoUpdate({
      target: [retellWebhookEventsTable.callId, retellWebhookEventsTable.eventType],
      set: { state: "processing", startedAt: now, completedAt: null },
      setWhere: or(
        eq(retellWebhookEventsTable.state, "failed"),
        lt(retellWebhookEventsTable.startedAt, staleBefore),
      ),
    })
    .returning({ id: retellWebhookEventsTable.id });
  return Boolean(claimed);
}

export async function completeRetellWebhookEvent(
  callId: string,
  eventType: RetellEventType,
  now = new Date(),
): Promise<void> {
  await db
    .update(retellWebhookEventsTable)
    .set({ state: "completed", completedAt: now })
    .where(and(
      eq(retellWebhookEventsTable.callId, callId),
      eq(retellWebhookEventsTable.eventType, eventType),
      eq(retellWebhookEventsTable.state, "processing"),
    ));
}

export async function markRetellWebhookEventFailed(
  callId: string,
  eventType: RetellEventType,
): Promise<void> {
  await db
    .update(retellWebhookEventsTable)
    .set({ state: "failed", completedAt: new Date() })
    .where(and(
      eq(retellWebhookEventsTable.callId, callId),
      eq(retellWebhookEventsTable.eventType, eventType),
      eq(retellWebhookEventsTable.state, "processing"),
    ));
}

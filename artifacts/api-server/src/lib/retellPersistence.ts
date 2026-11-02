import { db, leadsTable, retellCallRecordsTable, notificationEventsTable } from "@workspace/db";
import { and, desc, eq, gte, lte, isNull, sql } from "drizzle-orm";
import { reconcileCall } from "./callReconciliation";
import { enqueueWebPushDeliveries } from "./webPushService";

type LeadInput = typeof leadsTable.$inferInsert;
type RecordInput = typeof retellCallRecordsTable.$inferInsert;

export async function persistAnalyzedCall(callId: string, leadInput: LeadInput, recordInput: RecordInput, analysisComplete = true, alertsEnabled = true) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542312, hashtext(${callId}))`);
    return reconcileCall(callId, leadInput.businessId, {
      async findLead(id) {
        const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.retellCallId, id));
        return lead;
      },
      async findLeadById(id) {
        const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, id));
        return lead;
      },
      async findRecord(id) {
        const [record] = await tx.select().from(retellCallRecordsTable)
          .where(eq(retellCallRecordsTable.retellCallId, id));
        return record;
      },
      async findLegacyLead() {
        const [record] = await tx.select().from(retellCallRecordsTable)
          .where(eq(retellCallRecordsTable.retellCallId, callId));
        if (!record || !leadInput.phoneNumber) return undefined;
        // Old leads had no call ID. Only link a single unambiguous nearby candidate.
        const candidates = await tx.select().from(leadsTable).where(and(
          eq(leadsTable.businessId, leadInput.businessId),
          isNull(leadsTable.retellCallId),
          eq(leadsTable.phoneNumber, leadInput.phoneNumber),
          leadInput.issueReason ? eq(leadsTable.issueReason, leadInput.issueReason) : isNull(leadsTable.issueReason),
          gte(leadsTable.createdAt, new Date(record.recordedAt.getTime() - 10 * 60_000)),
          lte(leadsTable.createdAt, new Date(record.recordedAt.getTime() + 10 * 60_000)),
        )).limit(2);
        return candidates.length === 1 ? candidates[0] : undefined;
      },
      async createLead(id) {
        const [lead] = await tx.insert(leadsTable).values({ ...leadInput, retellCallId: id }).returning();
        if (!lead) throw new Error("Lead creation returned no record");
        return lead;
      },
      async linkLead(leadId, id) {
        await tx.update(leadsTable).set({ retellCallId: id }).where(eq(leadsTable.id, leadId));
      },
      async enrichLead(leadId) {
        const [current] = await tx.select().from(leadsTable).where(eq(leadsTable.id, leadId));
        if (!current) throw new Error("Lead disappeared during reconciliation");
        const updates = Object.fromEntries(Object.entries(leadInput).filter(([field, value]) =>
          !["businessId", "id", "retellCallId", "status", "contactedAt", "contactedBy", "privateNotes", "createdAt"].includes(field)
          && value !== null && value !== undefined && value !== ""));
        // An out-of-order call_ended must never replace a spoken callback with caller ID.
        if (!leadInput.callbackNumber && current.callbackNumber) updates.phoneNumber = current.callbackNumber;
        // A late call_ended only fills gaps; it cannot erase richer analysis.
        if (!analysisComplete) {
          for (const field of Object.keys(updates)) {
            if (field !== "transcript" && current[field as keyof typeof current]) delete updates[field];
          }
        }
        if (Object.keys(updates).length) {
          await tx.update(leadsTable).set(updates).where(eq(leadsTable.id, leadId));
        }
      },
      async saveRecord(id, leadId) {
        await tx.insert(retellCallRecordsTable).values({ ...recordInput, retellCallId: id, leadId })
          .onConflictDoUpdate({
            target: retellCallRecordsTable.retellCallId,
            set: {
              leadId,
              callStartedAt: sql`COALESCE(${recordInput.callStartedAt ?? null}, ${retellCallRecordsTable.callStartedAt})`,
              durationMs: sql`COALESCE(${recordInput.durationMs ?? null}, ${retellCallRecordsTable.durationMs})`,
              outcome: sql`COALESCE(${recordInput.outcome ?? null}, ${retellCallRecordsTable.outcome})`,
              analysisComplete: sql`${retellCallRecordsTable.analysisComplete} OR ${analysisComplete}`,
              ...Object.fromEntries((["nameCaptured", "callbackCaptured", "issueCaptured", "addressCaptured"] as const).map(field => [
                field, sql`CASE WHEN ${analysisComplete} OR NOT ${retellCallRecordsTable.analysisComplete}
                  THEN COALESCE(${recordInput[field] ?? null}, ${retellCallRecordsTable[field]}) ELSE ${retellCallRecordsTable[field]} END`,
              ])),
            },
          });
      },
      async ensureNotification(leadId) {
        if (!alertsEnabled) return false;
        const name = leadInput.callerName || "Unknown caller";
        const inserted = await tx.insert(notificationEventsTable).values({
          businessId: String(leadInput.businessId), leadId: String(leadId),
          title: `New lead from ${name}`,
          body: `${leadInput.issueReason || "No details captured"} · Callback: ${leadInput.callbackNumber || leadInput.phoneNumber || "Not provided"}`,
          emailStatus: "queued",
          deepLink: `/leads/${leadId}`,
        }).onConflictDoNothing().returning();
        if (!inserted[0]) return false;
        await enqueueWebPushDeliveries(tx, inserted[0].id, leadInput.businessId);
        return true;
      },
    });
  });
}

export async function persistBlankCall(
  callId: string,
  input: { businessId: number; callStartedAt: Date | null; durationMs: number | null },
): Promise<{ inserted: boolean; triggerStreakAlert: boolean; streakStartCallId: string | null }> {
  return db.transaction(async (tx) => {
    // Serialize the threshold check per business so simultaneous webhooks cannot
    // both claim to be the third consecutive failure.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542313, ${input.businessId})`);
    const [record] = await tx
      .insert(retellCallRecordsTable)
      .values({
        businessId: input.businessId,
        retellCallId: callId,
        callStartedAt: input.callStartedAt,
        durationMs: input.durationMs,
        outcome: "blank_or_failed",
        analysisComplete: false,
      })
      .onConflictDoNothing()
      .returning({ retellCallId: retellCallRecordsTable.retellCallId });
    if (!record) return { inserted: false, triggerStreakAlert: false, streakStartCallId: null };

    const recent = await tx
      .select({
        retellCallId: retellCallRecordsTable.retellCallId,
        outcome: retellCallRecordsTable.outcome,
      })
      .from(retellCallRecordsTable)
      .where(eq(retellCallRecordsTable.businessId, input.businessId))
      .orderBy(
        desc(sql`COALESCE(${retellCallRecordsTable.callStartedAt}, ${retellCallRecordsTable.recordedAt})`),
        desc(retellCallRecordsTable.recordedAt),
      )
      .limit(4);

    const thresholdReached = recent.length >= 3
      && recent[0]?.retellCallId === callId
      && recent.slice(0, 3).every((item) => item.outcome === "blank_or_failed")
      && (recent.length === 3 || recent[3]?.outcome !== "blank_or_failed");

    return {
      inserted: true,
      triggerStreakAlert: thresholdReached,
      streakStartCallId: thresholdReached ? recent[2]?.retellCallId ?? null : null,
    };
  });
}
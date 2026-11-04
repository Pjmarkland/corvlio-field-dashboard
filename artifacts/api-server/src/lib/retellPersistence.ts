import { db, businessesTable, leadsTable, retellCallRecordsTable, retellPendingCallsTable, notificationEventsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, isNull, sql } from "drizzle-orm";
import { normalizeCallerNumber } from "./callerNumber";
import { reconcileCall } from "./callReconciliation";
import { enqueueWebPushDeliveries } from "./webPushService";

type LeadInput = typeof leadsTable.$inferInsert;
type RecordInput = typeof retellCallRecordsTable.$inferInsert;
export const RETELL_PENDING_CALL_MIN_DURATION_MS = 3_000;
export const RETELL_PENDING_CALL_ANALYSIS_WAIT_MS = 10 * 60_000;
export const NO_AI_SUMMARY_NOTE = "No AI summary was produced because the call-analysis event was not received.";

export async function persistPendingRetellCall(input: {
  callId: string;
  businessId: number;
  callerNumber: string | null;
  callStartedAt: Date;
  durationMs: number;
  receivedAt?: Date;
}): Promise<boolean> {
  if (!input.callId.trim() || input.durationMs < RETELL_PENDING_CALL_MIN_DURATION_MS) return false;
  const receivedAt = input.receivedAt ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542312, hashtext(${input.callId}))`);
    const [record] = await tx.select().from(retellCallRecordsTable)
      .where(eq(retellCallRecordsTable.retellCallId, input.callId));
    if (record?.analysisComplete || record?.leadId || record?.outcome === "blank_or_failed") {
      await tx.update(retellPendingCallsTable).set({ status: "resolved", callerNumber: null, resolvedAt: receivedAt })
        .where(and(
          eq(retellPendingCallsTable.retellCallId, input.callId),
          inArray(retellPendingCallsTable.status, ["pending", "fallback_created"]),
        ));
      return false;
    }
    const [existing] = await tx.select().from(retellPendingCallsTable)
      .where(eq(retellPendingCallsTable.retellCallId, input.callId));
    if (existing) return false;
    const inserted = await tx.insert(retellPendingCallsTable).values({
      businessId: input.businessId,
      retellCallId: input.callId,
      callerNumber: input.callerNumber,
      callStartedAt: input.callStartedAt,
      durationMs: input.durationMs,
      deadlineAt: new Date(receivedAt.getTime() + RETELL_PENDING_CALL_ANALYSIS_WAIT_MS),
    }).onConflictDoNothing().returning({ id: retellPendingCallsTable.id });
    return inserted.length > 0;
  });
}

export async function persistAnalyzedCall(callId: string, leadInput: LeadInput, recordInput: RecordInput, analysisComplete = true, alertsEnabled = true) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542312, hashtext(${callId}))`);
    const result = await reconcileCall(callId, leadInput.businessId, {
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
        const callerNumber = normalizeCallerNumber(leadInput.callerId)
          ?? normalizeCallerNumber(leadInput.phoneNumber)
          ?? normalizeCallerNumber(leadInput.callbackNumber);
        if (callerNumber) {
          const [suppressedCaller] = await tx.select({ id: leadsTable.id }).from(leadsTable).where(and(
            eq(leadsTable.businessId, leadInput.businessId),
            eq(leadsTable.isSpam, true),
            eq(leadsTable.spamCallerNumber, callerNumber),
          )).limit(1);
          if (suppressedCaller) return false;
        }
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
    if (analysisComplete) {
      await tx.update(retellPendingCallsTable).set({
        status: "resolved",
        callerNumber: null,
        leadId: result.id,
        resolvedAt: new Date(),
      }).where(and(
        eq(retellPendingCallsTable.retellCallId, callId),
        inArray(retellPendingCallsTable.status, ["pending", "fallback_created"]),
      ));
    }
    return result;
  });
}

export async function persistPendingCallFallback(callId: string, now = new Date()): Promise<{
  leadId: number;
  businessId: number;
  notify: boolean;
} | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542312, hashtext(${callId}))`);
    const [pending] = await tx.select().from(retellPendingCallsTable)
      .where(eq(retellPendingCallsTable.retellCallId, callId));
    if (!pending || pending.status !== "pending" || pending.deadlineAt > now) return null;
    const [existingRecord] = await tx.select().from(retellCallRecordsTable)
      .where(eq(retellCallRecordsTable.retellCallId, callId));
    if (existingRecord?.analysisComplete || existingRecord?.leadId || existingRecord?.outcome === "blank_or_failed") {
      await tx.update(retellPendingCallsTable).set({
        status: "resolved",
        leadId: existingRecord.leadId,
        resolvedAt: now,
      }).where(eq(retellPendingCallsTable.retellCallId, callId));
      return null;
    }
    const [business] = await tx.select().from(businessesTable)
      .where(eq(businessesTable.id, pending.businessId));
    if (!business) {
      await tx.update(retellPendingCallsTable).set({ status: "resolved", callerNumber: null, resolvedAt: now })
        .where(eq(retellPendingCallsTable.retellCallId, callId));
      return null;
    }
    const callerNumber = pending.callerNumber?.trim() || null;
    const leadInput: LeadInput = {
      businessId: pending.businessId,
      callerName: null,
      callerId: callerNumber,
      callbackNumber: null,
      phoneNumber: callerNumber,
      issueReason: NO_AI_SUMMARY_NOTE,
      summary: null,
      createdAt: pending.callStartedAt,
    };
    const recordInput: RecordInput = {
      businessId: pending.businessId,
      retellCallId: callId,
      callStartedAt: pending.callStartedAt,
      durationMs: pending.durationMs,
      outcome: "analysis_timeout",
      nameCaptured: null,
      callbackCaptured: null,
      issueCaptured: null,
      addressCaptured: null,
      analysisComplete: false,
    };
    const result = await reconcileCall(callId, pending.businessId, {
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
        return undefined;
      },
      async createLead(id) {
        const [lead] = await tx.insert(leadsTable).values({ ...leadInput, retellCallId: id }).returning();
        if (!lead) throw new Error("Fallback lead creation returned no record");
        return lead;
      },
      async linkLead(leadId, id) {
        await tx.update(leadsTable).set({ retellCallId: id }).where(eq(leadsTable.id, leadId));
      },
      async saveRecord(id, leadId) {
        await tx.insert(retellCallRecordsTable).values({ ...recordInput, retellCallId: id, leadId })
          .onConflictDoUpdate({
            target: retellCallRecordsTable.retellCallId,
            set: {
              leadId,
              callStartedAt: sql`COALESCE(${retellCallRecordsTable.callStartedAt}, ${recordInput.callStartedAt})`,
              durationMs: sql`COALESCE(${retellCallRecordsTable.durationMs}, ${recordInput.durationMs})`,
              outcome: sql`COALESCE(${retellCallRecordsTable.outcome}, ${recordInput.outcome})`,
            },
          });
      },
      async ensureNotification(leadId) {
        if (business.leadAlertsEnabled === false || business.isSample) return false;
        const caller = normalizeCallerNumber(leadInput.callerId) ?? normalizeCallerNumber(leadInput.phoneNumber);
        if (caller) {
          const [suppressedCaller] = await tx.select({ id: leadsTable.id }).from(leadsTable).where(and(
            eq(leadsTable.businessId, pending.businessId),
            eq(leadsTable.isSpam, true),
            eq(leadsTable.spamCallerNumber, caller),
          )).limit(1);
          if (suppressedCaller) return false;
        }
        const [event] = await tx.insert(notificationEventsTable).values({
          businessId: String(pending.businessId),
          leadId: String(leadId),
          title: "New lead from a caller",
          body: `${NO_AI_SUMMARY_NOTE} · Callback: ${callerNumber || "Not provided"}`,
          emailStatus: "queued",
          deepLink: `/leads/${leadId}`,
        }).onConflictDoNothing().returning({ id: notificationEventsTable.id });
        if (!event) return false;
        await enqueueWebPushDeliveries(tx, event.id, pending.businessId);
        return true;
      },
    });
    await tx.update(retellPendingCallsTable).set({
      status: "fallback_created",
      callerNumber: null,
      leadId: result.id,
      resolvedAt: now,
    }).where(and(
      eq(retellPendingCallsTable.retellCallId, callId),
      eq(retellPendingCallsTable.status, "pending"),
    ));
    return { leadId: result.id, businessId: pending.businessId, notify: result.notify };
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
    await tx.update(retellPendingCallsTable).set({ status: "resolved", callerNumber: null, resolvedAt: new Date() })
      .where(and(
        eq(retellPendingCallsTable.retellCallId, callId),
        inArray(retellPendingCallsTable.status, ["pending", "fallback_created"]),
      ));
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
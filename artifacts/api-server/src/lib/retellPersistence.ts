import { db, leadsTable, retellCallRecordsTable, notificationEventsTable } from "@workspace/db";
import { and, eq, gte, lte, isNull, sql } from "drizzle-orm";
import { reconcileCall } from "./callReconciliation";

type LeadInput = typeof leadsTable.$inferInsert;
type RecordInput = typeof retellCallRecordsTable.$inferInsert;

export async function persistAnalyzedCall(callId: string, leadInput: LeadInput, recordInput: RecordInput) {
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
      async saveRecord(id, leadId) {
        await tx.insert(retellCallRecordsTable).values({ ...recordInput, retellCallId: id, leadId })
          .onConflictDoUpdate({
            target: retellCallRecordsTable.retellCallId,
            set: { leadId, callStartedAt: recordInput.callStartedAt, durationMs: recordInput.durationMs, outcome: recordInput.outcome },
          });
      },
      async ensureNotification(leadId) {
        const name = leadInput.callerName?.split(/\s+/, 1)[0] || "Unknown caller";
        const inserted = await tx.insert(notificationEventsTable).values({
          businessId: String(leadInput.businessId), leadId: String(leadId),
          title: `New lead from ${name}`, body: leadInput.issueReason || "No details captured",
          deepLink: `/leads/${leadId}`,
        }).onConflictDoNothing().returning();
        return inserted.length === 1;
      },
    });
  });
}
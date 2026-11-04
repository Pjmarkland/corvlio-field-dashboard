import { getAuth } from "@clerk/express";
import { FlagLeadInformationBody, GetLeadDetailResponse, SetLeadSpamStatusBody, SetLeadSpamStatusResponse, UpdateLeadNotesBody } from "@workspace/api-zod";
import { db, leadInfoFlagsTable, leadsTable, notificationEventsTable, retellCallRecordsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { Router } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import { normalizeCallerNumber } from "../lib/callerNumber";
import { deleteRetellCall } from "../lib/retellCallDeletion";

const router = Router();

function normalizeDetailStatus(value: string | null | undefined): "new" | "called_back" | "booked" | "closed" {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "booked") return "booked";
  if (status === "closed") return "closed";
  if (["called_back", "contacted", "complete", "completed", "done"].includes(status)) return "called_back";
  return "new";
}

export function parseLeadId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** Both reads and writes require the authenticated business at the SQL boundary. */
export function ownedLeadFilter(leadId: number, businessId: number) {
  return and(eq(leadsTable.id, leadId), eq(leadsTable.businessId, businessId));
}

export async function loadOwnedLead(leadId: number, businessId: number) {
  const [lead] = await db.select().from(leadsTable)
    .where(ownedLeadFilter(leadId, businessId)).limit(1);
  if (!lead) return null;
  const [record] = await db.select().from(retellCallRecordsTable).where(and(
    eq(retellCallRecordsTable.businessId, businessId),
    lead.retellCallId
      ? eq(retellCallRecordsTable.retellCallId, lead.retellCallId)
      : eq(retellCallRecordsTable.leadId, leadId),
  )).limit(1);
  const urgency = (lead.urgencyLevel ?? "").toLowerCase();
  return GetLeadDetailResponse.parse({
    id: String(lead.id), name: lead.callerName ?? "",
    phone: lead.callbackNumber || lead.phoneNumber || "",
    issue: lead.issueReason ?? "", address: lead.address ?? "",
    urgency: /urgent|high|emergency|same.day/.test(urgency) ? "urgent"
      : /low|flexible|can wait|whenever/.test(urgency) ? "low" : "normal",
    status: normalizeDetailStatus(lead.status),
    createdAt: lead.createdAt, contactedAt: lead.contactedAt,
    callerId: lead.callerId, callbackNumber: lead.callbackNumber,
    availability: lead.availability, transcript: lead.transcript,
    summary: lead.summary, tradeIntakeAnswers: lead.tradeIntakeAnswers,
    callStartedAt: record?.callStartedAt ?? null,
    durationMs: record?.durationMs ?? null,
    capturedUrgency: lead.urgencyLevel,
    sentiment: lead.sentiment ?? null,
    recordingUrl: lead.recordingUrl ?? null,
    privateNotes: lead.privateNotes ?? null,
    contactedBy: lead.contactedBy ?? null,
    isSpam: lead.isSpam,
  });
}

router.use("/leads/:leadId", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie");
  next();
});

router.get("/leads/:leadId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const id = parseLeadId(req.params.leadId);
  if (id === null) { res.status(404).json({ error: "Lead not found" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    const lead = business ? await loadOwnedLead(id, business.id) : null;
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(lead);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Unable to load lead detail");
    res.status(502).json({ error: "Unable to load lead detail" });
  }
});

router.patch("/leads/:leadId/notes", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const id = parseLeadId(req.params.leadId);
  if (id === null) { res.status(404).json({ error: "Lead not found" }); return; }
  const input = UpdateLeadNotesBody.strict().safeParse(req.body);
   if (!input.success) { res.status(400).json({ error: "Notes must be text up to 500 characters" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "Lead not found" }); return; }
    const [updated] = await db.update(leadsTable)
      .set({ privateNotes: input.data.privateNotes.trim() ? input.data.privateNotes : null })
      .where(ownedLeadFilter(id, business.id)).returning({ id: leadsTable.id });
    if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
    const detail = await loadOwnedLead(id, business.id);
    if (!detail) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(detail);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Unable to save private lead notes");
    res.status(502).json({ error: "Unable to save private lead notes" });
  }
});

router.patch("/leads/:leadId/spam", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const id = parseLeadId(req.params.leadId);
  if (id === null) { res.status(404).json({ error: "Lead not found" }); return; }
  const input = SetLeadSpamStatusBody.strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Spam status must be a boolean" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "Lead not found" }); return; }
    const [lead] = await db.select({
      phoneNumber: leadsTable.phoneNumber,
      callerId: leadsTable.callerId,
      callbackNumber: leadsTable.callbackNumber,
    }).from(leadsTable).where(ownedLeadFilter(id, business.id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    const callerNumber = input.data.isSpam
      ? normalizeCallerNumber(lead.callerId)
        ?? normalizeCallerNumber(lead.phoneNumber)
        ?? normalizeCallerNumber(lead.callbackNumber)
      : null;
    const [updated] = await db.update(leadsTable).set({
      isSpam: input.data.isSpam,
      spamCallerNumber: callerNumber,
    }).where(ownedLeadFilter(id, business.id)).returning({ id: leadsTable.id });
    if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(SetLeadSpamStatusResponse.parse({ leadId: String(updated.id), isSpam: input.data.isSpam }));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Unable to update lead spam status");
    res.status(502).json({ error: "Unable to update lead spam status" });
  }
});

router.post("/leads/:leadId/flag", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const id = parseLeadId(req.params.leadId);
  if (id === null) { res.status(404).json({ error: "Lead not found" }); return; }
  const input = FlagLeadInformationBody.strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Optional flag reason must be 500 characters or fewer." }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business || !await loadOwnedLead(id, business.id)) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await db.insert(leadInfoFlagsTable).values({
      businessId: business.id,
      leadId: id,
      reason: input.data.reason?.trim() || null,
    }).onConflictDoNothing();
    res.json({ flagged: true });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Lead information flag could not be saved");
    res.status(502).json({ error: "Lead information flag could not be saved" });
  }
});

router.delete("/leads/:leadId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const id = parseLeadId(req.params.leadId);
  if (id === null) { res.status(404).json({ error: "Lead not found" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "Lead not found" }); return; }
    const [lead] = await db.select({ retellCallId: leadsTable.retellCallId })
      .from(leadsTable).where(ownedLeadFilter(id, business.id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    let callId = lead.retellCallId;
    if (!callId) {
      const [record] = await db.select({ retellCallId: retellCallRecordsTable.retellCallId })
        .from(retellCallRecordsTable)
        .where(and(eq(retellCallRecordsTable.businessId, business.id), eq(retellCallRecordsTable.leadId, id)))
        .limit(1);
      callId = record?.retellCallId ?? null;
    }
    if (callId) {
      try { await deleteRetellCall(callId); }
      catch (error) {
        req.log.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Retell call data deletion failed; lead remains available for retry");
        res.status(502).json({ error: "Call media could not be deleted. The lead was not removed; try again later." });
        return;
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(notificationEventsTable).where(and(
        eq(notificationEventsTable.businessId, String(business.id)),
        eq(notificationEventsTable.leadId, String(id)),
      ));
      await tx.delete(retellCallRecordsTable).where(and(
        eq(retellCallRecordsTable.businessId, business.id),
        callId
          ? or(eq(retellCallRecordsTable.leadId, id), eq(retellCallRecordsTable.retellCallId, callId))
          : eq(retellCallRecordsTable.leadId, id),
      ));
      await tx.delete(leadsTable).where(ownedLeadFilter(id, business.id));
    });
    res.status(204).end();
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Lead data could not be deleted");
    res.status(502).json({ error: "Lead data could not be deleted" });
  }
});

export default router;

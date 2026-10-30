import { getAuth } from "@clerk/express";
import { GetLeadDetailResponse, UpdateLeadNotesBody } from "@workspace/api-zod";
import { db, leadsTable, retellCallRecordsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";

const router = Router();

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
    status: /^(contacted|complete|completed|done)$/i.test(lead.status) ? "contacted" : "pending",
    createdAt: lead.createdAt, contactedAt: lead.contactedAt,
    callerId: lead.callerId, callbackNumber: lead.callbackNumber,
    availability: lead.availability, transcript: lead.transcript,
    summary: lead.summary, tradeIntakeAnswers: lead.tradeIntakeAnswers,
    callStartedAt: record?.callStartedAt ?? null,
    durationMs: record?.durationMs ?? null,
    capturedUrgency: lead.urgencyLevel,
    recordingUrl: lead.recordingUrl ?? null,
    privateNotes: lead.privateNotes ?? null,
    contactedBy: lead.contactedBy ?? null,
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
  if (!input.success) { res.status(400).json({ error: "Notes must be text up to 10,000 characters" }); return; }
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

export default router;

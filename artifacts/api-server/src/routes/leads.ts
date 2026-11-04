import { getAuth } from "@clerk/express";
import {
  GetLeadsResponse,
  UpdateLeadStatusBody,
  UpdateLeadStatusParams,
  UpdateLeadStatusResponse,
} from "@workspace/api-zod";
import { db, leadsTable } from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import { databaseErrorFields } from "@workspace/db/errors";

const router: IRouter = Router();
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const EMPTY_LEAD_SUMMARY = {
  totalLeads: 0,
  pendingLeads: 0,
  contactedLeads: 0,
  thisWeekLeads: 0,
  averageReplyMinutes: null,
};

function parsePaginationInteger(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

function safeTimeZone(value: string | null | undefined): string {
  if (!value) return "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "America/New_York";
  }
}

function normalizeUrgency(value: string | null): "urgent" | "normal" | "low" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["urgent", "high", "emergency", "same-day", "same day"].some((label) => normalized.includes(label))) {
    return "urgent";
  }
  if (["low", "flexible", "can wait", "whenever"].some((label) => normalized.includes(label))) {
    return "low";
  }
  return "normal";
}

function normalizeStatus(value: string | null): "pending" | "contacted" {
  return ["contacted", "complete", "completed", "done"].includes((value ?? "").trim().toLowerCase())
    ? "contacted"
    : "pending";
}

router.get("/leads", async (req, res): Promise<void> => {
  res.set({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
  });
  res.vary("Cookie");

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const page = parsePaginationInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = parsePaginationInteger(req.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (page === null || pageSize === null || !Number.isSafeInteger((page - 1) * pageSize)) {
    res.status(400).json({ error: "Invalid pagination parameters" });
    return;
  }

  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) {
      res.json(GetLeadsResponse.parse({
        configured: false,
        businessName: null,
        retellPhoneNumber: null,
        timeZone: "America/New_York",
        page,
        pageSize,
        hasMore: false,
        summary: EMPTY_LEAD_SUMMARY,
        leads: [],
      }));
      return;
    }

    const timeZone = safeTimeZone(business.timeZone);
    const leadFilter = eq(leadsTable.businessId, business.id);
    const [rows, [aggregate]] = await Promise.all([
      db
        .select({
          id: leadsTable.id,
          callerName: leadsTable.callerName,
          phoneNumber: leadsTable.phoneNumber,
          issueReason: leadsTable.issueReason,
          address: leadsTable.address,
          urgencyLevel: leadsTable.urgencyLevel,
          status: leadsTable.status,
          createdAt: leadsTable.createdAt,
          contactedAt: leadsTable.contactedAt,
          callerId: leadsTable.callerId,
          callbackNumber: leadsTable.callbackNumber,
          availability: leadsTable.availability,
          tradeIntakeAnswers: leadsTable.tradeIntakeAnswers,
        })
        .from(leadsTable)
        .where(leadFilter)
        .orderBy(desc(leadsTable.createdAt), desc(leadsTable.id))
        .limit(pageSize + 1)
        .offset((page - 1) * pageSize),
      db.select({
        totalLeads: count(),
        contactedLeads: sql<string>`COUNT(*) FILTER (
          WHERE LOWER(TRIM(${leadsTable.status})) IN ('contacted', 'complete', 'completed', 'done')
        )`,
        thisWeekLeads: sql<string>`COUNT(*) FILTER (
          WHERE ${leadsTable.createdAt} >=
            date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone}
        )`,
        averageReplyMinutes: sql<string | null>`AVG(
          EXTRACT(EPOCH FROM (${leadsTable.contactedAt} - ${leadsTable.createdAt})) / 60
        ) FILTER (
          WHERE ${leadsTable.contactedAt} IS NOT NULL
            AND ${leadsTable.contactedAt} >= ${leadsTable.createdAt}
        )`,
      }).from(leadsTable).where(leadFilter),
    ]);
    const hasMore = rows.length > pageSize;
    const leads = rows.slice(0, pageSize);

    res.json(GetLeadsResponse.parse({
      configured: true,
      isSample: business.isSample,
      provisioningState: business.isSample ? "sample" : business.retellPhoneNumber ? "ready" : business.provisioningState,
      businessName: business.businessName,
      retellPhoneNumber: business.retellPhoneNumber,
      timeZone,
      page,
      pageSize,
      hasMore,
      summary: {
        totalLeads: Number(aggregate.totalLeads),
        contactedLeads: Number(aggregate.contactedLeads),
        pendingLeads: Number(aggregate.totalLeads) - Number(aggregate.contactedLeads),
        thisWeekLeads: Number(aggregate.thisWeekLeads),
        averageReplyMinutes: aggregate.averageReplyMinutes === null
          ? null
          : Math.max(0, Math.round(Number(aggregate.averageReplyMinutes))),
      },
      leads: leads.map((lead) => ({
        id: String(lead.id),
        name: lead.callerName ?? "",
        phone: lead.phoneNumber ?? "",
        issue: lead.issueReason ?? "",
        address: lead.address ?? "",
        urgency: normalizeUrgency(lead.urgencyLevel),
        status: normalizeStatus(lead.status),
        createdAt: lead.createdAt,
        contactedAt: lead.contactedAt,
        callerId: lead.callerId,
        callbackNumber: lead.callbackNumber,
        availability: lead.availability,
        tradeIntakeAnswers: lead.tradeIntakeAnswers,
      })),
    }));
  } catch (error) {
    req.log.error(
      databaseErrorFields(error),
      "Unable to load database leads",
    );
    res.status(502).json({ error: "Unable to load leads" });
  }
});

router.patch("/leads/:leadId/status", async (req, res): Promise<void> => {
  res.set({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
  });
  res.vary("Cookie");

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = UpdateLeadStatusParams.safeParse(req.params);
  const body = UpdateLeadStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A valid lead ID and status are required" });
    return;
  }

  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) {
      res.status(403).json({ error: "No business is configured for this account" });
      return;
    }

    const leadId = Number(params.data.leadId);
    if (!Number.isSafeInteger(leadId) || leadId < 1) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const [updatedLead] = await db
      .update(leadsTable)
      .set({
        status: body.data.status,
        contactedAt: body.data.status === "contacted" ? new Date() : null,
        contactedBy: body.data.status === "contacted" ? userId : null,
      })
      .where(and(
        eq(leadsTable.id, leadId),
        eq(leadsTable.businessId, business.id),
      ))
      .returning({
        id: leadsTable.id,
        status: leadsTable.status,
        contactedAt: leadsTable.contactedAt,
      });

    if (!updatedLead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    res.json(UpdateLeadStatusResponse.parse({
      leadId: String(updatedLead.id),
      status: normalizeStatus(updatedLead.status),
      contactedAt: updatedLead.contactedAt,
    }));
  } catch (error) {
    req.log.error(
      databaseErrorFields(error),
      "Unable to update database lead status",
    );
    res.status(502).json({ error: "Unable to update lead status" });
  }
});

export default router;
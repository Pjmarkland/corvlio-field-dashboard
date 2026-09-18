import { getAuth } from "@clerk/express";
import {
  GetLeadsResponse,
  UpdateLeadStatusBody,
  UpdateLeadStatusParams,
  UpdateLeadStatusResponse,
} from "@workspace/api-zod";
import { db, leadsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";

const router: IRouter = Router();

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

  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) {
      res.json(GetLeadsResponse.parse({
        configured: false,
        businessName: null,
        retellPhoneNumber: null,
        timeZone: "America/New_York",
        leads: [],
      }));
      return;
    }

    const leads = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.businessId, business.id))
      .orderBy(desc(leadsTable.createdAt));

    res.json(GetLeadsResponse.parse({
      configured: true,
      businessName: business.businessName,
      retellPhoneNumber: business.retellPhoneNumber,
      timeZone: "America/New_York",
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
      })),
    }));
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : "Unknown database error",
      },
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
      {
        error: error instanceof Error ? error.message : "Unknown database error",
      },
      "Unable to update database lead status",
    );
    res.status(502).json({ error: "Unable to update lead status" });
  }
});

export default router;
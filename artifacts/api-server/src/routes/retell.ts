import {
  RetellPostCallWebhookBody,
  RetellPreCallWebhookBody,
} from "@workspace/api-zod";
import {
  db,
  leadsTable,
  notificationEventsTable,
} from "@workspace/db";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { findBusinessByPhoneNumber } from "../lib/businessDirectory";
import { sendLeadNotificationEmail } from "../lib/gmail";
import { runNotificationOutboxNow } from "../lib/notificationService";

const router: IRouter = Router();
const RETELL_API_KEY_ENV = "RETELL_API_KEY";

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function callPhoneNumber(call: { to_number?: string }, fallback?: string): string | null {
  return firstString(call.to_number, fallback);
}

function analysisValue(
  analysis: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!analysis) return null;
  return firstString(...keys.map((key) => analysis[key]));
}

function isValidRetellSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const apiKey = process.env[RETELL_API_KEY_ENV];
  if (!apiKey || !signatureHeader) return false;

  const match = /^v=(\d+),d=([a-f0-9]+)$/i.exec(signatureHeader.trim());
  if (!match) return false;

  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    return false;
  }

  const expectedSignature = createHmac("sha256", apiKey)
    .update(rawBody)
    .update(String(timestamp))
    .digest("hex");
  const providedSignature = match[2];
  const provided = Buffer.from(providedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function dynamicVariables(business: NonNullable<Awaited<ReturnType<typeof findBusinessByPhoneNumber>>>) {
  return {
    business_name: business.businessName,
    business_type: business.businessType ?? "",
    service_area: business.serviceArea ?? "",
    major_issue_examples: business.majorIssueExamples ?? "",
    pricing_policy: business.pricingPolicy ?? "",
    personality_tone_description: business.personalityToneDescription ?? "",
    services_not_offered: business.servicesNotOffered ?? "",
    financing_policy: business.financingPolicy ?? "",
    brands_worked_with: business.brandsWorkedWith ?? "",
    response_time_commitment: business.typicalResponseTimeCommitment ?? "",
    warranty_info: business.warrantyInfo ?? "",
    maintenance_plan_offerings: business.maintenancePlanOfferings ?? "",
    credentials: business.credentialsCertifications ?? "",
    owner_availability: business.ownerAvailability ?? "",
    emergency_contact_info: business.emergencyContactInfo ?? "",
  };
}

router.post("/webhooks/retell/pre-call", async (req, res): Promise<void> => {
  const body = RetellPreCallWebhookBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid Retell pre-call webhook payload");
    res.status(400).json({ error: "Invalid Retell pre-call webhook payload" });
    return;
  }

  const phoneNumber = callPhoneNumber(
    body.data.call_inbound ?? body.data.call ?? {},
    body.data.to_number,
  );
  if (!phoneNumber) {
    res.json({ call_inbound: { dynamic_variables: {} } });
    return;
  }

  try {
    const business = await findBusinessByPhoneNumber(phoneNumber);
    res.json({
      call_inbound: {
        dynamic_variables: business ? dynamicVariables(business) : {},
      },
    });
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown business lookup error" },
      "Retell pre-call business lookup failed",
    );
    res.status(502).json({ error: "Unable to load business configuration" });
  }
});

router.post("/webhooks/retell/post-call", async (req, res): Promise<void> => {
  const signature = req.get("x-retell-signature");
  if (!req.rawBody || !isValidRetellSignature(req.rawBody, signature)) {
    req.log.warn("Rejected Retell post-call webhook with invalid signature");
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }

  const body = RetellPostCallWebhookBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid Retell post-call webhook payload");
    res.status(400).json({ error: "Invalid Retell post-call webhook payload" });
    return;
  }

  if (body.data.event !== "call_analyzed") {
    res.sendStatus(204);
    return;
  }

  const call = body.data.call;
  const phoneNumber = call ? callPhoneNumber(call) : null;
  if (!call || !phoneNumber) {
    req.log.warn("Retell call_analyzed webhook is missing call phone numbers");
    res.status(400).json({ error: "Retell call phone number is required" });
    return;
  }

  try {
    const business = await findBusinessByPhoneNumber(phoneNumber);
    if (!business) {
      req.log.info({ phoneNumber }, "Ignoring Retell call for an unknown business");
      res.sendStatus(204);
      return;
    }

    const analysis = call.call_analysis?.custom_analysis_data;
    const callerName = analysisValue(analysis, "caller_name", "customer_name", "name");
    const callerPhoneNumber = firstString(
      call.from_number,
      analysisValue(analysis, "phone_number", "caller_phone_number"),
    );
    const issueReason = analysisValue(analysis, "issue_reason", "issue", "reason", "call_reason");
    const address = analysisValue(analysis, "address", "service_address");
    const urgencyLevel = analysisValue(analysis, "urgency_level", "urgency");
    const availability = analysisValue(
      analysis,
      "availability",
      "preferred_availability",
      "preferred_time",
    );

    const lead = await db.transaction(async (tx) => {
      const [createdLead] = await tx
        .insert(leadsTable)
        .values({
          businessId: business.id,
          callerName,
          phoneNumber: callerPhoneNumber,
          issueReason,
          address,
          urgencyLevel,
          availability,
        })
        .returning({ id: leadsTable.id });

      if (!createdLead) throw new Error("Lead creation did not return a record");

      const firstName = callerName?.split(/\s+/, 1)[0] || "A new caller";
      await tx.insert(notificationEventsTable).values({
        businessId: String(business.id),
        leadId: String(createdLead.id),
        title: `New lead from ${firstName}`,
        body: issueReason || "A new receptionist lead is waiting.",
        deepLink: `/leads/${encodeURIComponent(String(createdLead.id))}`,
      }).onConflictDoNothing();

      return createdLead;
    });

    void sendLeadNotificationEmail({
      ownerEmail: business.ownerEmail,
      callerName,
      phoneNumber: callerPhoneNumber,
      issue: issueReason,
    }).catch((error) => {
      req.log.error(
        {
          leadId: lead.id,
          businessId: business.id,
          error: error instanceof Error ? error.message : "Unknown Gmail error",
        },
        "Retell lead email notification failed",
      );
    });

    void runNotificationOutboxNow().catch((error) => {
      req.log.error(
        {
          leadId: lead.id,
          businessId: business.id,
          error: error instanceof Error ? error.message : "Unknown outbox error",
        },
        "Immediate Retell notification delivery failed",
      );
    });

    res.sendStatus(204);
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown Retell post-call error" },
      "Retell post-call processing failed",
    );
    res.status(500).json({ error: "Unable to process Retell post-call webhook" });
  }
});

export default router;
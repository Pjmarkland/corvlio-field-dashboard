import {
  RetellPostCallWebhookBody,
  RetellPreCallWebhookBody,
} from "@workspace/api-zod";
import type { RetellCall } from "@workspace/api-zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { findBusinessByPhoneNumber } from "../lib/businessDirectory";
import { runNotificationOutboxNow } from "../lib/notificationService";
import { persistAnalyzedCall } from "../lib/retellPersistence";
import { extractRetellLead } from "../lib/retellLeadData";
import { businessClock, DEFAULT_BUSINESS_HOURS, DEFAULT_TIME_ZONE } from "../lib/businessHours";

const router: IRouter = Router();
const RETELL_API_KEY_ENV = "RETELL_API_KEY";
const DEFAULT_AGENT_NAME = "Aria";

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

function callStartedAt(timestamp: number | undefined): Date | null {
  if (
    timestamp === undefined
    || !Number.isSafeInteger(timestamp)
    || timestamp < 0
    || timestamp > 8_640_000_000_000_000
  ) {
    return null;
  }
  return new Date(timestamp);
}

function callDurationMs(duration: number | undefined): number | null {
  if (duration === undefined || !Number.isSafeInteger(duration) || duration < 0) return null;
  return duration;
}

function callOutcome(call: RetellCall): string | null {
  const reason = call.disconnection_reason?.trim();
  if (reason) return reason;

  const successful = call.call_analysis?.call_successful;
  if (typeof successful === "boolean") return successful ? "successful" : "unsuccessful";
  return null;
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
  if (providedSignature.length !== 64) return false;
  const provided = Buffer.from(providedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function dynamicVariables(
  business: NonNullable<Awaited<ReturnType<typeof findBusinessByPhoneNumber>>> | null,
) {
  const savedName = business?.agentName?.trim();
  const agentName = savedName && !/^(agent_name|\{\{.*\}\})$/i.test(savedName) ? savedName : null;
  const hours = business?.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const timeZone = business?.timeZone ?? DEFAULT_TIME_ZONE;
  return {
    business_hours: business ? hours : "",
    time_zone: business ? timeZone : "",
    ...(business ? businessClock(hours, timeZone) : { current_local_time: "", business_is_open: "unknown", next_opening: "" }),
    transfer_available: "false",
    agent_name: agentName || DEFAULT_AGENT_NAME,
    business_name: business?.businessName ?? "",
    business_type: business?.businessType ?? "",
    service_area: business?.serviceArea ?? "",
    major_issue_examples: business?.majorIssueExamples ?? "",
    pricing_policy: business?.pricingPolicy ?? "",
    personality_tone_description: business?.personalityToneDescription ?? "",
    services_not_offered: business?.servicesNotOffered ?? "",
    financing_policy: business?.financingPolicy ?? "",
    brands_worked_with: business?.brandsWorkedWith ?? "",
    response_time_commitment: business?.typicalResponseTimeCommitment ?? "",
    warranty_info: business?.warrantyInfo ?? "",
    maintenance_plan_offerings: business?.maintenancePlanOfferings ?? "",
    credentials: business?.credentialsCertifications ?? "",
    owner_availability: business?.ownerAvailability ?? "",
    emergency_contact_info: business?.emergencyContactInfo ?? "",
  };
}

router.post("/webhooks/retell/pre-call", async (req, res): Promise<void> => {
  const signature = req.get("x-retell-signature");
  if (signature !== undefined) {
    if (!req.rawBody || !isValidRetellSignature(req.rawBody, signature)) {
      req.log.warn("Rejected Retell pre-call webhook with invalid signature");
      res.status(401).json({ error: "Invalid Retell signature" });
      return;
    }
  } else {
    req.log.warn("Retell pre-call signature missing; allowing during compatibility rollout");
  }
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
    res.json({ call_inbound: { dynamic_variables: dynamicVariables(null) } });
    return;
  }

  try {
    const business = await findBusinessByPhoneNumber(phoneNumber);
    res.json({
      call_inbound: {
        dynamic_variables: dynamicVariables(business ?? null),
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

  // Inspect signed raw fields before Zod strips provider fields. All outbound
  // calls are excluded from inbound customer leads, even if metadata is absent.
  const rawCall = req.body?.call;
  if (rawCall?.direction === "outbound" || rawCall?.metadata?.corvlio_call_type === "owner_test") {
    res.sendStatus(204);
    return;
  }

  const body = RetellPostCallWebhookBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid Retell post-call webhook payload");
    res.status(400).json({ error: "Invalid Retell post-call webhook payload" });
    return;
  }

  if (!["call_analyzed", "call_ended"].includes(body.data.event ?? "")) {
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
    if (body.data.event === "call_ended" && !call.call_id) {
      req.log.warn("Call-ended webhook missing call ID; waiting for analyzed event to avoid duplicate legacy leads");
      res.sendStatus(204);
      return;
    }

    const details = extractRetellLead(call);
    const retellCallId = firstString(call.call_id)
      ?? `legacy-${createHash("sha256").update(JSON.stringify(call)).digest("hex")}`;
    if (!call.call_id) req.log.warn("Retell call ID missing; using legacy payload fingerprint");
    const lead = await persistAnalyzedCall(retellCallId, {
      businessId: business.id, ...details,
    }, {
      businessId: business.id, retellCallId,
      callStartedAt: callStartedAt(call.start_timestamp),
      durationMs: callDurationMs(call.duration_ms),
      outcome: callOutcome(call),
    }, body.data.event === "call_analyzed", business.leadAlertsEnabled !== false && !business.isSample);

    if (lead.notify) {
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
    }

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
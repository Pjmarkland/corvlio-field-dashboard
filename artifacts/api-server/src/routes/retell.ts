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
import { capturedInfo, extractRetellLead } from "../lib/retellLeadData";
import { dynamicVariables } from "../lib/retellVariables";
import { recordOperationalFailure } from "../lib/operationalFailures";

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

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasMeaningfulValue);
  }
  return false;
}

function isBlankCall(call: RetellCall): boolean {
  return call.status?.trim().toLowerCase() === "error"
    || (call.duration_ms !== undefined && call.duration_ms <= 0)
    || !hasMeaningfulValue(call.call_analysis);
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

async function recordPostCallFailure(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  input: {
    summary: string;
    details: string;
    businessId?: number;
    businessName?: string;
  },
): Promise<void> {
  try {
    const rawBody = req.rawBody ?? Buffer.from("");
    const eventKey = `retell-post-call:${createHash("sha256").update(rawBody).digest("hex")}`;
    const inserted = await recordOperationalFailure({
      eventKey,
      source: "post_call_webhook",
      ...input,
    });
    if (inserted) {
      void runNotificationOutboxNow().catch((error) => {
        req.log.error(
          { error: error instanceof Error ? error.message : "Unknown outbox error" },
          "Could not deliver the post-call failure alert immediately",
        );
      });
    }
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown operational failure error" },
      "Could not record the failed post-call webhook for admin review",
    );
  }
}

router.post("/webhooks/retell/pre-call", async (req, res): Promise<void> => {
  const signature = req.get("x-retell-signature");
  if (!req.rawBody || !isValidRetellSignature(req.rawBody, signature)) {
    req.log.warn("Rejected Retell pre-call webhook with missing or invalid signature");
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
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
    req.log.warn("Retell pre-call webhook has no destination number; using generic message fallback");
    res.json({ call_inbound: { dynamic_variables: dynamicVariables(null) } });
    return;
  }

  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const business = await Promise.race([
      Promise.resolve().then(() => findBusinessByPhoneNumber(phoneNumber)),
      new Promise<never>((_resolve, reject) => {
        lookupTimer = setTimeout(() => reject(new Error("Business lookup exceeded the 3500ms pre-call deadline")), 3500);
        lookupTimer.unref();
      }),
    ]);
    if (!business) {
      req.log.warn("No business matched the inbound number; using generic message fallback");
    }
    res.json({
      call_inbound: {
        dynamic_variables: dynamicVariables(business ?? null),
      },
    });
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown business lookup error" },
      "Retell pre-call business lookup failed; answering with generic no-business variables",
    );
    res.status(200).json({ call_inbound: { dynamic_variables: dynamicVariables(null) } });
  } finally {
    if (lookupTimer) clearTimeout(lookupTimer);
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
    await recordPostCallFailure(req, {
      summary: "Post-call webhook payload was invalid",
      details: "The signed payload did not match the expected Retell post-call shape.",
    });
    res.status(400).json({ error: "Invalid Retell post-call webhook payload" });
    return;
  }

  if (!["call_analyzed", "call_ended"].includes(body.data.event ?? "")) {
    res.sendStatus(204);
    return;
  }

  const call = body.data.call;
  if (!call) {
    req.log.warn("Retell post-call webhook is missing the call object");
    await recordPostCallFailure(req, {
      summary: "Post-call webhook is missing its call object",
      details: "The signed payload did not contain a call object.",
    });
    res.status(400).json({ error: "Retell call object is required" });
    return;
  }
  if (isBlankCall(call)) {
    req.log.info(
      {
        callId: call.call_id ?? null,
        status: call.status ?? null,
        durationMs: call.duration_ms ?? null,
        hasCallAnalysis: hasMeaningfulValue(call.call_analysis),
      },
      "Ignoring error, zero-duration, or empty-analysis Retell call",
    );
    res.sendStatus(204);
    return;
  }

  const phoneNumber = call ? callPhoneNumber(call) : null;
  if (!phoneNumber) {
    req.log.warn("Retell call_analyzed webhook is missing call phone numbers");
    await recordPostCallFailure(req, {
      summary: "Post-call webhook is missing a phone number",
      details: "The signed call could not be matched because it had no destination number.",
    });
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
      ...capturedInfo(call, body.data.event === "call_analyzed"),
      analysisComplete: body.data.event === "call_analyzed",
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
    const details = error instanceof Error ? error.message : "Unknown Retell post-call processing error";
    req.log.error(
      { error: details },
      "Retell post-call processing failed",
    );
    await recordPostCallFailure(req, {
      summary: "Post-call webhook processing failed",
      details,
    });
    res.status(500).json({ error: "Unable to process Retell post-call webhook" });
  }
});

export default router;
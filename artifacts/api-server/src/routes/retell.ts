import { databaseErrorFields } from "@workspace/db/errors";
import {
  RetellPostCallWebhookBody,
  RetellPreCallWebhookBody,
} from "@workspace/api-zod";
import type { RetellCall } from "@workspace/api-zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { findBusinessByPhoneNumber } from "../lib/businessDirectory";
import { runNotificationOutboxNow } from "../lib/notificationService";
import {
  persistAnalyzedCall,
  persistBlankCall,
  persistPendingRetellCall,
  RETELL_PENDING_CALL_MIN_DURATION_MS,
} from "../lib/retellPersistence";
import { sendOwnerLeadSms } from "../lib/ownerSms";
import { capturedInfo, extractRetellLead } from "../lib/retellLeadData";
import { dynamicVariables } from "../lib/retellVariables";
import { queueFounderPushNotification, recordOperationalFailure } from "../lib/operationalFailures";
import type { OperationalFailureSource } from "../lib/operationalFailures";
import { alertRejectedRetellWebhook } from "../lib/retellWebhookAlerts";
import {
  DEFAULT_FALLBACK_PHONE_NUMBER,
  getDefaultFallbackPhoneNumber,
} from "../lib/fallbackPhoneSettings";
import {
  recordRetellSystemAlert,
  recordRetellWebhookSuccess,
} from "../lib/retellSystemAlerts";
import {
  claimRetellWebhookEvent,
  completeRetellWebhookEvent,
  markRetellWebhookEventFailed,
  type RetellEventType,
} from "../lib/retellWebhookEventStore";
import { maskPhoneNumber, redactSensitiveText } from "../lib/privacyRedaction";

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

function retellPhoneIssueKey(kind: string, phoneNumber: string): string {
  const normalized = phoneNumber.replace(/\D/g, "");
  const digest = createHash("sha256").update(normalized || phoneNumber).digest("hex").slice(0, 16);
  return `retell:${kind}:${digest}`;
}

function phoneSuffix(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "").slice(-4);
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

function isPendingCallEnded(event: string | undefined, call: RetellCall): boolean {
  return event === "call_ended"
    && call.status?.trim().toLowerCase() !== "error"
    && !(call.duration_ms !== undefined && call.duration_ms <= 0)
    && !hasMeaningfulValue(call.call_analysis);
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

async function recordRetellFailure(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  eventPrefix: string,
  source: Extract<OperationalFailureSource, "pre_call_fallback" | "post_call_webhook">,
  input: {
    summary: string;
    details: string;
    businessId?: number;
    businessName?: string;
    eventKey?: string;
    suppressAlert?: boolean;
    systemAlert?: { issueKey: string; category: string; summary?: string; details?: string; maskedCallerNumber?: string };
    founderPush?: {
      eventKey: string;
      title: string;
      body: string;
      deepLink: string;
    };
  },
): Promise<void> {
  try {
    if (input.systemAlert) {
      await recordRetellSystemAlert({
        issueKey: input.systemAlert.issueKey,
        endpoint: source === "pre_call_fallback" ? "pre-call" : "post-call",
        category: input.systemAlert.category,
        summary: input.systemAlert.summary ?? input.summary,
        details: input.systemAlert.details ?? input.details,
        source,
        businessId: input.businessId,
        businessName: input.businessName,
        maskedCallerNumber: input.systemAlert.maskedCallerNumber,
      });
      return;
    }
    const rawBody = req.rawBody ?? Buffer.from("");
    const eventKey = input.eventKey
      ?? `${eventPrefix}:${createHash("sha256").update(rawBody).digest("hex")}`;
    const inserted = await recordOperationalFailure({
      eventKey,
      source,
      summary: input.summary,
      details: input.details,
      businessId: input.businessId,
      businessName: input.businessName,
      suppressAlert: input.suppressAlert,
    });
    const pushInserted = input.founderPush
      ? await queueFounderPushNotification(input.founderPush)
      : false;
    if (inserted || pushInserted) {
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

function recordPostCallFailure(
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  input: {
    summary: string;
    details: string;
    businessId?: number;
    businessName?: string;
    eventKey?: string;
    suppressAlert?: boolean;
    systemAlert?: { issueKey: string; category: string; summary?: string; details?: string };
    founderPush?: {
      eventKey: string;
      title: string;
      body: string;
      deepLink: string;
    };
  },
): Promise<void> {
  return recordRetellFailure(req, "retell-post-call", "post_call_webhook", input);
}

router.post("/webhooks/retell/pre-call", async (req, res): Promise<void> => {
  const signature = req.get("x-retell-signature");
  if (signature === undefined) {
    req.log.warn("Accepted Retell pre-call webhook without a signature during rollout");
  } else if (!req.rawBody || !isValidRetellSignature(req.rawBody, signature)) {
    await alertRejectedRetellWebhook("pre-call", "invalid_signature");
    req.log.warn("Rejected Retell pre-call webhook with an invalid signature");
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }
  const body = RetellPreCallWebhookBody.safeParse(req.body);
  if (!body.success) {
    await alertRejectedRetellWebhook("pre-call", "malformed_payload");
    req.log.warn({ error: body.error.flatten() }, "Invalid Retell pre-call webhook payload");
    res.status(400).json({ error: "Invalid Retell pre-call webhook payload" });
    return;
  }

  const phoneNumber = callPhoneNumber(
    body.data.call_inbound ?? body.data.call ?? {},
    body.data.to_number,
  );
  const preCall = (body.data.call_inbound ?? body.data.call ?? {}) as { from_number?: unknown };
  const callerNumber = firstString(preCall.from_number);
  if (!phoneNumber) {
    req.log.warn("Retell pre-call webhook has no destination number; using generic message fallback");
    await alertRejectedRetellWebhook("pre-call", "malformed_payload");
    res.json({ call_inbound: { dynamic_variables: dynamicVariables(null) } });
    return;
  }

  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [business, defaultFallbackPhoneNumber] = await Promise.race([
      Promise.all([
        Promise.resolve().then(() => findBusinessByPhoneNumber(phoneNumber)),
        getDefaultFallbackPhoneNumber().catch((error) => {
          req.log.error(
            { errorName: error instanceof Error ? error.name : "UnknownError" },
            "Could not load the default fallback phone number; using the built-in default",
          );
          return DEFAULT_FALLBACK_PHONE_NUMBER;
        }),
      ]),
      new Promise<never>((_resolve, reject) => {
        lookupTimer = setTimeout(() => reject(new Error("Business lookup exceeded the 3500ms pre-call deadline")), 3500);
        lookupTimer.unref();
      }),
    ]);
    if (!business) {
      req.log.warn("No business matched the inbound number; using generic message fallback");
      const suffix = phoneSuffix(phoneNumber);
      await recordRetellSystemAlert({
        issueKey: retellPhoneIssueKey("pre-call-unmatched-business", phoneNumber),
        endpoint: "pre-call",
        category: "unmatched_business",
        summary: "Inbound call number did not match a business",
        details: `No business is configured for this inbound number${suffix ? ` ending in ${suffix}` : ""}.`,
        source: "pre_call_fallback",
      });
    } else {
      void recordRetellWebhookSuccess("pre-call");
    }
    const availableBusiness = business && business.accountStatus !== "suspended" ? business : null;
    res.json({
      call_inbound: {
        dynamic_variables: dynamicVariables(
          availableBusiness,
          business?.fallbackPhoneNumber ?? defaultFallbackPhoneNumber,
        ),
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown business lookup error";
    const timedOut = details.includes("3500ms pre-call deadline");
    req.log.error(
      databaseErrorFields(error),
      "Retell pre-call business lookup failed; answering with generic no-business variables",
    );
    await recordRetellFailure(req, "retell-pre-call", "pre_call_fallback", {
      summary: "Inbound business lookup failed; generic fallback used",
      details,
      systemAlert: {
        issueKey: timedOut ? "retell:pre-call:business-lookup-timeout" : "retell:pre-call:business-lookup-error",
        category: timedOut ? "pre_call_timeout" : "pre_call_error",
        maskedCallerNumber: callerNumber ? maskPhoneNumber(callerNumber) : undefined,
      },
    });
    res.status(200).json({
      call_inbound: {
        dynamic_variables: dynamicVariables(null, DEFAULT_FALLBACK_PHONE_NUMBER),
      },
    });
  } finally {
    if (lookupTimer) clearTimeout(lookupTimer);
  }
});

router.post("/webhooks/retell/post-call", async (req, res): Promise<void> => {
  const signature = req.get("x-retell-signature");
  if (signature === undefined) {
    req.log.warn("Accepted Retell post-call webhook without a signature during rollout");
  } else if (!req.rawBody || !isValidRetellSignature(req.rawBody, signature)) {
    await alertRejectedRetellWebhook("post-call", "invalid_signature");
    req.log.warn("Rejected Retell post-call webhook with an invalid signature");
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }

  // Inspect signed raw fields before Zod strips provider fields. All outbound
  // calls are excluded from inbound customer leads, even if metadata is absent.
  const rawCall = req.body?.call;
  if (rawCall?.direction === "outbound" || rawCall?.metadata?.corvlio_call_type === "owner_test") {
    void recordRetellWebhookSuccess("post-call");
    res.sendStatus(204);
    return;
  }

  const body = RetellPostCallWebhookBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid Retell post-call webhook payload");
    await alertRejectedRetellWebhook("post-call", "malformed_payload");
    res.status(400).json({ error: "Invalid Retell post-call webhook payload" });
    return;
  }

  if (!["call_analyzed", "call_ended"].includes(body.data.event ?? "")) {
    void recordRetellWebhookSuccess("post-call");
    res.sendStatus(204);
    return;
  }

  const call = body.data.call;
  if (!call) {
    req.log.warn("Retell post-call webhook is missing the call object");
    await alertRejectedRetellWebhook("post-call", "malformed_payload");
    res.status(400).json({ error: "Retell call object is required" });
    return;
  }
  const pendingCallEnded = isPendingCallEnded(body.data.event, call);
  const providerCallId = firstString(call.call_id);
  const durationMs = callDurationMs(call.duration_ms);
  if (pendingCallEnded && (
    !providerCallId
    || durationMs === null
    || durationMs < RETELL_PENDING_CALL_MIN_DURATION_MS
  )) {
    void recordRetellWebhookSuccess("post-call");
    res.sendStatus(204);
    return;
  }
  const phoneNumber = callPhoneNumber(call);
  if (!phoneNumber) {
    req.log.warn("Retell call_analyzed webhook is missing call phone numbers");
    await alertRejectedRetellWebhook("post-call", "malformed_payload");
    res.status(400).json({ error: "Retell call phone number is required" });
    return;
  }

  const eventType = body.data.event as RetellEventType;
  const retellCallId = providerCallId
    ?? `legacy-${createHash("sha256").update(JSON.stringify(call)).digest("hex")}`;
  let eventClaimed = false;
  const completeClaimedEvent = async () => {
    if (!eventClaimed) return;
    await completeRetellWebhookEvent(retellCallId, eventType);
    eventClaimed = false;
  };
  let processingBusiness: { id: number; businessName: string } | null = null;
  try {
    const claimed = await claimRetellWebhookEvent(retellCallId, eventType);
    if (!claimed) {
      void recordRetellWebhookSuccess("post-call");
      res.sendStatus(204);
      return;
    }
    eventClaimed = true;

    const business = await findBusinessByPhoneNumber(phoneNumber);
    processingBusiness = business
      ? { id: business.id, businessName: business.businessName }
      : null;
    const startedAt = callStartedAt(call.start_timestamp);
    const occurredAt = startedAt ?? new Date();

    if (!business) {
      if (pendingCallEnded) {
        await completeClaimedEvent();
        void recordRetellWebhookSuccess("post-call");
        res.sendStatus(204);
        return;
      }
      const eventKey = `retell-unmatched:${retellCallId}`;
      const durationText = durationMs === null ? "unknown" : `${Math.round(durationMs / 1000)} sec`;
      await recordPostCallFailure(req, {
        eventKey,
        summary: isBlankCall(call) ? "Blank or failed call" : "Retell post-call webhook for unmatched number",
        details: `Called number: ${maskPhoneNumber(phoneNumber)}; call time: ${occurredAt.toISOString()}; duration: ${durationText}; business: unmatched number.`,
        systemAlert: {
          issueKey: retellPhoneIssueKey("post-call-unmatched-business", phoneNumber),
          category: "unmatched_business",
          summary: "Post-call event did not match a business",
          details: `A post-call event could not be associated with a configured business${phoneSuffix(phoneNumber) ? `; destination ends in ${phoneSuffix(phoneNumber)}` : ""}.`,
        },
        founderPush: {
          eventKey,
          title: "Unmatched Retell call",
          body: "A call could not be matched to a configured business. Review webhook routing.",
          deepLink: "/dashboard",
        },
      });
      await completeClaimedEvent();
      res.sendStatus(204);
      return;
    }

    // Suspension may take effect after the pre-call lookup but before analysis.
    // Complete the provider event without persisting any customer data.
    if (business.accountStatus === "suspended") {
      await completeClaimedEvent();
      void recordRetellWebhookSuccess("post-call");
      res.sendStatus(204);
      return;
    }

    if (pendingCallEnded && providerCallId && durationMs !== null) {
      await persistPendingRetellCall({
        callId: providerCallId,
        businessId: business.id,
        callerNumber: firstString(call.from_number),
        callStartedAt: occurredAt,
        durationMs,
      });
      await completeClaimedEvent();
      void recordRetellWebhookSuccess("post-call");
      res.sendStatus(204);
      return;
    }

    if (isBlankCall(call)) {
      req.log.info(
        {
          callId: retellCallId,
          businessId: business.id,
          status: call.status ?? null,
          durationMs,
        },
        "Recording blank or failed Retell call",
      );
      const recorded = await persistBlankCall(retellCallId, {
        businessId: business.id,
        callStartedAt: startedAt,
        durationMs,
      });
      if (recorded.inserted) {
        const details = `Called number: ${maskPhoneNumber(phoneNumber)}; call time: ${occurredAt.toISOString()}; duration: ${durationMs === null ? "unknown" : `${Math.round(durationMs / 1000)} sec`}; status: ${call.status?.trim() || "unknown"}.`;
        await recordPostCallFailure(req, {
          eventKey: `retell-blank:${retellCallId}`,
          summary: "Blank or failed call",
          details,
          businessId: business.id,
          businessName: business.businessName,
          suppressAlert: true,
        });

        if (recorded.triggerStreakAlert && recorded.streakStartCallId) {
          const eventKey = `retell-blank-streak:${business.id}:${recorded.streakStartCallId}`;
          await recordPostCallFailure(req, {
            eventKey,
            summary: "Three consecutive blank or failed calls",
            details: `Business: ${business.businessName}; latest called number: ${maskPhoneNumber(phoneNumber)}; latest call time: ${occurredAt.toISOString()}.`,
            businessId: business.id,
            businessName: business.businessName,
            founderPush: {
              eventKey,
              title: "Repeated blank or failed calls",
              body: `${business.businessName} has had at least three consecutive blank or failed calls.`,
              deepLink: "/dashboard",
            },
          });
        }
      }
      await completeClaimedEvent();
      void recordRetellWebhookSuccess("post-call");
      res.sendStatus(204);
      return;
    }

    if (body.data.event === "call_ended" && !call.call_id) {
      req.log.warn("Call-ended webhook missing call ID; waiting for analyzed event to avoid duplicate legacy leads");
      await completeClaimedEvent();
      void recordRetellWebhookSuccess("post-call");
      res.sendStatus(204);
      return;
    }

    const details = extractRetellLead(call);
    if (!call.call_id) req.log.warn("Retell call ID missing; using legacy payload fingerprint");
    const lead = await persistAnalyzedCall(retellCallId, {
      businessId: business.id, ...details,
    }, {
      businessId: business.id, retellCallId,
      callStartedAt: startedAt,
      durationMs,
      outcome: callOutcome(call),
      ...capturedInfo(call, body.data.event === "call_analyzed"),
      analysisComplete: body.data.event === "call_analyzed",
    }, body.data.event === "call_analyzed", business.leadAlertsEnabled !== false && !business.isSample);

    if (!lead) {
      await completeClaimedEvent();
      void recordRetellWebhookSuccess("post-call");
      res.sendStatus(204);
      return;
    }
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
    void sendOwnerLeadSms(business.id, lead.id).catch(() => {
      req.log.warn(
        { leadId: lead.id, businessId: business.id },
        "Owner SMS alert failed without affecting other lead notifications",
      );
    });
    }

    await completeClaimedEvent();
    void recordRetellWebhookSuccess("post-call");
    res.sendStatus(204);
  } catch (error) {
    if (eventClaimed) {
      await markRetellWebhookEventFailed(retellCallId, eventType).catch(() => undefined);
    }
    const details = redactSensitiveText(
      error instanceof Error ? error.message : "Unknown Retell post-call processing error",
    );
    req.log.error(
      databaseErrorFields(error),
      "Retell post-call processing failed",
    );
    await recordPostCallFailure(req, {
      summary: "Post-call webhook processing failed",
      details,
      businessId: processingBusiness?.id,
      businessName: processingBusiness?.businessName,
      systemAlert: {
        issueKey: `retell:post-call:processing-error:${processingBusiness?.id ?? "unknown"}`,
        category: "post_call_processing_error",
      },
    });
    res.status(500).json({ error: "Unable to process Retell post-call webhook" });
  }
});

export default router;
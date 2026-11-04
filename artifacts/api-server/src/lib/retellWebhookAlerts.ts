import type { ErrorRequestHandler } from "express";
import { recordRetellSystemAlert } from "./retellSystemAlerts";
import { logger } from "./logger";

export type RetellWebhookEndpoint = "pre-call" | "post-call";
export type RetellWebhookRejection = "invalid_signature" | "malformed_payload" | "payload_too_large";

/**
 * Store the rejection without retaining the request body, signature, or source IP.
 * The system-alert recorder deduplicates the issue across API instances.
 */
export async function alertRejectedRetellWebhook(
  endpoint: RetellWebhookEndpoint,
  reason: RetellWebhookRejection,
): Promise<void> {
  const label = reason === "invalid_signature"
    ? "invalid signature"
    : reason === "payload_too_large" ? "payload too large" : "malformed payload";
  try {
    await recordRetellSystemAlert({
      issueKey: `retell:${endpoint}:${reason}`,
      endpoint,
      category: reason,
      summary: `Rejected Retell ${endpoint} webhook: ${label}`,
      details: reason === "invalid_signature"
        ? "A Retell webhook was rejected because its signature was missing, invalid, expired, or did not match the request body."
        : reason === "payload_too_large"
          ? "A Retell webhook exceeded the configured request size limit and was rejected before processing."
          : "A Retell webhook was rejected because its JSON or payload shape was malformed.",
      source: endpoint === "pre-call" ? "pre_call_fallback" : "post_call_webhook",
    });
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not record a rejected Retell webhook for admin review",
    );
  }
}

export const retellMalformedJsonAlertHandler: ErrorRequestHandler = (error, req, res, next) => {
  const endpoint = req.originalUrl?.split("?")[0].match(/\/webhooks\/retell\/(pre-call|post-call)$/)?.[1];
  const parseFailure = error && typeof error === "object"
    && "type" in error && error.type === "entity.parse.failed";
  const tooLarge = error && typeof error === "object"
    && "type" in error && error.type === "entity.too.large";
  if ((!parseFailure && !tooLarge) || (endpoint !== "pre-call" && endpoint !== "post-call")) {
    next(error);
    return;
  }
  void alertRejectedRetellWebhook(endpoint, tooLarge ? "payload_too_large" : "malformed_payload");
  if (tooLarge) {
    res.status(413).json({ error: "Retell webhook payload exceeds the allowed size." });
    return;
  }
  res.status(400).json({ error: "Invalid Retell webhook JSON." });
};

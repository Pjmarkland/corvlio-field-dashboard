import type { ErrorRequestHandler } from "express";
import { recordRetellSystemAlert } from "./retellSystemAlerts";
import { logger } from "./logger";

export type RetellWebhookEndpoint = "pre-call" | "post-call";
export type RetellWebhookRejection = "invalid_signature" | "malformed_payload";

/**
 * Store the rejection without retaining the request body, signature, or source IP.
 * The system-alert recorder deduplicates the issue across API instances.
 */
export async function alertRejectedRetellWebhook(
  endpoint: RetellWebhookEndpoint,
  reason: RetellWebhookRejection,
): Promise<void> {
  const label = reason === "invalid_signature" ? "invalid signature" : "malformed payload";
  try {
    await recordRetellSystemAlert({
      issueKey: `retell:${endpoint}:${reason}`,
      endpoint,
      category: reason,
      summary: `Rejected Retell ${endpoint} webhook: ${label}`,
      details: reason === "invalid_signature"
        ? "A Retell webhook was rejected because its signature was missing, invalid, expired, or did not match the request body."
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
  if (!parseFailure || (endpoint !== "pre-call" && endpoint !== "post-call")) {
    next(error);
    return;
  }
  void alertRejectedRetellWebhook(endpoint, "malformed_payload");
  res.status(400).json({ error: "Invalid Retell webhook JSON." });
};

import type { ErrorRequestHandler } from "express";
import { recordOperationalFailure } from "./operationalFailures";
import { runNotificationOutboxNow } from "./notificationService";
import { logger } from "./logger";

export type RetellWebhookEndpoint = "pre-call" | "post-call";
export type RetellWebhookRejection = "invalid_signature" | "malformed_payload";

const ALERT_WINDOW_MS = 15 * 60_000;

/**
 * Persist at most one rejected-webhook alert per endpoint per 15-minute window.
 * The unique event key also deduplicates across API instances; request bodies
 * and source IPs are deliberately excluded from stored details.
 */
export async function alertRejectedRetellWebhook(
  endpoint: RetellWebhookEndpoint,
  reason: RetellWebhookRejection,
): Promise<void> {
  const bucket = Math.floor(Date.now() / ALERT_WINDOW_MS);
  const label = reason === "invalid_signature" ? "invalid signature" : "malformed payload";
  try {
    const inserted = await recordOperationalFailure({
      eventKey: `retell-webhook-rejected:${endpoint}:${bucket}`,
      source: endpoint === "pre-call" ? "pre_call_fallback" : "post_call_webhook",
      summary: `Rejected Retell ${endpoint} webhook: ${label}`,
      details: reason === "invalid_signature"
        ? "A Retell webhook was rejected because its signature was missing, invalid, expired, or did not match the request body."
        : "A Retell webhook was rejected because its JSON or payload shape was malformed.",
    });
    if (inserted) {
      void runNotificationOutboxNow().catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : "Unknown outbox error" },
          "Could not dispatch the rejected Retell webhook alert immediately",
        );
      });
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown operational failure error" },
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

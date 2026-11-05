import type { Request, Response } from "express";
import type Stripe from "stripe";
import { billingEnabled, configuredBillingMode, getBillingStripe } from "./stripeClient";
import { adminLivePaymentTestService, billingService } from "./runtime";
import { recordRetellSystemAlert } from "../lib/retellSystemAlerts";

async function alertStripeWebhookFailure(
  category: "stripe_signature_rejected" | "stripe_processing_error",
  issue: string,
): Promise<void> {
  const safeIssue = issue.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100) || "unknown";
  const processingFailed = category === "stripe_processing_error";
  await recordRetellSystemAlert({
    issueKey: processingFailed ? `stripe:webhook:processing:${safeIssue}` : "stripe:webhook:signature",
    endpoint: "stripe",
    category,
    summary: processingFailed ? "Stripe webhook processing failed" : "Stripe webhook signature rejected",
    details: processingFailed
      ? "A verified Stripe event could not be processed."
      : "A Stripe webhook failed signature, raw-body, or mode verification.",
    source: "stripe_webhook",
  });
}

export async function billingWebhook(req: Request, res: Response): Promise<void> {
  if (!billingEnabled()) { res.sendStatus(404); return; }
  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) {
    await alertStripeWebhookFailure("stripe_signature_rejected", "missing_signature_or_raw_body");
    res.sendStatus(401);
    return;
  }
  let event: Stripe.Event;
  try {
    event = getBillingStripe().webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    if (event.livemode !== (configuredBillingMode() === "live")) throw new Error("Stripe mode mismatch");
  } catch {
    await alertStripeWebhookFailure("stripe_signature_rejected", "signature_or_mode_mismatch");
    res.sendStatus(401);
    return;
  }
  try {
    const adminTestResult = await adminLivePaymentTestService.handleWebhook(event);
    if (adminTestResult) {
      res.json(adminTestResult);
      return;
    }
    res.json(await billingService.webhook(event));
  }
  catch {
    // No payload, signature, card detail, credential or provider error gets logged.
    req.log?.error({ eventId: event.id, eventType: event.type }, "Stripe billing event failed; Stripe may retry");
    await alertStripeWebhookFailure("stripe_processing_error", event.type);
    res.status(503).json({ error: "Billing event will be retried" });
  }
}

import type { Request, Response } from "express";
import type Stripe from "stripe";
import { billingEnabled, configuredBillingMode, getBillingStripe } from "./stripeClient";
import { billingService } from "./runtime";

export async function billingWebhook(req: Request, res: Response): Promise<void> {
  if (!billingEnabled()) { res.sendStatus(404); return; }
  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) { res.sendStatus(401); return; }
  let event: Stripe.Event;
  try {
    event = getBillingStripe().webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    if (event.livemode !== (configuredBillingMode() === "live")) throw new Error("Stripe mode mismatch");
  } catch { res.sendStatus(401); return; }
  try { res.json(await billingService.webhook(event)); }
  catch {
    // No payload, signature, card detail, credential or provider error gets logged.
    req.log?.error({ eventId: event.id, eventType: event.type }, "Stripe billing event failed; Stripe may retry");
    res.status(503).json({ error: "Billing event will be retried" });
  }
}

import Stripe from "stripe";
import { billingGate, config } from "./policy";
import { logger } from "../lib/logger";

let warnedLive = false;
let client: Stripe | undefined;
export function billingEnabled() {
  const gate = billingGate();
  if (gate.reason === "live_key_refused" && !warnedLive) {
    warnedLive = true;
    logger.error("BILLING DISABLED: STRIPE_SECRET_KEY is a live key. Only sk_test_ keys are permitted. Calls remain unaffected.");
  }
  return gate.enabled;
}
export function getBillingStripe(): Stripe {
  if (!billingEnabled()) throw new Error("Test billing is disabled");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    timeout: config.operations.stripeRequestTimeoutMs,
    maxNetworkRetries: config.operations.stripeMaxNetworkRetries,
  });
  return client;
}
export async function ensurePlanPrices(stripe: Stripe, planId: string) {
  const plan = config.plans.find(p => p.id === planId);
  if (!plan) throw new Error("Unknown plan");
  // Versioned lookup keys incorporate the config amount so price edits never
  // reuse a stale immutable Stripe Price. Concurrent creation shares an idem key.
  const result: { monthly: string; setup: string } = { monthly: "", setup: "" };
  for (const kind of ["monthly", "setup"] as const) {
    const amount = kind === "monthly" ? plan.monthlyCents : plan.setupCents;
    const key = `corvlio_test_${plan.id}_${kind}_${config.currency}_${amount}`;
    const existing = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
    const price = existing.data[0] ?? await stripe.prices.create({
      currency: config.currency, unit_amount: amount, lookup_key: key,
      ...(kind === "monthly" ? { recurring: { interval: "month" as const } } : {}),
      metadata: { corvlio_plan: plan.id, corvlio_kind: kind },
      product_data: { name: `Corvlio ${plan.label}${kind === "setup" ? " setup" : " monthly"}`, metadata: { corvlio_plan: plan.id } },
    }, { idempotencyKey: key });
    if (price.livemode || price.unit_amount !== amount || price.currency !== config.currency
      || (kind === "monthly" ? price.recurring?.interval !== "month" : !!price.recurring))
      throw new Error("Stripe Price does not match test plan configuration");
    result[kind] = price.id;
  }
  return result;
}

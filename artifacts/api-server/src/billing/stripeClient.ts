import Stripe from "stripe";
import { billingGate, config, type StripeBillingMode } from "./policy";
import { logger } from "../lib/logger";

let warnedLive = false;
let client: Stripe | undefined;
export function billingEnabled() {
  const gate = billingGate();
  if (gate.reason === "live_mode_flag_off" && !warnedLive) {
    warnedLive = true;
    logger.error("BILLING DISABLED: the live Stripe key is present but STRIPE_LIVE_MODE_ENABLED is not true.");
  }
  return gate.enabled;
}
export function configuredBillingMode(): StripeBillingMode {
  return billingGate().mode;
}
export function getBillingStripe(): Stripe {
  if (!billingEnabled()) throw new Error("Stripe billing is disabled");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    timeout: config.operations.stripeRequestTimeoutMs,
    maxNetworkRetries: config.operations.stripeMaxNetworkRetries,
  });
  return client;
}
export async function ensurePlanPrices(stripe: Stripe, planId: string, mode: Exclude<StripeBillingMode, "off"> = "test") {
  const plan = config.plans.find(p => p.id === planId);
  if (!plan) throw new Error("Unknown plan");
  const products = await stripe.products.search({
    query: `metadata['corvlio_catalog']:'corvlio_v1' AND metadata['corvlio_plan']:'${plan.id}'`,
    limit: 2,
  });
  if (products.data.length > 1) throw new Error("Multiple Stripe products found for this plan");
  const product = products.data[0] ?? await stripe.products.create({
    name: `Corvlio ${plan.label}`,
    metadata: { corvlio_catalog: "corvlio_v1", corvlio_plan: plan.id },
  }, { idempotencyKey: `corvlio_${mode}_product_v1_${plan.id}` });
  if (product.livemode !== (mode === "live") || !product.active
    || product.metadata.corvlio_catalog !== "corvlio_v1" || product.metadata.corvlio_plan !== plan.id)
    throw new Error("Stripe Product does not match the active billing catalog");
  // Versioned lookup keys incorporate the config amount so price edits never
  // reuse a stale immutable Stripe Price. Concurrent creation shares an idem key.
  const result: { monthly: string; setup: string } = { monthly: "", setup: "" };
  for (const kind of ["monthly", "setup"] as const) {
    const amount = kind === "monthly" ? plan.monthlyCents : plan.setupCents;
    const key = `corvlio_${mode}_${plan.id}_${kind}_${config.currency}_${amount}`;
    const existing = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
    const price = existing.data[0] ?? await stripe.prices.create({
      product: product.id, currency: config.currency, unit_amount: amount, lookup_key: key,
      ...(kind === "monthly" ? { recurring: { interval: "month" as const } } : {}),
      metadata: { corvlio_plan: plan.id, corvlio_kind: kind },
    }, { idempotencyKey: key });
    const priceProductId = typeof price.product === "string" ? price.product : price.product.id;
    if (price.livemode !== (mode === "live") || priceProductId !== product.id
      || !price.active || price.unit_amount !== amount || price.currency !== config.currency
      || price.lookup_key !== key || price.metadata.corvlio_plan !== plan.id || price.metadata.corvlio_kind !== kind
      || (kind === "monthly" ? price.recurring?.interval !== "month" : !!price.recurring))
      throw new Error("Stripe Price does not match the locked plan configuration");
    result[kind] = price.id;
  }
  return result;
}

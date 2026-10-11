import type Stripe from "stripe";
import type { BillingSnapshot } from "@workspace/api-zod";
import { config, BillingError, addMonths, addBusinessDays, billingUrl, cancellationDate, planFor, usagePeriod, type BillingState, type PlanId } from "./policy";
import { ensurePlanPrices } from "./stripeClient";
import type { BillingStore, BillingTransaction } from "./store";

export type SubscriptionData = {
  id: string; customer: string | { id: string }; status: string; start_date?: number;
  current_period_start?: number; current_period_end?: number; cancel_at?: number | null;
  metadata?: Record<string, string>;
  items: { data: Array<{ id: string; current_period_start?: number; current_period_end?: number;
    price: { id: string; metadata?: Record<string, string>; lookup_key?: string | null } }> };
};
type EventData = {
  id: string; customer?: string | { id: string }; subscription?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } } };
  lines?: { data: Array<{ period?: { end?: number } }> };
};
const idOf = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? "";
const iso = (seconds: number | null | undefined) => seconds ? new Date(seconds * 1000).toISOString() : null;
const BOTH = ["owner", "admin"] as const;
async function notices(tx: BillingTransaction, key: string, title: string, body: string, audiences: readonly ("owner" | "admin")[] = BOTH) {
  for (const audience of audiences) await tx.notice({ key, audience, title, body });
}
function applySubscription(state: BillingState, sub: SubscriptionData, created: number) {
  if (created < state.subscriptionEventCreated) return;
  const item = sub.items.data[0];
  const plan = item?.price.metadata?.corvlio_plan ?? sub.metadata?.corvlio_plan
    ?? /corvlio_test_(startup|starter|professional|managed)_monthly_/.exec(item?.price.lookup_key ?? "")?.[1];
  if (plan) { planFor(plan); state.plan = plan as PlanId; }
  state.subscriptionId = sub.id;
  state.customerId = idOf(sub.customer);
  state.status = state.pastDueSince && sub.status !== "canceled" ? "past_due" : sub.status;
  state.periodStart = iso(sub.current_period_start ?? item?.current_period_start) ?? state.periodStart;
  state.periodEnd = iso(sub.current_period_end ?? item?.current_period_end) ?? state.periodEnd;
  state.cancelAt = iso(sub.cancel_at);
  state.subscriptionEventCreated = created;
  if (state.plan === "startup" && !state.startupTransitionAt) {
    state.startupTransitionAt = addMonths(new Date((sub.start_date ?? created) * 1000), config.policy.startupTransitionMonths).toISOString();
  }
}

/** No suspension, provisioning guard, call gate or per-call charge exists here. */
export class BillingService {
  constructor(private store: BillingStore, private stripe: () => Stripe, private now = () => new Date()) {}
  async webhook(event: Stripe.Event) {
    if (event.livemode) throw new BillingError("Live Stripe events are refused", 401);
    if (await this.store.hasEvent(event.id)) return { replay: true };
    const kinds = ["checkout.session.completed", "invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"];
    if (!kinds.includes(event.type)) return { ignored: true };
    const data = event.data.object as unknown as EventData;
    const subscriptionId = event.type.startsWith("customer.subscription.") ? data.id
      : idOf(data.subscription ?? data.parent?.subscription_details?.subscription);
    const businessId = await this.store.findByStripe(idOf(data.customer), subscriptionId);
    // Never bind tenants using owner-supplied email, query params or arbitrary metadata.
    if (!businessId) return { ignored: true };
    const sub = event.type.startsWith("customer.subscription.") ? data as unknown as SubscriptionData
      : subscriptionId ? await this.stripe().subscriptions.retrieve(subscriptionId) as unknown as SubscriptionData : null;
    return this.store.transact(businessId, async tx => {
      if (!await tx.claimEvent(event.id, event.type, "Signature-verified Stripe test event", new Date(event.created * 1000))) return { replay: true };
      const s = tx.state;
      if (s.subscriptionId && sub && sub.id !== s.subscriptionId && s.status !== "canceled" && s.status !== "not_subscribed")
        return { ignored: true };
      if (sub) applySubscription(s, sub, event.created);
      if (event.type === "checkout.session.completed") {
        if (!sub) throw new BillingError("Subscription missing from completed Checkout", 400);
        if (s.pendingCheckout?.id === data.id) s.pendingCheckout = null;
      } else if (event.type === "invoice.paid") {
        if (event.created >= s.lastPaidEventCreated) {
          s.lastPaidEventCreated = event.created;
          const invoiceEnd = Math.max(0, ...(data.lines?.data ?? []).map(line => line.period?.end ?? 0));
          const previousPaidEnd = Date.parse(s.paidPeriodEnd ?? "") / 1000 || 0;
          s.paidPeriodEnd = iso(Math.max(previousPaidEnd, invoiceEnd || (Date.parse(s.periodEnd ?? "") / 1000 || 0)));
          s.setupPaid = true;
          if (!s.failureInvoiceId || s.failureInvoiceId === data.id) {
            s.pastDueSince = null; s.graceEndsAt = null; s.failureInvoiceId = null; s.needsAdminReview = false;
            if (s.status !== "canceled") s.status = "active";
          }
        }
      } else if (event.type === "invoice.payment_failed" && event.created >= s.lastPaidEventCreated && s.status !== "canceled") {
        s.status = "past_due";
        const firstFailure = !s.pastDueSince;
        if (firstFailure || event.created * 1000 < Date.parse(s.pastDueSince!)) {
          s.pastDueSince = new Date(event.created * 1000).toISOString();
          if (firstFailure) s.failureInvoiceId = data.id;
          s.graceEndsAt = addBusinessDays(new Date(s.pastDueSince)).toISOString();
        }
        if (firstFailure) {
          await notices(tx, `payment_failed:${s.failureInvoiceId}`, "Payment needs attention",
            `Your payment failed. Please resolve it within ${config.policy.failedPaymentGraceBusinessDays} business days, by ${s.graceEndsAt}. Manage your card: ${billingUrl(undefined, true)}. Calls and lead capture continue.`);
        }
      } else if (event.type === "customer.subscription.deleted") {
        if (event.created >= s.subscriptionEventCreated) s.status = "canceled";
      }
      if (!s.lastEvent || event.created >= s.lastEvent.created) s.lastEvent = { id: event.id, type: event.type, created: event.created };
      return { processed: true };
    });
  }
  async refresh(businessId: number) {
    return this.store.transact(businessId, async tx => {
      const s = tx.state, now = this.now(), period = usagePeriod(s, now);
      const count = await tx.countCalls(period.start, period.end);
      const limit = s.plan ? planFor(s.plan).callLimit : null;
      s.usageFlags = limit === null ? [] : config.policy.callCapThresholdPercentages.filter(n => count >= limit * n / 100);
      for (const threshold of s.usageFlags) {
        await notices(tx, `usage:${period.start}:${threshold}`, "Call allowance notice",
          `${count} of ${limit} calls this month (${threshold}% threshold). Consider upgrading your plan. No per-call charge or automatic tier change; calls and lead capture continue.`);
      }
      if (s.pastDueSince && s.graceEndsAt && now.getTime() >= Date.parse(s.graceEndsAt)) {
        s.needsAdminReview = true;
        await notices(tx, `grace_expired:${s.failureInvoiceId}`, "Billing needs admin review",
          `The ${config.policy.failedPaymentGraceBusinessDays}-business-day cure window ended at ${s.graceEndsAt}. Review this business manually. No service suspension has been performed.`, ["admin"]);
      }
      return { account: { ...s }, usage: { count, limit, ...period } };
    });
  }
  async snapshot(businessId: number): Promise<BillingSnapshot> {
    const business = await this.store.business(businessId);
    if (!business) throw new BillingError("Business not found", 404);
    return { businessId, businessName: business.businessName, ...await this.refresh(businessId),
      plans: config.plans, policy: config.policy, timeline: await this.store.timeline(businessId) };
  }
  async checkout(businessId: number, planId: PlanId) {
    const business = await this.store.business(businessId);
    if (!business) throw new BillingError("Business not found", 404);
    return this.store.transact(businessId, async tx => {
      const s = tx.state;
      if (planId === "startup" && (!s.startupEligible || s.plan !== "startup")) throw new BillingError("Startup requires admin assignment", 403);
      if (s.subscriptionId && s.status !== "canceled") throw new BillingError("Use Upgrade for your existing subscription");
      const stripe = this.stripe(), prices = await ensurePlanPrices(stripe, planId);
      const needsSetup = !s.setupPaid || !config.policy.setupFeeOncePerBusiness;
      // Do not reuse a pre-card-only session with dynamically enabled methods.
      const fingerprint = `${prices.monthly}:${needsSetup ? prices.setup : "no_setup"}:card_only`;
      if (s.pendingCheckout) {
        const pending = await stripe.checkout.sessions.retrieve(s.pendingCheckout.id);
        if (pending.status === "complete") throw new BillingError("Payment was submitted; wait for Stripe confirmation before starting another subscription");
        if (pending.status === "open" && pending.url) {
          if (s.pendingCheckout.plan === planId && s.pendingCheckout.fingerprint === fingerprint) return { url: pending.url };
          // A second tab must not leave two payable subscriptions behind.
          await stripe.checkout.sessions.expire(pending.id);
        }
        s.pendingCheckout = null;
      }
      if (!s.customerId) {
        const customer = await stripe.customers.create({
          name: business.businessName, ...(business.ownerEmail ? { email: business.ownerEmail } : {}),
          metadata: { business_id: String(businessId) },
        }, { idempotencyKey: `corvlio_test_customer_${businessId}` });
        if (customer.livemode) throw new BillingError("Live customer refused", 401);
        s.customerId = customer.id;
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription", allowed_payment_method_types: ["card"],
        customer: s.customerId, client_reference_id: String(businessId),
        line_items: [{ price: prices.monthly, quantity: 1 },
          ...(needsSetup ? [{ price: prices.setup, quantity: 1 }] : [])],
        subscription_data: { metadata: { business_id: String(businessId), corvlio_plan: planId } },
        metadata: { business_id: String(businessId), corvlio_plan: planId },
        success_url: billingUrl() + "?checkout=success", cancel_url: billingUrl() + "?checkout=cancel",
      // Reuse the same pending session on accidental repeated clicks; new monthly
      // bucket permits a fresh expired session without inventing a second customer.
      }, { idempotencyKey: `corvlio_test_checkout_card_only_${businessId}_${planId}_${s.subscriptionId ?? "new"}_${s.setupPaid}_${prices.monthly}_${this.now().toISOString().slice(0, 13)}` });
      if (session.livemode || !session.url) throw new BillingError("No test Checkout URL returned", 502);
      s.pendingCheckout = { id: session.id, plan: planId, fingerprint };
      return { url: session.url };
    });
  }
  async portal(businessId: number) {
    return this.store.transact(businessId, async tx => {
      if (!tx.state.customerId) throw new BillingError("No Stripe customer yet");
      const stripe = this.stripe();
      // Card-only portal cannot bypass this app's written-notice cancellation
      // policy or its admin-only Startup assignment.
      const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
      const existing = configs.data.find(c => c.active && c.metadata?.corvlio_test_card_only === "true");
      const portalConfig = existing ?? await stripe.billingPortal.configurations.create({
        metadata: { corvlio_test_card_only: "true" },
        features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
          subscription_cancel: { enabled: false }, subscription_update: { enabled: false } },
      }, { idempotencyKey: "corvlio_test_card_only_portal" });
      if (portalConfig.features.subscription_cancel.enabled || portalConfig.features.subscription_update.enabled)
        throw new BillingError("Unsafe portal configuration refused", 503);
      const session = await stripe.billingPortal.sessions.create({
        customer: tx.state.customerId, configuration: portalConfig.id, return_url: billingUrl(),
      });
      return { url: session.url };
    });
  }
  async cancel(businessId: number, actor: string) {
    return this.store.transact(businessId, async tx => {
      const s = tx.state, now = this.now();
      if (!s.subscriptionId || s.status === "canceled") throw new BillingError("No active subscription");
      if (s.cancelAt) return { ...s };
      const effective = cancellationDate(s, now);
      await this.stripe().subscriptions.update(s.subscriptionId, {
        cancel_at: Math.floor(effective.getTime() / 1000),
        proration_behavior: config.policy.cancellationProrationBehavior as Stripe.SubscriptionUpdateParams.ProrationBehavior,
      }, { idempotencyKey: `corvlio_cancel_${s.subscriptionId}_${effective.getTime()}` });
      s.cancelAt = effective.toISOString(); s.cancelRequestedAt = now.toISOString(); s.cancelRequestedBy = actor;
      await tx.claimEvent(`cancel:${s.subscriptionId}:${s.cancelAt}`, "owner.cancellation_requested",
        `Written notice received; cancellation effective ${s.cancelAt}. Offboarding remains manual.`, now, actor);
      await notices(tx, `cancel:${s.cancelAt}`, "Cancellation request confirmed",
        `Your written cancellation request was received on ${s.cancelRequestedAt}. Cancellation is scheduled for ${s.cancelAt}; you may resume before then. ${billingUrl()}`);
      return { ...s };
    });
  }
  async resume(businessId: number, actor: string) {
    return this.store.transact(businessId, async tx => {
      const s = tx.state, now = this.now();
      if (!s.subscriptionId || !s.cancelAt || now.getTime() >= Date.parse(s.cancelAt) || s.status === "canceled")
        throw new BillingError("No future cancellation to resume");
      const canceledAt = s.cancelAt;
      await this.stripe().subscriptions.update(s.subscriptionId, { cancel_at: "", cancel_at_period_end: false });
      s.cancelAt = null;
      await tx.claimEvent(`resume:${s.subscriptionId}:${canceledAt}`, "owner.cancellation_resumed", "Written cancellation withdrawn", now, actor);
      await notices(tx, `resume:${canceledAt}`, "Subscription resumed", `Your cancellation has been withdrawn. Calls continue. ${billingUrl()}`);
      return { ...s };
    });
  }
  async upgrade(businessId: number, planId: PlanId, actor: string) {
    return this.store.transact(businessId, async tx => {
      const s = tx.state, plan = planFor(planId);
      if (planId === "startup" || !s.plan || !s.subscriptionId || s.status === "canceled"
        || plan.monthlyCents <= planFor(s.plan).monthlyCents) throw new BillingError("Only explicit upgrades to a higher plan are supported");
      const stripe = this.stripe(), prices = await ensurePlanPrices(stripe, planId);
      const sub = await stripe.subscriptions.retrieve(s.subscriptionId) as unknown as SubscriptionData;
      if (!sub.items.data[0]?.id) throw new BillingError("Missing monthly subscription item");
      await stripe.subscriptions.update(s.subscriptionId, {
        items: [{ id: sub.items.data[0].id, price: prices.monthly }],
        proration_behavior: config.policy.upgradeProrationBehavior as Stripe.SubscriptionUpdateParams.ProrationBehavior,
        metadata: { corvlio_plan: planId },
      });
      s.plan = planId; s.usageFlags = [];
      await tx.claimEvent(`upgrade:${s.subscriptionId}:${planId}:${this.now().getTime()}`, "owner.plan_upgrade",
        `Owner selected ${plan.label}; no per-call fee or setup fee added.`, this.now(), actor);
      return { ...s };
    });
  }
  async startupEligibility(businessId: number, eligible: boolean, actor: string) {
    if (!await this.store.business(businessId)) throw new BillingError("Business not found", 404);
    return this.store.transact(businessId, async tx => {
      tx.state.startupEligible = eligible;
      if (!tx.state.subscriptionId) tx.state.plan = eligible ? "startup" : null;
      await tx.claimEvent(`startup:${businessId}:${this.now().getTime()}`, "admin.startup_eligibility",
        `Admin ${eligible ? "confirmed" : "removed"} eligibility for a business under ${config.policy.startupEligibilityBusinessAgeMonths} months old.`, this.now(), actor);
      return { ...tx.state };
    });
  }
}

import type Stripe from "stripe";
import type { BillingSnapshot } from "@workspace/api-zod";
import { config, BillingError, addMonths, addBusinessDays, billingUrl, cancellationDate, isAdminOnlyPlan, isOneTimePlan, isTestPlan, planFor, snapshotPlan, usagePeriod, type BillingState, type PlanId } from "./policy";
import { ensurePlanPrices } from "./stripeClient";
import type { BillingStore, BillingTransaction } from "./store";
import { recordOperationalFailure } from "../lib/operationalFailures";
import { runNotificationOutboxNow } from "../lib/notificationService";

export type SubscriptionData = {
  id: string; customer: string | { id: string }; status: string; start_date?: number;
  current_period_start?: number; current_period_end?: number; cancel_at?: number | null;
  metadata?: Record<string, string>;
  items: { data: Array<{ id: string; current_period_start?: number; current_period_end?: number;
    price: { id: string; metadata?: Record<string, string>; lookup_key?: string | null } }> };
};
type EventData = {
  id: string; customer?: string | { id: string }; subscription?: string | { id: string } | null;
  mode?: string; payment_status?: string; amount_total?: number | null; currency?: string | null;
  client_reference_id?: string | null; metadata?: Record<string, string> | null;
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
    ?? /corvlio_(?:test|live)_(startup|starter|professional|managed)_monthly_/.exec(item?.price.lookup_key ?? "")?.[1];
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
  constructor(
    private store: BillingStore,
    private stripe: () => Stripe,
    private now = () => new Date(),
    private mode: () => "test" | "live" = () => "test",
    private activateFirstPaidBusiness: (businessId: number) => Promise<void> = async () => {},
  ) {}
  async webhook(event: Stripe.Event) {
    if (event.livemode !== (this.mode() === "live")) throw new BillingError("Stripe event mode does not match the active billing mode", 401);
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
    const checkoutPlan = event.type === "checkout.session.completed"
      ? config.plans.find(plan => plan.id === data.metadata?.corvlio_plan)
      : undefined;
    const testPaymentPlan = checkoutPlan && isOneTimePlan(checkoutPlan) && isTestPlan(checkoutPlan)
      ? checkoutPlan
      : null;
    const outcome = await this.store.transact(businessId, async tx => {
      const eventDetail = testPaymentPlan
        ? `TEST PAYMENT: ${testPaymentPlan.label} — $${(testPaymentPlan.oneTimeCents / 100).toFixed(2)} USD one-time; no setup fee or recurring charge.`
        : "Signature-verified Stripe event";
      if (!await tx.claimEvent(event.id, event.type, eventDetail, new Date(event.created * 1000)))
        return { response: { replay: true }, firstPayment: false };
      const s = tx.state;
      if (s.subscriptionId && sub && sub.id !== s.subscriptionId && s.status !== "canceled" && s.status !== "not_subscribed")
        return { response: { ignored: true }, firstPayment: false };
      if (event.type === "checkout.session.completed" && !sub) {
        if (!testPaymentPlan || data.mode !== "payment" || data.payment_status !== "paid"
          || data.amount_total !== testPaymentPlan.oneTimeCents || data.currency !== config.currency)
          throw new BillingError("Completed one-time Checkout does not match the test plan configuration.", 409);
        const customerId = idOf(data.customer);
        if (!customerId || customerId !== s.customerId || s.pendingCheckout?.id !== data.id
          || s.pendingCheckout.plan !== testPaymentPlan.id
          || data.metadata?.business_id !== String(businessId)
          || data.client_reference_id !== String(businessId))
          throw new BillingError("Completed test Checkout does not match the pending business payment.", 409);
        if (s.subscriptionId || s.status === "active")
          throw new BillingError("Live Test can only activate a business without an existing Stripe subscription.", 409);
        if (event.created < s.lastPaidEventCreated)
          throw new BillingError("Completed test payment is older than the last recorded payment event.", 409);

        s.plan = testPaymentPlan.id;
        s.customerId = customerId;
        s.status = "active";
        s.periodStart = null;
        s.periodEnd = null;
        s.paidPeriodEnd = null;
        s.pastDueSince = null;
        s.graceEndsAt = null;
        s.needsAdminReview = false;
        s.cancelAt = null;
        s.cancelRequestedAt = null;
        s.cancelRequestedBy = null;
        s.setupPaid = false;
        s.usageFlags = [];
        s.lastPaidEventCreated = event.created;
        s.pendingCheckout = null;
        if (!s.lastEvent || event.created >= s.lastEvent.created)
          s.lastEvent = { id: event.id, type: event.type, created: event.created };
        // Deliberately reuse the first-paid activation marker and worker used by invoice.paid.
        // An eligible awaiting-payment business may proceed to normal phone provisioning.
        const firstPayment = await tx.markStripeFirstInvoicePaid(
          testPaymentPlan.id,
          new Date(event.created * 1000),
        );
        return { response: { processed: true }, firstPayment };
      }
      if (sub) applySubscription(s, sub, event.created);
      if (event.type === "checkout.session.completed") {
        if (!sub) throw new BillingError("Subscription missing from completed Checkout", 400);
        if (s.pendingCheckout?.id === data.id) s.pendingCheckout = null;
      } else if (event.type === "invoice.paid") {
        let firstPayment = false;
        if (event.created >= s.lastPaidEventCreated) {
          s.lastPaidEventCreated = event.created;
          const invoiceEnd = Math.max(0, ...(data.lines?.data ?? []).map(line => line.period?.end ?? 0));
          const previousPaidEnd = Date.parse(s.paidPeriodEnd ?? "") / 1000 || 0;
          s.paidPeriodEnd = iso(Math.max(previousPaidEnd, invoiceEnd || (Date.parse(s.periodEnd ?? "") / 1000 || 0)));
          if (!s.setupPaid) {
            if (!s.plan) throw new BillingError("Paid subscription is missing a Corvlio plan", 409);
            firstPayment = await tx.markStripeFirstInvoicePaid(s.plan, new Date(event.created * 1000));
          }
          s.setupPaid = true;
          if (!s.failureInvoiceId || s.failureInvoiceId === data.id) {
            s.pastDueSince = null; s.graceEndsAt = null; s.failureInvoiceId = null; s.needsAdminReview = false;
            if (s.status !== "canceled") s.status = "active";
          }
          if (!s.lastEvent || event.created >= s.lastEvent.created) s.lastEvent = { id: event.id, type: event.type, created: event.created };
          return { response: { processed: true }, firstPayment };
        }
        if (!s.lastEvent || event.created >= s.lastEvent.created) s.lastEvent = { id: event.id, type: event.type, created: event.created };
        return { response: { processed: true }, firstPayment: false };
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
      return { response: { processed: true }, firstPayment: false };
    });
    if (outcome.firstPayment) await this.activateFirstPaidBusiness(businessId);
    return outcome.response;
  }
  async refresh(businessId: number) {
    const refreshed = await this.store.transact(businessId, async tx => {
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
    const business = await this.store.business(businessId);
    if (!business) return refreshed;
    const periodKey = refreshed.usage.start.slice(0, 10);
    let alertQueued = false;
    const queueReview = async (kind: "past-due" | "over-limit", summary: string, body: string) => {
      const eventKey = `billing:${kind}:${businessId}:${periodKey}`;
      const inserted = await recordOperationalFailure({
        eventKey,
        source: "billing_review",
        summary,
        details: summary,
        businessId,
        businessName: business.businessName,
        founderPush: {
          eventKey,
          title: "Billing account needs review",
          body: `${business.businessName}: ${body} No automatic account or plan change was made.`,
          deepLink: `/admin/businesses/${businessId}`,
        },
      });
      alertQueued ||= inserted;
    };
    if (refreshed.account.status === "past_due" && refreshed.account.graceEndsAt
      && this.now().getTime() >= Date.parse(refreshed.account.graceEndsAt)) {
      await queueReview(
        "past-due",
        "Account is past due beyond the grace period",
        "Payment remains past due beyond the grace period.",
      );
    }
    if (refreshed.usage.limit !== null && refreshed.usage.count > refreshed.usage.limit) {
      await queueReview("over-limit", "Call allowance exceeded", "The plan call allowance has been exceeded.");
    }
    if (alertQueued) void runNotificationOutboxNow().catch(() => undefined);
    return refreshed;
  }
  async snapshot(businessId: number, includeAdminOnlyPlans = false): Promise<BillingSnapshot> {
    const business = await this.store.business(businessId);
    if (!business) throw new BillingError("Business not found", 404);
    const includeRestrictedPlans = includeAdminOnlyPlans && this.mode() === "live";
    return { businessId, businessName: business.businessName, ...await this.refresh(businessId),
      plans: config.plans.filter(plan => includeRestrictedPlans || !isAdminOnlyPlan(plan.id)).map(snapshotPlan),
      policy: config.policy, timeline: await this.store.timeline(businessId) };
  }
  async checkout(businessId: number, planId: PlanId) {
    const business = await this.store.business(businessId);
    if (!business) throw new BillingError("Business not found", 404);
    return this.store.transact(businessId, async tx => {
      const s = tx.state, plan = planFor(planId), oneTime = isOneTimePlan(plan);
      if (planId === "startup" && (!s.startupEligible || s.plan !== "startup")) throw new BillingError("Startup requires admin assignment", 403);
      if (oneTime && (s.subscriptionId || s.status === "active" || (s.plan === planId && s.lastPaidEventCreated > 0)))
        throw new BillingError("Live Test requires an unactivated business without an existing Stripe subscription.");
      if (s.subscriptionId && s.status !== "canceled") throw new BillingError("Use Upgrade for your existing subscription");
      const mode = this.mode();
      if (isTestPlan(plan) && mode !== "live")
        throw new BillingError("Live Test is available only in live Stripe mode.", 403);
      await tx.prepareStripeBilling(planId);
      const stripe = this.stripe(), prices = await ensurePlanPrices(stripe, planId, mode);
      const needsSetup = !oneTime && (!s.setupPaid || !config.policy.setupFeeOncePerBusiness);
      if (oneTime ? !prices.oneTime : !prices.monthly)
        throw new BillingError("The configured Stripe price is unavailable.", 503);
      // Do not reuse a pre-card-only session with dynamically enabled methods.
      const fingerprint = oneTime
        ? `payment:${prices.oneTime}:card_only`
        : `${prices.monthly}:${needsSetup ? prices.setup : "no_setup"}:card_only`;
      if (s.pendingCheckout) {
        const pending = await stripe.checkout.sessions.retrieve(s.pendingCheckout.id);
        if (pending.status === "complete") throw new BillingError("Payment was submitted; wait for Stripe confirmation before starting another checkout");
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
        }, { idempotencyKey: `corvlio_${mode}_customer_v1_${businessId}` });
        if (customer.livemode !== (mode === "live")) throw new BillingError("Stripe customer mode mismatch", 401);
        s.customerId = customer.id;
      }
      const metadata = { business_id: String(businessId), corvlio_plan: planId };
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: oneTime ? "payment" : "subscription",
        allowed_payment_method_types: ["card"],
        customer: s.customerId, client_reference_id: String(businessId),
        line_items: oneTime
          ? [{ price: prices.oneTime!, quantity: 1 }]
          : [{ price: prices.monthly!, quantity: 1 },
            ...(needsSetup ? [{ price: prices.setup!, quantity: 1 }] : [])],
        ...(oneTime
          ? { payment_intent_data: { metadata: { ...metadata, corvlio_test_payment: "true" } } }
          : { subscription_data: { metadata } }),
        metadata: { ...metadata, ...(oneTime ? { corvlio_test_payment: "true" } : {}) },
        success_url: billingUrl() + "?checkout=success", cancel_url: billingUrl() + "?checkout=cancel",
      };
      // Reuse the same pending session on accidental repeated clicks; new monthly
      // bucket permits a fresh expired session without inventing a second customer.
      const idempotencyKey = oneTime
        ? `corvlio_${mode}_checkout_one_time_test_v1_${businessId}_${planId}_${prices.oneTime}`
        : `corvlio_${mode}_checkout_card_only_v2_${businessId}_${planId}_${s.subscriptionId ?? "new"}_${s.setupPaid}_${prices.monthly}_${this.now().toISOString().slice(0, 13)}`;
      const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });
      if (session.livemode !== (mode === "live") || !session.url) throw new BillingError("Stripe Checkout URL mode mismatch", 502);
      s.pendingCheckout = { id: session.id, plan: planId, fingerprint };
      return { url: session.url };
    });
  }
  async portal(businessId: number) {
    return this.store.transact(businessId, async tx => {
      if (!tx.state.customerId) throw new BillingError("No Stripe customer yet");
      const stripe = this.stripe();
      const mode = this.mode();
      const metadataKey = `corvlio_${mode}_card_only`;
      // Card-only portal cannot bypass this app's written-notice cancellation
      // policy or its admin-only Startup assignment.
      const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
      const existing = configs.data.find(c => c.active && c.metadata?.[metadataKey] === "true");
      const portalConfig = existing ?? await stripe.billingPortal.configurations.create({
        metadata: { [metadataKey]: "true" },
        features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
          subscription_cancel: { enabled: false }, subscription_update: { enabled: false } },
      }, { idempotencyKey: `corvlio_${mode}_card_only_portal_v1` });
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
    const targetPlan = planFor(planId);
    if (isOneTimePlan(targetPlan) || isAdminOnlyPlan(planId))
      throw new BillingError("This plan is only available through its restricted one-time Checkout.", 400);
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
  async adminChangePlan(businessId: number, planId: PlanId, actor: string, reason: string | null) {
    const targetPlan = planFor(planId);
    if (isOneTimePlan(targetPlan) || isAdminOnlyPlan(planId))
      throw new BillingError("This plan cannot be assigned as a subscription.", 400);
    return this.store.transact(businessId, async tx => {
      const s = tx.state;
      if (planId === "startup" && !s.startupEligible)
        throw new BillingError("Startup must be approved for this account before assignment.", 400);
      if (!s.plan || !s.subscriptionId || s.status === "canceled")
        throw new BillingError("This account has no active Stripe subscription.");
      const previousPlan = s.plan;
      if (previousPlan === planId) return { ...s };
      await tx.prepareStripeBilling(planId);
      const stripe = this.stripe();
      const prices = await ensurePlanPrices(stripe, planId);
      const subscription = await stripe.subscriptions.retrieve(s.subscriptionId) as unknown as SubscriptionData;
      const item = subscription.items.data[0]?.id;
      if (!item) throw new BillingError("Missing monthly subscription item");
      await stripe.subscriptions.update(s.subscriptionId, {
        items: [{ id: item, price: prices.monthly }],
        proration_behavior: config.policy.upgradeProrationBehavior as Stripe.SubscriptionUpdateParams.ProrationBehavior,
        metadata: { corvlio_plan: planId },
      });
      s.plan = planId;
      s.usageFlags = [];
      const now = this.now();
      await tx.claimEvent(
        `admin-plan:${s.subscriptionId}:${planId}:${now.getTime()}`,
        "admin.plan_change",
        `Administrator changed the plan from ${previousPlan} to ${planId}.${reason ? ` Reason: ${reason.slice(0, 300)}.` : ""} No immediate prorated charge was requested.`,
        now,
        actor,
      );
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

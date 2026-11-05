import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingFixture } from "../fixtures/billing";
import { addBusinessDays, addMonths, billingGate, cancellationDate, config, initialBillingState, usagePeriod } from "../../src/billing/policy";

const enforcementMocks = vi.hoisted(() => ({ reinstateForPaidInvoice: vi.fn(async () => false) }));
vi.mock("../../src/billing/enforcement", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/billing/enforcement")>(),
  reinstateForPaidInvoice: enforcementMocks.reinstateForPaidInvoice,
}));

beforeEach(() => vi.stubEnv("PUBLIC_API_BASE_URL", "https://billing.example.test/api"));
afterEach(() => vi.unstubAllEnvs());
describe("test-only billing policy", () => {
  it("keeps all exact plans and caps in one config", () => {
    expect(config.plans.map(p => [p.id, p.monthlyCents, p.setupCents, p.callLimit])).toEqual([
      ["startup", 50000, 25000, 100], ["starter", 75000, 30000, 150],
      ["professional", 100000, 30000, null], ["managed", 125000, 30000, null],
      ["live-test-3", 0, 0, null],
    ]);
    expect(config.plans.at(-1)).toMatchObject({
      label: "Live Test $3", billingType: "one_time", oneTimeCents: 300,
      monthlyCents: 0, setupCents: 0, adminOnly: true, testOnly: true,
    });
  });
  it.each([{}, { BILLING_ENABLED: "true" }, { BILLING_ENABLED: "false", STRIPE_SECRET_KEY: "sk_test_dummy" }])("is off without required test configuration", env => {
    expect(billingGate(env).enabled).toBe(false);
  });
  it.each(["sk_live_dummy", "rk_live_dummy"])("refuses live keys unless the separate live-mode flag is enabled: %s", secretKey => {
    expect(billingGate({ BILLING_ENABLED: "true", STRIPE_SECRET_KEY: secretKey }).reason).toBe("live_mode_flag_off");
  });
  it("never enables in production", () => {
    expect(billingGate({ NODE_ENV: "production", BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_dummy", PUBLIC_API_BASE_URL: "https://example.test" }).enabled).toBe(false);
  });
  it.each(["sk_test_dummy", "rk_test_dummy"])("accepts standard and restricted keys in an explicitly enabled test environment: %s", secretKey => {
    expect(billingGate({ NODE_ENV: "test", BILLING_ENABLED: "true", STRIPE_SECRET_KEY: secretKey,
      STRIPE_WEBHOOK_SECRET: "whsec_dummy", PUBLIC_API_BASE_URL: "https://example.test" }).enabled).toBe(true);
  });
  it.each(["sk_live_dummy", "rk_live_dummy"])("requires explicit production opt-in, live credentials and a configured production domain: %s", secretKey => {
    const base = { NODE_ENV: "production", BILLING_ENABLED: "true", STRIPE_LIVE_MODE_ENABLED: "true",
      STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: "whsec_live_dummy",
      PUBLIC_API_BASE_URL: "https://billing.example.test/api", REPLIT_DOMAINS: "billing.example.test" };
    expect(billingGate(base)).toMatchObject({ enabled: true, mode: "live" });
    expect(billingGate({ ...base, NODE_ENV: "test" }).reason).toBe("live_mode_requires_production");
    expect(billingGate({ ...base, REPLIT_DOMAINS: "other.example.test" }).reason).toBe("invalid_production_base");
    expect(billingGate({ ...base, STRIPE_WEBHOOK_SECRET: "invalid" }).reason).toBe("missing_live_credentials");
    expect(billingGate({ ...base, BILLING_ENABLED: "false" }).reason).toBe("flag_off");
  });
  it("counts five business days, not five calendar days", () => {
    expect(addBusinessDays(new Date("2026-10-09T10:00:00Z")).toISOString()).toBe("2026-10-16T10:00:00.000Z");
    expect(addBusinessDays(new Date("2026-10-10T10:00:00Z")).toISOString()).toBe("2026-10-16T10:00:00.000Z");
  });
  it("uses the later of notice end and paid-period end", () => {
    const s = initialBillingState(), now = new Date("2026-10-10T10:00:00Z");
    expect(cancellationDate(s, now).toISOString()).toBe("2026-11-09T10:00:00.000Z");
    s.paidPeriodEnd = "2026-11-20T00:00:00Z";
    expect(cancellationDate(s, now).toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
  it("does not extend cancellation to an unpaid invoice period", () => {
    const s = initialBillingState(); s.periodEnd = "2026-12-01T00:00:00Z";
    expect(cancellationDate(s, new Date("2026-10-10T10:00:00Z")).toISOString()).toBe("2026-11-09T10:00:00.000Z");
  });
  it("uses a UTC calendar month without a subscription", () => {
    expect(usagePeriod(initialBillingState(), new Date("2026-10-10T10:00:00Z"))).toEqual({
      start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z",
    });
  });
  it("clamps end-of-month Startup transition dates", () => {
    expect(addMonths(new Date("2026-08-31T12:00:00Z"), 6).toISOString()).toBe("2027-02-28T12:00:00.000Z");
  });
});

describe("Stripe events and notices (SDK mocked; no network)", () => {
  it("stores Checkout completion and last event without card details", async () => {
    const f = billingFixture(); f.subscribed();
    await f.service.webhook(f.event("checkout.session.completed", "evt_checkout"));
    expect(f.state()).toMatchObject({ plan: "starter", status: "active", subscriptionId: "sub_test_1",
      lastEvent: { id: "evt_checkout", type: "checkout.session.completed" } });
    expect(f.events.size).toBe(1);
  });
  it("claims event IDs exactly once on replay", async () => {
    const f = billingFixture(); f.subscribed();
    const event = f.event("invoice.payment_failed", "evt_failed");
    await f.service.webhook(event);
    expect(await f.service.webhook(event)).toEqual({ replay: true });
    expect(f.events.size).toBe(1); expect(f.notices.size).toBe(2); expect(f.sdk.subscriptions.retrieve).toHaveBeenCalledTimes(1);
  });
  it("does not reset the first-failure grace clock on Stripe retries", async () => {
    const f = billingFixture(); f.subscribed();
    await f.service.webhook(f.event("invoice.payment_failed", "evt_first", new Date("2026-10-09T10:00:00Z")));
    await f.service.webhook(f.event("invoice.payment_failed", "evt_retry", new Date("2026-10-13T10:00:00Z")));
    expect(f.state()).toMatchObject({ status: "past_due", pastDueSince: "2026-10-09T10:00:00.000Z",
      graceEndsAt: "2026-10-16T10:00:00.000Z" });
    expect(f.notices.size).toBe(2);
    expect([...f.notices.values()].every(n => n.body.includes("https://billing.example.test/billing?portal=1"))).toBe(true);
  });
  it("recognizes an earlier first charge arriving after its retry without duplicate notices", async () => {
    const f = billingFixture(); f.subscribed();
    await f.service.webhook(f.event("invoice.payment_failed", "evt_retry", new Date("2026-10-13T10:00:00Z")));
    await f.service.webhook(f.event("invoice.payment_failed", "evt_first", new Date("2026-10-09T10:00:00Z")));
    expect(f.state().graceEndsAt).toBe("2026-10-16T10:00:00.000Z"); expect(f.notices.size).toBe(2);
  });
  it("adds admin review after grace, never suspends or calls Stripe to cancel", async () => {
    const f = billingFixture(); f.subscribed();
    await f.service.webhook(f.event("invoice.payment_failed", "evt_fail"));
    f.setNow("2026-10-16T10:00:00Z");
    await f.service.refresh(1); await f.service.refresh(1);
    expect(f.state()).toMatchObject({ needsAdminReview: true, status: "past_due" });
    expect(f.notices.size).toBe(3); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled();
  });
  it("clears past due and admin review when the failed invoice is paid", async () => {
    const f = billingFixture(); f.subscribed();
    await f.service.webhook(f.event("invoice.payment_failed", "evt_fail"));
    f.setNow("2026-10-17T10:00:00Z"); await f.service.refresh(1);
    await f.service.webhook(f.event("invoice.paid", "evt_paid"));
    expect(f.state()).toMatchObject({ status: "active", pastDueSince: null, graceEndsAt: null, needsAdminReview: false, setupPaid: true });
    expect(enforcementMocks.reinstateForPaidInvoice).toHaveBeenCalledWith(1, "stripe", "in_test", "stripe_webhook");
  });
  it("does not let a stale failed event resurrect a paid invoice", async () => {
    const f = billingFixture(); f.subscribed();
    await f.service.webhook(f.event("invoice.paid", "evt_paid", new Date("2026-10-11T10:00:00Z")));
    await f.service.webhook(f.event("invoice.payment_failed", "evt_stale", new Date("2026-10-10T10:00:00Z")));
    expect(f.state().pastDueSince).toBeNull(); expect(f.notices.size).toBe(0);
  });
  it("takes paid-period end from invoice lines rather than an unrelated advanced subscription period", async () => {
    const f = billingFixture(); f.subscribed(1, { paidPeriodEnd: null });
    f.setSubscription({ current_period_end: Date.parse("2026-12-01T00:00:00Z") / 1000 });
    await f.service.webhook(f.event("invoice.paid", "evt_paid_period", undefined, {
      id: "in_test", customer: "cus_test_1", subscription: "sub_test_1",
      lines: { data: [{ period: { end: Date.parse("2026-11-01T00:00:00Z") / 1000 } }] },
    }));
    expect(f.state().paidPeriodEnd).toBe("2026-11-01T00:00:00.000Z");
  });
  it("records the first paid invoice and calls the existing provisioning path only once", async () => {
    const f = billingFixture(); f.subscribed(1, { setupPaid: false });
    const event = f.event("invoice.paid", "evt_first_paid");
    await f.service.webhook(event);
    await f.service.webhook(event);
    expect(f.state().setupPaid).toBe(true);
    expect(f.activations).toEqual([1]);
    expect(enforcementMocks.reinstateForPaidInvoice).toHaveBeenCalledWith(1, "stripe", "in_test", "stripe_webhook");
  });
  it("stores subscription updates and deletion without automatic offboarding", async () => {
    const f = billingFixture(); f.subscribed();
    const sub = await f.sdk.subscriptions.retrieve();
    await f.service.webhook(f.event("customer.subscription.updated", "evt_update", undefined, { ...sub, status: "past_due" }));
    expect(f.state().status).toBe("past_due");
    await f.service.webhook(f.event("customer.subscription.deleted", "evt_delete", undefined, { ...sub, status: "canceled" }));
    expect(f.state().status).toBe("canceled"); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled();
  });
  it("ignores stale subscription updates", async () => {
    const f = billingFixture(); f.subscribed(); const sub = await f.sdk.subscriptions.retrieve();
    await f.service.webhook(f.event("customer.subscription.deleted", "evt_delete", new Date("2026-10-12T10:00:00Z"), { ...sub, status: "canceled" }));
    await f.service.webhook(f.event("customer.subscription.updated", "evt_update", new Date("2026-10-11T10:00:00Z"), sub));
    expect(f.state().status).toBe("canceled");
  });
  it("refuses live events and ignores unmapped Stripe customers", async () => {
    const f = billingFixture(); f.subscribed();
    await expect(f.service.webhook({ ...f.event("invoice.paid", "evt_live"), livemode: true })).rejects.toThrow("mode");
    expect(await f.service.webhook(f.event("invoice.paid", "evt_other", undefined, { id: "in_other", customer: "cus_other", subscription: "sub_other" }))).toEqual({ ignored: true });
    expect(f.events.size).toBe(0);
  });
});

describe("usage, Checkout, policy actions and isolation", () => {
  it("shows the one-time test plan only in an admin-authorized snapshot", async () => {
    const f = billingFixture();
    const owner = await f.service.snapshot(1);
    expect(owner.plans.some(plan => plan.testOnly)).toBe(false);
    const testModeAdmin = await f.service.snapshot(1, true);
    expect(testModeAdmin.plans.some(plan => plan.testOnly)).toBe(false);
    f.setMode("live");
    const admin = await f.service.snapshot(1, true);
    expect(admin.plans).toContainEqual(expect.objectContaining({
      id: "live-test-3", billingType: "one_time", oneTimeCents: 300, testOnly: true,
    }));
  });
  it("keeps the Live Test plan unavailable in Stripe test mode", async () => {
    const f = billingFixture();
    await expect(f.service.checkout(1, "live-test-3")).rejects.toThrow("only in live Stripe mode");
    expect(f.sdk.products.create).not.toHaveBeenCalled();
    expect(f.sdk.customers.create).not.toHaveBeenCalled();
    expect(f.states.has(1)).toBe(false);
  });
  it("notifies 80% and 100% once each per period, with no tier change or extra charge", async () => {
    const f = billingFixture(); f.subscribed(); f.calls.set(1, 120);
    await f.service.refresh(1); await f.service.refresh(1);
    expect(f.state().usageFlags).toEqual([80]); expect(f.notices.size).toBe(2);
    f.calls.set(1, 150); await f.service.refresh(1); await f.service.refresh(1);
    expect(f.state().usageFlags).toEqual([80, 100]); expect(f.notices.size).toBe(4);
    expect(f.state().plan).toBe("starter"); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled();
    f.state().periodStart = "2026-11-01T00:00:00Z"; f.state().periodEnd = "2026-12-01T00:00:00Z";
    await f.service.refresh(1); expect(f.notices.size).toBe(8);
  });
  it.each(["professional", "managed"] as const)("shows unlimited usage for %s", async plan => {
    const f = billingFixture(); f.subscribed(1, { plan }); f.calls.set(1, 900);
    const snapshot = await f.service.snapshot(1);
    expect(snapshot.usage).toMatchObject({ count: 900, limit: null }); expect(f.notices.size).toBe(0);
  });
  it("builds monthly and separate one-time setup line items and idempotent lookup-key Prices", async () => {
    const f = billingFixture();
    await f.service.checkout(1, "starter"); await f.service.checkout(1, "starter");
    expect(f.sdk.products.create).toHaveBeenCalledTimes(1);
    expect(f.sdk.prices.create).toHaveBeenCalledTimes(2);
    const priceProducts = f.sdk.prices.create.mock.calls.map(call => (call[0] as { product: string }).product);
    expect(new Set(priceProducts).size).toBe(1);
    expect(f.sdk.customers.create).toHaveBeenCalledTimes(1);
    const params = f.sdk.checkout.sessions.create.mock.calls[0]![0] as unknown as { line_items: object[]; success_url: string };
    expect(params.line_items).toHaveLength(2); expect(params.success_url).toBe("https://billing.example.test/billing?checkout=success");
    expect(f.sdk.checkout.sessions.create.mock.calls[0]![0]).toMatchObject({
      mode: "subscription", allowed_payment_method_types: ["card"],
    });
  });
  it("creates a runtime $3 one-time price and payment Checkout without recurring or setup prices", async () => {
    const f = billingFixture();
    f.setMode("live");
    const result = await f.service.checkout(1, "live-test-3");
    expect(result.url).toContain("live-session");
    expect(f.sdk.products.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Corvlio Live Test $3 (TEST PAYMENT)",
      metadata: { corvlio_catalog: "corvlio_v1", corvlio_plan: "live-test-3" },
    }), expect.objectContaining({ idempotencyKey: expect.stringContaining("corvlio_live_product") }));
    expect(f.sdk.prices.create).toHaveBeenCalledTimes(1);
    const price = f.sdk.prices.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(price).toMatchObject({
      unit_amount: 300, currency: "usd", metadata: { corvlio_plan: "live-test-3", corvlio_kind: "one_time" },
    });
    expect(price).not.toHaveProperty("recurring");
    const params = f.sdk.checkout.sessions.create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(params).toMatchObject({
      mode: "payment",
      allowed_payment_method_types: ["card"],
      line_items: [{ price: expect.any(String), quantity: 1 }],
      payment_intent_data: { metadata: { business_id: "1", corvlio_plan: "live-test-3", corvlio_test_payment: "true" } },
      metadata: { business_id: "1", corvlio_plan: "live-test-3", corvlio_test_payment: "true" },
    });
    expect(params).not.toHaveProperty("subscription_data");
    expect((params.line_items as unknown[])).toHaveLength(1);
  });
  it("activates a paid one-time test Checkout through the shared first-payment path exactly once", async () => {
    const f = billingFixture();
    f.setMode("live");
    await f.service.checkout(1, "live-test-3");
    const paid = f.event("checkout.session.completed", "evt_live_test_payment", undefined, {
      id: "cs_live_1",
      customer: "cus_live_1",
      mode: "payment",
      payment_status: "paid",
      amount_total: 300,
      currency: "usd",
      client_reference_id: "1",
      metadata: { business_id: "1", corvlio_plan: "live-test-3", corvlio_test_payment: "true" },
    });
    await f.service.webhook(paid);
    expect(f.state()).toMatchObject({
      plan: "live-test-3", status: "active", customerId: "cus_live_1",
      subscriptionId: null, pendingCheckout: null, setupPaid: false,
      lastEvent: { id: "evt_live_test_payment", type: "checkout.session.completed" },
    });
    expect(f.activations).toEqual([1]);
    expect(f.sdk.subscriptions.retrieve).not.toHaveBeenCalled();
    expect([...f.events.values()][0]?.detail).toContain("TEST PAYMENT");
    expect([...f.events.values()][0]?.detail).toContain("$3.00 USD one-time");
    expect(await f.service.webhook(paid)).toEqual({ replay: true });
    expect(f.activations).toEqual([1]);
  });
  it("does not activate a one-time Checkout with the wrong amount or payment status", async () => {
    const f = billingFixture();
    f.setMode("live");
    await f.service.checkout(1, "live-test-3");
    const unpaid = f.event("checkout.session.completed", "evt_unpaid_test_payment", undefined, {
      id: "cs_live_1", customer: "cus_live_1", mode: "payment", payment_status: "unpaid",
      amount_total: 300, currency: "usd", client_reference_id: "1",
      metadata: { business_id: "1", corvlio_plan: "live-test-3" },
    });
    await expect(f.service.webhook(unpaid)).rejects.toThrow("does not match");
    expect(f.activations).toEqual([]);
    expect(f.state().status).toBe("not_subscribed");
    expect(f.events.size).toBe(0);
  });
  it("prevents another live test charge after the one-time account activation", async () => {
    const f = billingFixture();
    f.setMode("live");
    await f.service.checkout(1, "live-test-3");
    const paid = f.event("checkout.session.completed", "evt_live_test_once", undefined, {
      id: "cs_live_1", customer: "cus_live_1", mode: "payment", payment_status: "paid",
      amount_total: 300, currency: "usd", client_reference_id: "1",
      metadata: { business_id: "1", corvlio_plan: "live-test-3", corvlio_test_payment: "true" },
    });
    await f.service.webhook(paid);
    await expect(f.service.checkout(1, "live-test-3")).rejects.toThrow("unactivated business");
    expect(f.sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it("uses only live-mode Stripe catalog objects and Checkout in explicit live mode", async () => {
    const f = billingFixture(); f.setMode("live");
    const result = await f.service.checkout(1, "starter");
    expect(result.url).toContain("live-session");
    expect(f.sdk.products.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { corvlio_catalog: "corvlio_v1", corvlio_plan: "starter" },
    }), expect.objectContaining({ idempotencyKey: expect.stringContaining("corvlio_live_product") }));
    expect(f.sdk.prices.create.mock.calls.every(call => (call[0] as { lookup_key: string }).lookup_key.startsWith("corvlio_live_"))).toBe(true);
  });
  it("accepts live webhooks only while the service is in live mode", async () => {
    const f = billingFixture(); f.setMode("live"); f.subscribed();
    await f.service.webhook(f.event("invoice.payment_failed", "evt_live"));
    expect(f.state().status).toBe("past_due");
    const testEvent = { ...f.event("invoice.payment_failed", "evt_test_mode"), livemode: false } as unknown as import("stripe").default.Event;
    await expect(f.service.webhook(testEvent)).rejects.toThrow("mode");
  });
  it("does not charge a paid setup fee again or create duplicate active subscriptions", async () => {
    const f = billingFixture(); f.subscribed();
    await expect(f.service.checkout(1, "starter")).rejects.toThrow("Use Upgrade");
    f.state().status = "canceled";
    await f.service.checkout(1, "starter");
    expect((f.sdk.checkout.sessions.create.mock.calls[0]![0] as unknown as { line_items: unknown[] }).line_items).toHaveLength(1);
  });
  it("reuses an open Checkout instead of creating a second payable session", async () => {
    const f = billingFixture(); await f.service.checkout(1, "starter"); await f.service.checkout(1, "starter");
    expect(f.sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it("expires a pre-card-only Checkout and uses a new idempotency namespace", async () => {
    const f = billingFixture();
    f.subscribed(1, { status: "canceled", pendingCheckout: {
      id: "cs_old", plan: "starter", fingerprint: "previous_dynamic_methods",
    } });
    f.sdk.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: "cs_old", status: "open", url: "https://checkout.stripe.com/old-session", livemode: false,
    });
    await f.service.checkout(1, "starter");
    expect(f.sdk.checkout.sessions.expire).toHaveBeenCalledWith("cs_old");
    expect(f.sdk.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_payment_method_types: ["card"] }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining("checkout_card_only_") }),
    );
    expect(f.state().pendingCheckout?.fingerprint).toMatch(/:card_only$/);
  });
  it("expires the previous open Checkout when a different plan is chosen", async () => {
    const f = billingFixture(); await f.service.checkout(1, "starter"); await f.service.checkout(1, "professional");
    expect(f.sdk.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_1");
    expect(f.state().pendingCheckout?.plan).toBe("professional");
  });
  it("does not create a second subscription while a completed Checkout awaits its webhook", async () => {
    const f = billingFixture(); await f.service.checkout(1, "starter");
    f.sdk.checkout.sessions.retrieve.mockResolvedValueOnce({ id: "cs_test_1", status: "complete", url: "", livemode: false });
    await expect(f.service.checkout(1, "professional")).rejects.toThrow("wait for Stripe confirmation");
    expect(f.sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it("requires admin Startup assignment and records its six-month transition without switching", async () => {
    const f = billingFixture();
    await expect(f.service.checkout(1, "startup")).rejects.toThrow("admin");
    await f.service.startupEligibility(1, true, "admin-actor");
    await f.service.checkout(1, "startup");
    f.setSubscription({ metadata: { corvlio_plan: "startup" }, items: { data: [{
      id: "si_startup", price: { id: "price_startup", metadata: { corvlio_plan: "startup" } },
      current_period_start: 1790841600, current_period_end: 1793520000,
    }] } });
    await f.service.webhook(f.event("checkout.session.completed", "evt_startup"));
    expect(f.state().startupTransitionAt).toBe("2027-04-01T00:00:00.000Z");
    f.setNow("2027-05-01T00:00:00Z"); await f.service.refresh(1);
    expect(f.state().plan).toBe("startup"); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled();
  });
  it("schedules cancel_at, logs written actor/time, confirms once and resumes before effective date", async () => {
    const f = billingFixture(); f.subscribed();
    const canceled = await f.service.cancel(1, "owner-1"); await f.service.cancel(1, "owner-1");
    expect(canceled).toMatchObject({ cancelAt: "2026-11-09T10:00:00.000Z", cancelRequestedAt: "2026-10-10T10:00:00.000Z", cancelRequestedBy: "owner-1" });
    const params = f.sdk.subscriptions.update.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(params).toEqual({ cancel_at: Date.parse(canceled.cancelAt!) / 1000, proration_behavior: "none" });
    expect(params).not.toHaveProperty("cancel_at_period_end"); expect(f.notices.size).toBe(2);
    await f.service.resume(1, "owner-1"); expect(f.state().cancelAt).toBeNull();
    expect(f.sdk.subscriptions.update.mock.calls[1]![1]).toEqual({ cancel_at: "", cancel_at_period_end: false });
    expect([...f.events.values()].map(e => e.actor)).toContain("owner-1");
  });
  it("does not resume at or after the effective date", async () => {
    const f = billingFixture(); f.subscribed(); await f.service.cancel(1, "owner-1");
    f.setNow(f.state().cancelAt!); await expect(f.service.resume(1, "owner-1")).rejects.toThrow("No future");
  });
  it("owner A actions leave owner B completely unchanged", async () => {
    const f = billingFixture(); f.subscribed(1); f.subscribed(2); const before = structuredClone(f.state(2));
    f.calls.set(1, 150); f.calls.set(2, 1);
    await f.service.cancel(1, "owner-1"); await f.service.refresh(1);
    expect(f.state(2)).toEqual(before); expect([...f.events.values()].every(e => e.businessId === 1)).toBe(true);
  });
  it("uses a card-only hosted portal so Portal cannot bypass cancellation notice", async () => {
    const f = billingFixture(); f.subscribed(); await f.service.portal(1);
    expect(f.sdk.billingPortal.configurations.create.mock.calls[0]![0]).toMatchObject({
      features: { subscription_cancel: { enabled: false }, subscription_update: { enabled: false } },
    });
    expect(f.sdk.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_test_1", configuration: "bpc_test", return_url: "https://billing.example.test/billing",
    });
  });
  it("upgrades only explicitly, without setup fees or per-call charges", async () => {
    const f = billingFixture(); f.subscribed(); await f.service.upgrade(1, "professional", "owner-1");
    expect(f.state().plan).toBe("professional");
    expect(f.sdk.subscriptions.update.mock.calls[0]![1]).toMatchObject({ proration_behavior: "none", metadata: { corvlio_plan: "professional" } });
    await expect(f.service.upgrade(1, "startup", "owner-1")).rejects.toThrow("Only explicit");
  });
});

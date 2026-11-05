import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminLivePaymentTestService,
  type AdminLivePaymentTestStore,
} from "../../src/billing/adminLivePaymentTest";
import { ensurePlanPrices } from "../../src/billing/stripeClient";

function makeStore() {
  const records = new Map<string, {
    id: string;
    adminUserId: string;
    stripeSessionId: string | null;
    status: "creating" | "pending" | "paid" | "expired" | "failed";
    stripeEventId: string | null;
    stripeEventType: string | null;
    createdAt: Date;
    paidAt: Date | null;
  }>();
  const store: AdminLivePaymentTestStore = {
    create: vi.fn(async (id, adminUserId) => {
      records.set(id, {
        id, adminUserId, stripeSessionId: null, status: "creating",
        stripeEventId: null, stripeEventType: null, createdAt: new Date("2026-11-05T00:00:00.000Z"), paidAt: null,
      });
    }),
    attachSession: vi.fn(async (id, adminUserId, sessionId) => {
      const record = records.get(id);
      if (!record || record.adminUserId !== adminUserId) return false;
      record.stripeSessionId = sessionId;
      if (record.status === "creating") record.status = "pending";
      return record.status === "pending" || record.status === "paid";
    }),
    markFailed: vi.fn(async (id) => {
      const record = records.get(id);
      if (record?.status === "creating") record.status = "failed";
    }),
    get: vi.fn(async (id, adminUserId) => {
      const record = records.get(id);
      return record?.adminUserId === adminUserId ? record : null;
    }),
    recordWebhook: vi.fn(async (input) => {
      const record = records.get(input.testId);
      if (!record || record.adminUserId !== input.adminUserId) return "missing";
      if (record.stripeSessionId && record.stripeSessionId !== input.sessionId) return "conflict";
      if (record.status === input.status && record.stripeEventId === input.eventId) return "replay";
      if (record.status === "paid" || record.status === "expired") return "replay";
      record.stripeSessionId = input.sessionId;
      record.stripeEventId = input.eventId;
      record.stripeEventType = input.eventType;
      record.status = input.status;
      record.paidAt = input.paidAt;
      return "recorded";
    }),
  };
  return { store, records };
}

function makeService(liveEnabled = true) {
  const { store, records } = makeStore();
  const createSession = vi.fn(async () => ({
    id: "cs_live_admin_test",
    url: "https://checkout.stripe.com/c/pay/cs_live_admin_test",
    livemode: true,
    mode: "payment",
  }));
  const stripe = { checkout: { sessions: { create: createSession } } } as unknown as Stripe;
  const priceEnsurer = vi.fn(async () => ({ oneTime: "price_live_admin_test" })) as unknown as typeof ensurePlanPrices;
  const service = new AdminLivePaymentTestService(store, () => stripe, priceEnsurer, () => liveEnabled,
    () => new Date("2026-11-05T00:00:00.000Z"));
  return { service, store, records, createSession, priceEnsurer };
}

function sessionEvent(input: {
  type?: "checkout.session.completed" | "checkout.session.expired";
  testId: string;
  amount?: number;
  paymentStatus?: string;
  eventId?: string;
  adminUserId?: string;
  sessionId?: string;
}): Stripe.Event {
  const adminUserId = input.adminUserId ?? "user_verified_admin";
  return {
    id: input.eventId ?? "evt_admin_live_test",
    type: input.type ?? "checkout.session.completed",
    livemode: true,
    created: 1793836800,
    data: {
      object: {
        id: input.sessionId ?? "cs_live_admin_test",
        livemode: true,
        mode: "payment",
        payment_status: input.paymentStatus ?? "paid",
        amount_total: input.amount ?? 300,
        currency: "usd",
        client_reference_id: adminUserId,
        metadata: {
          corvlio_admin_live_payment_test: "true",
          admin_live_payment_test_id: input.testId,
          admin_user_id: adminUserId,
          corvlio_plan: "live-test-3",
        },
      },
    },
  } as unknown as Stripe.Event;
}

afterEach(() => vi.unstubAllEnvs());

describe("admin live payment test", () => {
  it("creates a live card-only $3 Checkout without a customer or subscription", async () => {
    vi.stubEnv("PUBLIC_API_BASE_URL", "https://billing.example.test/api");
    const { service, store, createSession, priceEnsurer } = makeService();
    const result = await service.createCheckout("user_verified_admin");
    const params = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;

    expect(result).toEqual({
      testId: expect.any(String),
      url: "https://checkout.stripe.com/c/pay/cs_live_admin_test",
    });
    expect(priceEnsurer).toHaveBeenCalledWith(expect.anything(), "live-test-3", "live");
    expect(params).toMatchObject({
      mode: "payment",
      allowed_payment_method_types: ["card"],
      client_reference_id: "user_verified_admin",
      line_items: [{ price: "price_live_admin_test", quantity: 1 }],
      metadata: {
        corvlio_admin_live_payment_test: "true",
        admin_live_payment_test_id: result.testId,
        admin_user_id: "user_verified_admin",
        corvlio_plan: "live-test-3",
      },
      payment_intent_data: { metadata: { admin_live_payment_test_id: result.testId } },
      success_url: `https://billing.example.test/admin/billing?adminLivePaymentTestId=${result.testId}`,
      cancel_url: `https://billing.example.test/admin/billing?adminLivePaymentTestId=${result.testId}&checkout=canceled`,
      expires_at: 1793840400,
    });
    expect(params).not.toHaveProperty("customer");
    expect(params).not.toHaveProperty("customer_creation");
    expect(params).not.toHaveProperty("subscription_data");
    expect(params.line_items).toHaveLength(1);
    expect(store.attachSession).toHaveBeenCalledWith(result.testId, "user_verified_admin", "cs_live_admin_test");
  });

  it("refuses checkout unless the live gate is enabled", async () => {
    const { service, store, createSession } = makeService(false);
    await expect(service.createCheckout("user_verified_admin")).rejects.toThrow("only while live billing is enabled");
    expect(store.create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("records paid status only after the signed Checkout webhook and scopes it to its admin", async () => {
    const { service, store, records } = makeService();
    const created = await service.createCheckout("user_verified_admin");
    const event = sessionEvent({ testId: created.testId });
    await expect(service.handleWebhook(event)).resolves.toEqual({ processed: true });

    expect(store.recordWebhook).toHaveBeenCalledWith(expect.objectContaining({
      testId: created.testId,
      adminUserId: "user_verified_admin",
      sessionId: "cs_live_admin_test",
      eventId: "evt_admin_live_test",
      eventType: "checkout.session.completed",
      status: "paid",
    }));
    await expect(service.getStatus(created.testId, "user_verified_admin")).resolves.toMatchObject({
      status: "paid",
      webhookReceived: true,
      paidAt: "2026-11-05T00:00:00.000Z",
    });
    await expect(service.getStatus(created.testId, "another_admin")).rejects.toThrow("not found");
    expect(records.get(created.testId)?.adminUserId).toBe("user_verified_admin");
  });

  it("rejects an amount mismatch without recording it as paid", async () => {
    const { service, store } = makeService();
    const created = await service.createCheckout("user_verified_admin");
    await expect(service.handleWebhook(sessionEvent({ testId: created.testId, amount: 301 })))
      .rejects.toThrow("does not match the $3 one-time test");
    expect(store.recordWebhook).not.toHaveBeenCalled();
    await expect(service.getStatus(created.testId, "user_verified_admin")).resolves.toMatchObject({
      status: "pending",
      webhookReceived: false,
      paidAt: null,
    });
  });

  it("records an expired session without changing any business billing state", async () => {
    const { service, store } = makeService();
    const created = await service.createCheckout("user_verified_admin");
    await expect(service.handleWebhook(sessionEvent({
      type: "checkout.session.expired",
      testId: created.testId,
      paymentStatus: "unpaid",
    }))).resolves.toEqual({ processed: true });
    await expect(service.getStatus(created.testId, "user_verified_admin")).resolves.toMatchObject({
      status: "expired",
      webhookReceived: true,
      paidAt: null,
    });
    expect(store.recordWebhook).toHaveBeenCalledWith(expect.objectContaining({
      status: "expired",
      eventType: "checkout.session.expired",
    }));
  });

  it("leaves normal customer Checkout events to the existing billing service", async () => {
    const { service, store } = makeService();
    const normalEvent = sessionEvent({ testId: "not-used" });
    const session = normalEvent.data.object as Stripe.Checkout.Session;
    session.metadata = { corvlio_plan: "starter" };
    await expect(service.handleWebhook(normalEvent)).resolves.toBeNull();
    expect(store.recordWebhook).not.toHaveBeenCalled();
  });
});

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type Stripe from "stripe";
import { adminLivePaymentTestsTable, db, type AdminLivePaymentTestStatus } from "@workspace/db";
import { BillingError, billingUrl, config, isOneTimePlan, isTestPlan } from "./policy";
import { billingEnabled, configuredBillingMode, ensurePlanPrices, getBillingStripe } from "./stripeClient";

type TestRecord = typeof adminLivePaymentTestsTable.$inferSelect;
type WebhookResult = "recorded" | "replay" | "missing" | "conflict";

export interface AdminLivePaymentTestStore {
  create(testId: string, adminUserId: string): Promise<void>;
  attachSession(testId: string, adminUserId: string, sessionId: string): Promise<boolean>;
  markFailed(testId: string, adminUserId: string): Promise<void>;
  get(testId: string, adminUserId: string): Promise<TestRecord | null>;
  recordWebhook(input: {
    testId: string;
    adminUserId: string;
    sessionId: string;
    eventId: string;
    eventType: string;
    status: "paid" | "expired";
    paidAt: Date | null;
  }): Promise<WebhookResult>;
}

const databaseStore: AdminLivePaymentTestStore = {
  async create(testId, adminUserId) {
    await db.insert(adminLivePaymentTestsTable).values({
      id: testId,
      adminUserId,
      status: "creating",
    });
  },
  async attachSession(testId, adminUserId, sessionId) {
    const updated = await db.update(adminLivePaymentTestsTable)
      .set({ stripeSessionId: sessionId, status: "pending" })
      .where(and(
        eq(adminLivePaymentTestsTable.id, testId),
        eq(adminLivePaymentTestsTable.adminUserId, adminUserId),
        eq(adminLivePaymentTestsTable.status, "creating"),
      ))
      .returning({ id: adminLivePaymentTestsTable.id });
    if (updated.length) return true;
    const existing = await this.get(testId, adminUserId);
    return existing?.stripeSessionId === sessionId && existing.status === "paid";
  },
  async markFailed(testId, adminUserId) {
    await db.update(adminLivePaymentTestsTable)
      .set({ status: "failed" })
      .where(and(
        eq(adminLivePaymentTestsTable.id, testId),
        eq(adminLivePaymentTestsTable.adminUserId, adminUserId),
        eq(adminLivePaymentTestsTable.status, "creating"),
      ));
  },
  async get(testId, adminUserId) {
    const [record] = await db.select().from(adminLivePaymentTestsTable)
      .where(and(
        eq(adminLivePaymentTestsTable.id, testId),
        eq(adminLivePaymentTestsTable.adminUserId, adminUserId),
      ))
      .limit(1);
    return record ?? null;
  },
  async recordWebhook(input) {
    const existing = await this.get(input.testId, input.adminUserId);
    if (!existing) return "missing";
    if (existing.stripeSessionId && existing.stripeSessionId !== input.sessionId) return "conflict";
    if (existing.status === input.status && existing.stripeEventId === input.eventId) return "replay";
    if (existing.status === "paid" || existing.status === "expired") return "replay";

    const updated = await db.update(adminLivePaymentTestsTable)
      .set({
        stripeSessionId: input.sessionId,
        stripeEventId: input.eventId,
        stripeEventType: input.eventType,
        status: input.status,
        paidAt: input.paidAt,
      })
      .where(and(
        eq(adminLivePaymentTestsTable.id, input.testId),
        eq(adminLivePaymentTestsTable.adminUserId, input.adminUserId),
        or(isNull(adminLivePaymentTestsTable.stripeSessionId), eq(adminLivePaymentTestsTable.stripeSessionId, input.sessionId)),
        inArray(adminLivePaymentTestsTable.status, ["creating", "pending"]),
      ))
      .returning({ id: adminLivePaymentTestsTable.id });
    if (updated.length) return "recorded";

    const current = await this.get(input.testId, input.adminUserId);
    if (current?.stripeEventId === input.eventId) return "replay";
    return "conflict";
  },
};

function isLiveBillingEnabled(): boolean {
  return billingEnabled() && configuredBillingMode() === "live";
}

function assertLiveBillingEnabled(): void {
  if (!isLiveBillingEnabled()) {
    throw new BillingError("The live payment test is available only while live billing is enabled.", 404);
  }
}

function publicStatus(record: TestRecord) {
  return {
    testId: record.id,
    status: record.status as AdminLivePaymentTestStatus,
    webhookReceived: Boolean(record.stripeEventId),
    createdAt: record.createdAt.toISOString(),
    paidAt: record.paidAt?.toISOString() ?? null,
  };
}

export class AdminLivePaymentTestService {
  constructor(
    private readonly store: AdminLivePaymentTestStore = databaseStore,
    private readonly stripeClient: () => Stripe = getBillingStripe,
    private readonly priceEnsurer: typeof ensurePlanPrices = ensurePlanPrices,
    private readonly liveEnabled: () => boolean = isLiveBillingEnabled,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCheckout(adminUserId: string) {
    if (!this.liveEnabled()) {
      throw new BillingError("The live payment test is available only while live billing is enabled.", 404);
    }
    const plan = config.plans.find(candidate => candidate.id === "live-test-3");
    if (!plan || !isOneTimePlan(plan) || !isTestPlan(plan)
      || plan.oneTimeCents !== 300 || plan.setupCents !== 0) {
      throw new BillingError("The locked $3 live test plan is unavailable.", 503);
    }

    const testId = randomUUID();
    await this.store.create(testId, adminUserId);
    try {
      const stripe = this.stripeClient();
      const prices = await this.priceEnsurer(stripe, plan.id, "live");
      if (!prices.oneTime) throw new BillingError("The $3 live test price is unavailable.", 503);

      const metadata = {
        corvlio_admin_live_payment_test: "true",
        admin_live_payment_test_id: testId,
        admin_user_id: adminUserId,
        corvlio_plan: plan.id,
      };
      const returnUrl = billingUrl("/admin/billing");
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        allowed_payment_method_types: ["card"],
        client_reference_id: adminUserId,
        line_items: [{ price: prices.oneTime, quantity: 1 }],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${returnUrl}?adminLivePaymentTestId=${testId}`,
        cancel_url: `${returnUrl}?adminLivePaymentTestId=${testId}&checkout=canceled`,
        expires_at: Math.floor(this.now().getTime() / 1000) + 60 * 60,
      }, { idempotencyKey: `corvlio_admin_live_payment_test_v1_${testId}` });

      if (!session.url || session.livemode !== true || session.mode !== "payment") {
        throw new BillingError("Stripe did not return a live one-time Checkout session.", 502);
      }
      if (!await this.store.attachSession(testId, adminUserId, session.id)) {
        throw new BillingError("The live test Checkout could not be recorded.", 503);
      }
      return { testId, url: session.url };
    } catch (error) {
      await this.store.markFailed(testId, adminUserId).catch(() => undefined);
      throw error;
    }
  }

  async getStatus(testId: string, adminUserId: string) {
    if (!this.liveEnabled()) {
      throw new BillingError("The live payment test is available only while live billing is enabled.", 404);
    }
    const record = await this.store.get(testId, adminUserId);
    if (!record) throw new BillingError("Live payment test not found.", 404);
    return publicStatus(record);
  }

  async handleWebhook(event: Stripe.Event) {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return null;
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};
    if (metadata.corvlio_admin_live_payment_test !== "true") return null;
    if (!this.liveEnabled() || event.livemode !== true) {
      throw new BillingError("Admin live payment test mode does not match configured Stripe mode.", 401);
    }

    const testId = metadata.admin_live_payment_test_id ?? "";
    const adminUserId = metadata.admin_user_id ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId)
      || !adminUserId || metadata.corvlio_plan !== "live-test-3"
      || session.livemode !== true || session.mode !== "payment" || session.client_reference_id !== adminUserId) {
      throw new BillingError("Admin live payment test metadata is invalid.", 409);
    }

    let status: "paid" | "expired";
    let paidAt: Date | null;
    if (event.type === "checkout.session.completed") {
      if (session.payment_status !== "paid" || session.amount_total !== 300 || session.currency !== "usd") {
        throw new BillingError("Admin live payment does not match the $3 one-time test.", 409);
      }
      status = "paid";
      paidAt = new Date(event.created * 1000);
    } else {
      status = "expired";
      paidAt = null;
    }

    const result = await this.store.recordWebhook({
      testId,
      adminUserId,
      sessionId: session.id,
      eventId: event.id,
      eventType: event.type,
      status,
      paidAt,
    });
    if (result === "missing") throw new BillingError("Admin live payment test record is missing.", 503);
    if (result === "conflict") throw new BillingError("Admin live payment test record does not match this Checkout.", 409);
    return result === "replay" ? { replay: true } : { processed: true };
  }
}

export const adminLivePaymentTestService = new AdminLivePaymentTestService();

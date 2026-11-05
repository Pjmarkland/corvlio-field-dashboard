import type Stripe from "stripe";
import {
  billingAccountsTable,
  billingEnforcementEventsTable,
  billingEnforcementSettingsTable,
  billingNoticesTable,
  businessAdminEventsTable,
  businessesTable,
  db,
  manualInvoicesTable,
  pool,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { addBusinessDays } from "./policy";
import { billingEnabled, getBillingStripe } from "./stripeClient";
import {
  evaluateEnforcementCandidate,
  type BillingEnforcementMode,
  type EnforcementCandidate,
  type WarningDay,
} from "./enforcementCore";

const SETTINGS_ID = 1;
const BUSINESS_LOCK_NAMESPACE = 542313;
const MODE_VALUES = new Set<BillingEnforcementMode>(["off", "dry_run", "enforce"]);
const ACTIVE_DISPUTE_STATUSES = new Set([
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
]);
const CLOSED_DISPUTE_STATUSES = new Set(["warning_closed", "charge_refunded", "won", "lost"]);

function modeOrOff(value: unknown): BillingEnforcementMode {
  return typeof value === "string" && MODE_VALUES.has(value as BillingEnforcementMode)
    ? value as BillingEnforcementMode
    : "off";
}

function idempotencyKey(
  action: string,
  candidate: EnforcementCandidate,
  suffix = "",
): string {
  return `billing-enforcement:${action}:${candidate.source}:${candidate.businessId}:${candidate.invoiceId}:${candidate.graceStartedAt.getTime()}${suffix ? `:${suffix}` : ""}`.slice(0, 240);
}

function warningNoticeId(candidate: EnforcementCandidate, day: WarningDay, audience: "owner" | "admin") {
  return `billing-enforcement:warning:${candidate.source}:${candidate.businessId}:${candidate.invoiceId}:${candidate.graceStartedAt.getTime()}:day-${day}:${audience}`.slice(0, 250);
}

function eventNoticeId(eventId: number, audience: "owner" | "admin") {
  return `billing-enforcement:event:${eventId}:${audience}`.slice(0, 250);
}

function stripeReason(candidate: EnforcementCandidate) {
  return `Stripe invoice ${candidate.invoiceId} remained open and unpaid after the five-business-day grace period; live invoice and subscription checks confirmed it is still past due and no active dispute was found.`;
}

function manualReason(candidate: EnforcementCandidate) {
  return `Manual invoice ${candidate.invoiceId} remained unpaid after the five-business-day grace period that began when an admin confirmed it overdue.`;
}

function reasonFor(candidate: EnforcementCandidate) {
  return candidate.source === "stripe" ? stripeReason(candidate) : manualReason(candidate);
}

function noticeBody(candidate: EnforcementCandidate, day: WarningDay) {
  const when = day === 3 ? "three" : "five";
  const invoiceLabel = candidate.source === "manual" ? `manual invoice ${candidate.invoiceId}` : "Stripe invoice";
  const action = day === 3
    ? "Your service remains on during the grace period. Please resolve the balance or contact Corvlio if you have already paid."
    : "This is the final scheduled reminder. After the grace period, AI call answering and dashboard access may be paused if the invoice remains unpaid and Stripe confirms the invoice is still past due.";
  return `This is the day-${day} notice for ${invoiceLabel}. The account is still within its five-business-day review period. ${action}`;
}

function noticeTitle(day: WarningDay) {
  return day === 3 ? "Payment reminder — service remains active" : "Final payment reminder";
}

function asStringId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

type InvoiceWithPaymentData = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
  payments?: {
    has_more?: boolean;
    data?: Array<{
      payment?: {
        type?: string;
        payment_intent?: string | { id: string } | null;
      };
    }>;
  };
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null };
  } | null;
};

type SubscriptionWithLatestInvoice = Stripe.Subscription & {
  latest_invoice?: string | { id: string } | null;
};

function invoiceSubscriptionId(invoice: InvoiceWithPaymentData): string | null {
  return asStringId(invoice.subscription ?? invoice.parent?.subscription_details?.subscription);
}

function invoicePaymentIntentIds(invoice: InvoiceWithPaymentData): string[] | null {
  if (invoice.payments && Array.isArray(invoice.payments.data)) {
    if (invoice.payments.has_more) return null;
    const ids = invoice.payments.data.flatMap(payment => {
      if (payment.payment?.type && payment.payment.type !== "payment_intent") return [];
      const id = asStringId(payment.payment?.payment_intent);
      return id ? [id] : [];
    });
    return [...new Set(ids)];
  }
  if (Object.prototype.hasOwnProperty.call(invoice, "payment_intent")) {
    const id = asStringId(invoice.payment_intent);
    return id ? [id] : [];
  }
  return null;
}

function paymentIntentStatusAllowed(status: string): boolean {
  return status === "requires_payment_method" || status === "canceled";
}

/**
 * Never infer unpaid status from local cache. Any missing relationship, provider
 * error, unsupported payment shape, timeout, active dispute, or unknown status
 * leaves the account active.
 */
export async function verifyStripeInvoiceStillPastDue(
  candidate: EnforcementCandidate,
  stripe: Stripe = getBillingStripe(),
): Promise<boolean> {
  if (candidate.source !== "stripe"
    || !candidate.stripeCustomerId
    || !candidate.stripeSubscriptionId
    || !candidate.invoiceId) return false;

  try {
    const [invoiceResponse, subscriptionResponse] = await Promise.all([
      stripe.invoices.retrieve(candidate.invoiceId),
      stripe.subscriptions.retrieve(candidate.stripeSubscriptionId),
    ]);
    const invoice = invoiceResponse as InvoiceWithPaymentData;
    const subscription = subscriptionResponse as SubscriptionWithLatestInvoice;
    const invoiceCustomerId = asStringId(invoice.customer);
    const subscriptionCustomerId = asStringId(subscription.customer);
    const latestInvoiceId = asStringId(subscription.latest_invoice);

    if (invoice.id !== candidate.invoiceId
      || invoice.status !== "open"
      || invoice.paid !== false
      || typeof invoice.amount_remaining !== "number"
      || invoice.amount_remaining <= 0
      || invoiceCustomerId !== candidate.stripeCustomerId
      || invoiceSubscriptionId(invoice) !== candidate.stripeSubscriptionId
      || subscription.id !== candidate.stripeSubscriptionId
      || subscriptionCustomerId !== candidate.stripeCustomerId
      || subscription.status !== "past_due"
      || latestInvoiceId !== candidate.invoiceId) return false;

    const paymentIntentIds = invoicePaymentIntentIds(invoice);
    if (paymentIntentIds === null) return false;
    for (const paymentIntentId of paymentIntentIds) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      });
      if (!paymentIntentStatusAllowed(intent.status)) return false;
      const disputes = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 100 });
      if (disputes.has_more) return false;
      for (const dispute of disputes.data) {
        if (ACTIVE_DISPUTE_STATUSES.has(dispute.status)) return false;
        if (!CLOSED_DISPUTE_STATUSES.has(dispute.status)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function readModeInTransaction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  await tx.insert(billingEnforcementSettingsTable)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing();
  const [settings] = await tx.select().from(billingEnforcementSettingsTable)
    .where(eq(billingEnforcementSettingsTable.id, SETTINGS_ID))
    .for("update");
  return settings ? modeOrOff(settings.mode) : "off";
}

async function recordEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  candidate: EnforcementCandidate | null,
  input: {
    key: string;
    action: "would_suspend" | "warning_day_3" | "warning_day_5" | "suspended" | "reinstated" | "manual_overdue_confirmed" | "mode_changed" | "override_changed";
    source: "stripe" | "manual" | "system";
    invoiceId?: string | null;
    actor?: string | null;
    reason: string;
    details?: Record<string, unknown>;
    businessName?: string | null;
  },
  notification?: {
    audience: "owner" | "admin";
    title: string;
    body: string;
    id?: string;
  },
) {
  const [event] = await tx.insert(billingEnforcementEventsTable).values({
    idempotencyKey: input.key,
    businessId: candidate?.businessId ?? null,
    businessName: candidate?.businessName ?? input.businessName ?? null,
    source: input.source,
    invoiceId: input.invoiceId ?? candidate?.invoiceId ?? null,
    action: input.action,
    actor: input.actor ?? null,
    reason: input.reason,
    details: input.details ?? {},
  }).onConflictDoNothing().returning({ id: billingEnforcementEventsTable.id });
  if (!event || !notification || !candidate) return Boolean(event);
  await tx.insert(billingNoticesTable).values({
    id: notification.id ?? eventNoticeId(event.id, notification.audience),
    businessId: candidate.businessId,
    audience: notification.audience,
    title: notification.title,
    body: `${candidate.businessName}\n\n${notification.body}`,
    delivery: { email: false, push: false },
    nextAttemptAt: new Date(),
  }).onConflictDoNothing();
  return true;
}

function parseJsonDate(value: unknown): Date | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value);
}

function sameInstant(left: Date | null, right: Date): boolean {
  return Boolean(left && left.getTime() === right.getTime());
}

async function candidateStillCurrent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  candidate: EnforcementCandidate,
): Promise<boolean> {
  const businessRows = await tx.execute(sql`
    SELECT id, business_name, owner_email, billing_mode, account_status,
      never_auto_suspend, billing_enforcement_suspended_at, is_internal, is_sample
    FROM businesses WHERE id=${candidate.businessId} FOR UPDATE
  `);
  const business = businessRows.rows[0] as {
    id: number; business_name: string; owner_email: string | null; billing_mode: string;
    account_status: string; never_auto_suspend: boolean; billing_enforcement_suspended_at: Date | null;
    is_internal: boolean; is_sample: boolean;
  } | undefined;
  if (!business || business.is_internal || business.is_sample || business.never_auto_suspend
    || business.account_status !== "active" || business.billing_enforcement_suspended_at
    || business.billing_mode !== candidate.source) return false;

  if (candidate.source === "stripe") {
    const accountRows = await tx.execute(sql`
      SELECT state FROM billing_accounts WHERE business_id=${candidate.businessId} FOR UPDATE
    `);
    const state = accountRows.rows[0]?.state as Record<string, unknown> | undefined;
    return Boolean(state
      && state.status === "past_due"
      && state.failureInvoiceId === candidate.invoiceId
      && state.customerId === candidate.stripeCustomerId
      && state.subscriptionId === candidate.stripeSubscriptionId
      && sameInstant(parseJsonDate(state.pastDueSince), candidate.graceStartedAt)
      && sameInstant(parseJsonDate(state.graceEndsAt), candidate.graceEndsAt));
  }

  const invoiceId = Number(candidate.invoiceId);
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return false;
  const invoiceRows = await tx.execute(sql`
    SELECT i.business_id, i.paid_at, i.due_at, i.overdue_confirmed_at, b.billing_mode
    FROM manual_invoices i
    JOIN businesses b ON b.id=i.business_id
    WHERE i.id=${invoiceId}
    FOR UPDATE OF i
  `);
  const invoice = invoiceRows.rows[0] as {
    business_id: number; paid_at: Date | null; due_at: Date;
    overdue_confirmed_at: Date | null; billing_mode: string;
  } | undefined;
  return Boolean(invoice && invoice.business_id === candidate.businessId
    && invoice.billing_mode === "manual" && !invoice.paid_at
    && invoice.due_at.getTime() < Date.now()
    && sameInstant(invoice.overdue_confirmed_at, candidate.graceStartedAt));
}

function warningReason(candidate: EnforcementCandidate, day: WarningDay) {
  return `Day-${day} payment warning queued before any billing suspension. ${reasonFor(candidate)}`;
}

async function recordWouldSuspend(candidate: EnforcementCandidate): Promise<boolean> {
  return db.transaction(async tx => {
    if (await readModeInTransaction(tx) !== "dry_run") return false;
    if (!await candidateStillCurrent(tx, candidate)) return false;
    return recordEvent(tx, candidate, {
      key: idempotencyKey("would-suspend", candidate),
      action: "would_suspend",
      source: candidate.source,
      reason: `DRY RUN ONLY — no service was suspended. ${reasonFor(candidate)}`,
      details: { mode: "dry_run", graceStartedAt: candidate.graceStartedAt.toISOString() },
    }, {
      audience: "admin",
      title: "Billing enforcement dry-run candidate",
      body: `Would suspend ${candidate.businessName} for ${candidate.source} invoice ${candidate.invoiceId}. No service was changed. ${reasonFor(candidate)}`,
    });
  });
}

async function queueWarning(candidate: EnforcementCandidate, day: WarningDay): Promise<void> {
  await db.transaction(async tx => {
    if (await readModeInTransaction(tx) !== "enforce") return;
    if (!await candidateStillCurrent(tx, candidate)) return;
    const key = idempotencyKey(`warning-day-${day}`, candidate);
    const recorded = await recordEvent(tx, candidate, {
      key,
      action: day === 3 ? "warning_day_3" : "warning_day_5",
      source: candidate.source,
      reason: warningReason(candidate, day),
      details: { day, graceStartedAt: candidate.graceStartedAt.toISOString() },
    });
    if (!recorded) return;

    for (const audience of ["owner", "admin"] as const) {
      await tx.insert(billingNoticesTable).values({
        id: warningNoticeId(candidate, day, audience),
        businessId: candidate.businessId,
        audience,
        title: noticeTitle(day),
        body: noticeBody(candidate, day),
        delivery: { email: false, push: false },
        nextAttemptAt: new Date(),
      }).onConflictDoNothing();
    }
  });
}

async function warningsDelivered(candidate: EnforcementCandidate): Promise<boolean> {
  const rows = await db.select({
    id: billingNoticesTable.id,
    delivery: billingNoticesTable.delivery,
  }).from(billingNoticesTable).where(and(
    eq(billingNoticesTable.businessId, candidate.businessId),
    sql`${billingNoticesTable.id} IN (${warningNoticeId(candidate, 3, "owner")}, ${warningNoticeId(candidate, 3, "admin")}, ${warningNoticeId(candidate, 5, "owner")}, ${warningNoticeId(candidate, 5, "admin")})`,
  ));
  const expected = [
    warningNoticeId(candidate, 3, "owner"),
    warningNoticeId(candidate, 3, "admin"),
    warningNoticeId(candidate, 5, "owner"),
    warningNoticeId(candidate, 5, "admin"),
  ];
  const byId = new Map(rows.map(row => [row.id, row.delivery]));
  return expected.every(id => byId.get(id)?.email === true);
}

async function suspend(candidate: EnforcementCandidate): Promise<boolean> {
  return db.transaction(async tx => {
    if (await readModeInTransaction(tx) !== "enforce") return false;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BUSINESS_LOCK_NAMESPACE}, ${candidate.businessId})`);
    if (!await candidateStillCurrent(tx, candidate)) return false;

    const reason = reasonFor(candidate);
    const recorded = await recordEvent(tx, candidate, {
      key: idempotencyKey("suspended", candidate),
      action: "suspended",
      source: candidate.source,
      reason,
      details: { mode: "enforce", graceStartedAt: candidate.graceStartedAt.toISOString() },
    });
    if (!recorded) return false;

    await tx.update(businessesTable).set({
      accountStatus: "suspended",
      accountStatusReason: `Billing enforcement: ${reason}`.slice(0, 300),
      accountStatusUpdatedAt: new Date(),
      billingEnforcementSuspendedAt: new Date(),
      billingEnforcementInvoiceSource: candidate.source,
      billingEnforcementInvoiceId: candidate.invoiceId,
      updatedAt: new Date(),
    }).where(eq(businessesTable.id, candidate.businessId));

    await tx.insert(businessAdminEventsTable).values({
      businessId: candidate.businessId,
      actorUserId: "billing-enforcement",
      action: "suspended",
      previousValue: "active",
      newValue: "suspended",
      reason: `Billing enforcement: ${reason}`.slice(0, 300),
    });
    await tx.insert(billingNoticesTable).values({
      id: `billing-enforcement:suspension:${candidate.source}:${candidate.businessId}:${candidate.invoiceId}:${candidate.graceStartedAt.getTime()}:admin`.slice(0, 250),
      businessId: candidate.businessId,
      audience: "admin",
      title: "Billing enforcement suspended an account",
      body: `${candidate.businessName}\n\nAI call answering and dashboard access were paused. ${reason}`,
      delivery: { email: false, push: false },
      nextAttemptAt: new Date(),
    }).onConflictDoNothing();
    return true;
  });
}

async function readMode(): Promise<BillingEnforcementMode> {
  const [settings] = await db.select().from(billingEnforcementSettingsTable)
    .where(eq(billingEnforcementSettingsTable.id, SETTINGS_ID)).limit(1);
  return settings ? modeOrOff(settings.mode) : "dry_run";
}

async function listCandidates(): Promise<EnforcementCandidate[]> {
  const [stripeResult, manualResult] = await Promise.all([
    pool.query<{
      id: number; business_name: string; never_auto_suspend: boolean; state: Record<string, unknown>;
    }>(`
      SELECT b.id,b.business_name,b.never_auto_suspend,ba.state
      FROM businesses b
      JOIN billing_accounts ba ON ba.business_id=b.id
      WHERE b.billing_mode='stripe' AND b.is_internal=false AND b.is_sample=false
        AND b.billing_enforcement_suspended_at IS NULL
    `),
    pool.query<{
      id: number; business_id: number; business_name: string; never_auto_suspend: boolean;
      due_at: Date; overdue_confirmed_at: Date; billing_mode: string;
    }>(`
      SELECT i.id,i.business_id,b.business_name,b.never_auto_suspend,i.due_at,
        i.overdue_confirmed_at,b.billing_mode
      FROM manual_invoices i
      JOIN businesses b ON b.id=i.business_id
      WHERE i.paid_at IS NULL AND i.overdue_confirmed_at IS NOT NULL
        AND b.billing_mode='manual' AND b.is_internal=false AND b.is_sample=false
        AND b.billing_enforcement_suspended_at IS NULL
    `),
  ]);

  const candidates: EnforcementCandidate[] = [];
  for (const row of stripeResult.rows) {
    const state = row.state;
    const startedAt = parseJsonDate(state?.pastDueSince);
    const graceEndsAt = parseJsonDate(state?.graceEndsAt);
    const invoiceId = typeof state?.failureInvoiceId === "string" ? state.failureInvoiceId.trim() : "";
    const customerId = typeof state?.customerId === "string" ? state.customerId.trim() : "";
    const subscriptionId = typeof state?.subscriptionId === "string" ? state.subscriptionId.trim() : "";
    if (state?.status !== "past_due" || !startedAt || !graceEndsAt || !invoiceId || !customerId || !subscriptionId) continue;
    candidates.push({
      businessId: row.id,
      businessName: row.business_name,
      source: "stripe",
      invoiceId,
      graceStartedAt: startedAt,
      graceEndsAt,
      neverAutoSuspend: row.never_auto_suspend,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripeStatus: String(state.status),
    });
  }
  for (const row of manualResult.rows) {
    if (!row.overdue_confirmed_at || row.due_at.getTime() >= Date.now()) continue;
    candidates.push({
      businessId: row.business_id,
      businessName: row.business_name,
      source: "manual",
      invoiceId: String(row.id),
      graceStartedAt: row.overdue_confirmed_at,
      graceEndsAt: addBusinessDays(row.overdue_confirmed_at, 5),
      neverAutoSuspend: row.never_auto_suspend,
    });
  }
  return candidates;
}

const enforcementPorts = {
  readMode,
  async verifyStripe(candidate: EnforcementCandidate) {
    return billingEnabled() && verifyStripeInvoiceStillPastDue(candidate);
  },
  recordWouldSuspend,
  queueWarning,
  warningsDelivered,
  suspend,
};

export async function runBillingEnforcementCycle(now = new Date()): Promise<void> {
  try {
    const candidates = await listCandidates();
    for (const candidate of candidates) {
      try {
        const result = await evaluateEnforcementCandidate(candidate, now, enforcementPorts);
        if (result === "verification_failed") {
          logger.warn({ businessId: candidate.businessId, source: candidate.source }, "Billing enforcement verification failed open; service remains on");
        }
      } catch (error) {
        logger.warn({
          businessId: candidate.businessId,
          source: candidate.source,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Billing enforcement candidate failed open; service remains on");
      }
    }
  } catch (error) {
    logger.warn({
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "Billing enforcement worker failed open; service remains on");
  }
}

export async function getBillingEnforcementSettings() {
  const [settings] = await db.select().from(billingEnforcementSettingsTable)
    .where(eq(billingEnforcementSettingsTable.id, SETTINGS_ID)).limit(1);
  const wouldSuspend = await db.select({
    id: billingEnforcementEventsTable.id,
    businessId: billingEnforcementEventsTable.businessId,
    businessName: billingEnforcementEventsTable.businessName,
    source: billingEnforcementEventsTable.source,
    invoiceId: billingEnforcementEventsTable.invoiceId,
    reason: billingEnforcementEventsTable.reason,
    createdAt: billingEnforcementEventsTable.createdAt,
  }).from(billingEnforcementEventsTable)
    .where(eq(billingEnforcementEventsTable.action, "would_suspend"))
    .orderBy(desc(billingEnforcementEventsTable.createdAt))
    .limit(50);
  return {
    mode: settings ? modeOrOff(settings.mode) : "dry_run" as const,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
    updatedBy: settings?.updatedBy ?? null,
    wouldSuspend: wouldSuspend.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

export async function setBillingEnforcementMode(mode: BillingEnforcementMode, actor: string) {
  return db.transaction(async tx => {
    const previousMode = await readModeInTransaction(tx);
    if (previousMode === mode) return { mode, changed: false };
    const updatedAt = new Date();
    await tx.update(billingEnforcementSettingsTable).set({
      mode,
      updatedAt,
      updatedBy: actor,
    }).where(eq(billingEnforcementSettingsTable.id, SETTINGS_ID));
    await tx.insert(billingEnforcementEventsTable).values({
      idempotencyKey: `billing-enforcement:mode:${previousMode}:${mode}:${updatedAt.getTime()}`,
      businessId: null,
      businessName: null,
      source: "system",
      invoiceId: null,
      action: "mode_changed",
      actor,
      reason: `Admin changed billing enforcement mode from ${previousMode} to ${mode}.`,
      details: { previousMode, mode },
    }).onConflictDoNothing();
    return { mode, changed: true };
  });
}

export async function setNeverAutoSuspend(businessId: number, neverAutoSuspend: boolean, actor: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BUSINESS_LOCK_NAMESPACE}, ${businessId})`);
    const rows = await tx.execute(sql`
      SELECT id,business_name,never_auto_suspend,is_internal,is_sample
      FROM businesses WHERE id=${businessId} FOR UPDATE
    `);
    const current = rows.rows[0] as {
      id: number; business_name: string; never_auto_suspend: boolean; is_internal: boolean; is_sample: boolean;
    } | undefined;
    if (!current || current.is_internal || current.is_sample) return null;
    if (current.never_auto_suspend === neverAutoSuspend) return { neverAutoSuspend, changed: false };
    await tx.update(businessesTable).set({ neverAutoSuspend, updatedAt: new Date() })
      .where(eq(businessesTable.id, businessId));
    await tx.insert(billingEnforcementEventsTable).values({
      idempotencyKey: `billing-enforcement:override:${businessId}:${neverAutoSuspend}:${Date.now()}`,
      businessId,
      businessName: current.business_name,
      source: "system",
      action: "override_changed",
      actor,
      reason: `Admin ${neverAutoSuspend ? "enabled" : "disabled"} the never-auto-suspend override.`,
      details: { previousValue: current.never_auto_suspend, newValue: neverAutoSuspend },
    }).onConflictDoNothing();
    return { neverAutoSuspend, changed: true };
  });
}

export async function confirmManualInvoiceOverdue(invoiceId: number, actor: string) {
  return db.transaction(async tx => {
    const rows = await tx.execute(sql`
      SELECT i.id,i.business_id,i.business_name,i.due_at,i.paid_at,i.overdue_confirmed_at,
        b.billing_mode,b.is_internal,b.is_sample
      FROM manual_invoices i JOIN businesses b ON b.id=i.business_id
      WHERE i.id=${invoiceId} FOR UPDATE OF i
    `);
    const invoice = rows.rows[0] as {
      id: number; business_id: number; business_name: string; due_at: Date; paid_at: Date | null;
      overdue_confirmed_at: Date | null; billing_mode: string; is_internal: boolean; is_sample: boolean;
    } | undefined;
    if (!invoice || invoice.is_internal || invoice.is_sample) return null;
    if (invoice.billing_mode !== "manual" || invoice.paid_at || invoice.due_at.getTime() >= Date.now()) {
      return { confirmed: false, reason: "Invoice must be unpaid, overdue, and assigned to manual billing." };
    }
    if (invoice.overdue_confirmed_at) {
      return { confirmed: true, confirmedAt: invoice.overdue_confirmed_at.toISOString(), changed: false };
    }
    const confirmedAt = new Date();
    await tx.update(manualInvoicesTable).set({
      overdueConfirmedAt: confirmedAt,
      overdueConfirmedBy: actor,
    }).where(eq(manualInvoicesTable.id, invoiceId));
    await tx.insert(billingEnforcementEventsTable).values({
      idempotencyKey: `billing-enforcement:manual-confirm:${invoiceId}:${confirmedAt.getTime()}`,
      businessId: invoice.business_id,
      businessName: invoice.business_name,
      source: "manual",
      invoiceId: String(invoiceId),
      action: "manual_overdue_confirmed",
      actor,
      reason: `Admin confirmed manual invoice ${invoiceId} overdue. The five-business-day enforcement review period starts at confirmation.`,
      details: { confirmedAt: confirmedAt.toISOString(), dueAt: invoice.due_at.toISOString() },
    }).onConflictDoNothing();
    return { confirmed: true, confirmedAt: confirmedAt.toISOString(), changed: true };
  });
}

export async function listManualInvoiceEnforcementStatus() {
  const result = await pool.query<{
    invoice_id: number; business_id: number; business_name: string; due_at: Date;
    paid_at: Date | null; overdue_confirmed_at: Date | null; overdue_confirmed_by: string | null;
  }>(`
    SELECT i.id AS invoice_id,i.business_id,i.business_name,i.due_at,i.paid_at,
      i.overdue_confirmed_at,i.overdue_confirmed_by
    FROM manual_invoices i JOIN businesses b ON b.id=i.business_id
    WHERE b.billing_mode='manual' AND b.is_internal=false AND b.is_sample=false
    ORDER BY i.due_at DESC,i.id DESC
  `);
  return result.rows.map(row => ({
    invoiceId: row.invoice_id,
    businessId: row.business_id,
    businessName: row.business_name,
    dueAt: row.due_at.toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
    overdueConfirmedAt: row.overdue_confirmed_at?.toISOString() ?? null,
    overdueConfirmedBy: row.overdue_confirmed_by,
  }));
}

export async function getBusinessEnforcementStatus(businessId: number) {
  const [business] = await db.select({
    id: businessesTable.id,
    businessName: businessesTable.businessName,
    neverAutoSuspend: businessesTable.neverAutoSuspend,
    accountStatus: businessesTable.accountStatus,
    suspendedAt: businessesTable.billingEnforcementSuspendedAt,
    source: businessesTable.billingEnforcementInvoiceSource,
    invoiceId: businessesTable.billingEnforcementInvoiceId,
  }).from(businessesTable).where(and(
    eq(businessesTable.id, businessId),
    eq(businessesTable.isInternal, false),
    eq(businessesTable.isSample, false),
  )).limit(1);
  if (!business) return null;
  const events = await db.select({
    id: billingEnforcementEventsTable.id,
    action: billingEnforcementEventsTable.action,
    source: billingEnforcementEventsTable.source,
    invoiceId: billingEnforcementEventsTable.invoiceId,
    actor: billingEnforcementEventsTable.actor,
    reason: billingEnforcementEventsTable.reason,
    createdAt: billingEnforcementEventsTable.createdAt,
  }).from(billingEnforcementEventsTable)
    .where(eq(billingEnforcementEventsTable.businessId, businessId))
    .orderBy(desc(billingEnforcementEventsTable.createdAt))
    .limit(50);
  return {
    neverAutoSuspend: business.neverAutoSuspend,
    accountStatus: business.accountStatus,
    suspension: business.suspendedAt && business.source && business.invoiceId ? {
      suspendedAt: business.suspendedAt.toISOString(),
      source: business.source,
      invoiceId: business.invoiceId,
    } : null,
    events: events.map(event => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}

export async function reinstateBillingSuspension(input: {
  businessId: number;
  source: "stripe" | "manual";
  invoiceId: string;
  actor: string;
  reason: string;
}) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BUSINESS_LOCK_NAMESPACE}, ${input.businessId})`);
    const rows = await tx.execute(sql`
      SELECT id,business_name,account_status,account_status_reason,
        billing_enforcement_suspended_at,billing_enforcement_invoice_source,
        billing_enforcement_invoice_id
      FROM businesses
      WHERE id=${input.businessId} AND is_internal=false AND is_sample=false
      FOR UPDATE
    `);
    const business = rows.rows[0] as {
      id: number; business_name: string; account_status: string; account_status_reason: string | null;
      billing_enforcement_suspended_at: Date | null; billing_enforcement_invoice_source: string | null;
      billing_enforcement_invoice_id: string | null;
    } | undefined;
    if (!business?.billing_enforcement_suspended_at
      || business.account_status !== "suspended"
      || business.billing_enforcement_invoice_source !== input.source
      || business.billing_enforcement_invoice_id !== input.invoiceId
      || !business.account_status_reason?.startsWith("Billing enforcement:")) return false;

    const suspendedAt = business.billing_enforcement_suspended_at;
    const reason = input.reason.trim().slice(0, 500);
    const [event] = await tx.insert(billingEnforcementEventsTable).values({
      idempotencyKey: `billing-enforcement:reinstated:${input.source}:${input.businessId}:${input.invoiceId}:${suspendedAt.getTime()}`,
      businessId: input.businessId,
      businessName: business.business_name,
      source: input.source,
      invoiceId: input.invoiceId,
      action: "reinstated",
      actor: input.actor,
      reason,
      details: { previousSuspensionReason: business.account_status_reason },
    }).onConflictDoNothing().returning({ id: billingEnforcementEventsTable.id });
    if (!event) return false;

    await tx.update(businessesTable).set({
      accountStatus: "active",
      accountStatusReason: null,
      accountStatusUpdatedAt: new Date(),
      billingEnforcementSuspendedAt: null,
      billingEnforcementInvoiceSource: null,
      billingEnforcementInvoiceId: null,
      updatedAt: new Date(),
    }).where(eq(businessesTable.id, input.businessId));
    await tx.insert(businessAdminEventsTable).values({
      businessId: input.businessId,
      actorUserId: input.actor,
      action: "restored",
      previousValue: "suspended",
      newValue: "active",
      reason: reason.slice(0, 300),
    });
    await tx.insert(billingNoticesTable).values({
      id: eventNoticeId(event.id, "admin"),
      businessId: input.businessId,
      audience: "admin",
      title: "Billing enforcement reinstated an account",
      body: `${business.business_name}\n\nService and dashboard access were restored. ${reason}`,
      delivery: { email: false, push: false },
      nextAttemptAt: new Date(),
    }).onConflictDoNothing();
    return true;
  });
}

export async function reinstateForPaidInvoice(
  businessId: number,
  source: "stripe" | "manual",
  invoiceId: string,
  actor: string,
) {
  return reinstateBillingSuspension({
    businessId,
    source,
    invoiceId,
    actor,
    reason: `${source === "stripe" ? "Stripe webhook" : "Manual payment record"} confirmed invoice ${invoiceId} paid; billing suspension was automatically lifted.`,
  });
}

export async function getManualInvoicePaidBusiness(invoiceId: number) {
  const [row] = await db.select({ businessId: manualInvoicesTable.businessId })
    .from(manualInvoicesTable)
    .where(and(eq(manualInvoicesTable.id, invoiceId), isNull(manualInvoicesTable.paidAt)))
    .limit(1);
  return row?.businessId ?? null;
}

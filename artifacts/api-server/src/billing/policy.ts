import config from "./config.json";
import type { BillingAccount } from "@workspace/api-zod";

export { config };
export type PlanId = NonNullable<BillingAccount["plan"]>;
export type BillingState = BillingAccount & {
  failureInvoiceId: string | null;
  lastPaidEventCreated: number;
  subscriptionEventCreated: number;
  pendingCheckout: { id: string; plan: PlanId; fingerprint: string } | null;
};
export function initialBillingState(): BillingState {
  return {
    plan: null, status: "not_subscribed", customerId: null, subscriptionId: null,
    periodStart: null, periodEnd: null, paidPeriodEnd: null, pastDueSince: null,
    graceEndsAt: null, needsAdminReview: false, cancelAt: null, cancelRequestedAt: null,
    cancelRequestedBy: null, startupEligible: false, startupTransitionAt: null,
    setupPaid: false, usageFlags: [], lastEvent: null,
    failureInvoiceId: null, lastPaidEventCreated: 0, subscriptionEventCreated: 0,
    pendingCheckout: null,
  };
}
export function planFor(id: string) {
  const plan = config.plans.find(p => p.id === id);
  if (!plan) throw new BillingError("Unknown plan", 400);
  return plan;
}
export class BillingError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function billingGate(env: NodeJS.ProcessEnv = process.env) {
  if (env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) return { enabled: false, reason: "live_key_refused" };
  if (env.NODE_ENV === "production") return { enabled: false, reason: "production_disabled" };
  if (env.BILLING_ENABLED !== "true") return { enabled: false, reason: "flag_off" };
  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || !env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    return { enabled: false, reason: "missing_test_credentials" };
  try {
    const base = new URL(env.PUBLIC_API_BASE_URL ?? "");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { return { enabled: false, reason: "missing_or_invalid_public_base" }; }
  return { enabled: true, reason: "test_only" };
}
export function billingUrl(path = config.operations.ownerPath, portal = false) {
  const base = (process.env.PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "").replace(/\/api$/, "");
  const url = new URL(base + path);
  if (portal) url.searchParams.set("portal", "1");
  return url.toString();
}
export function addBusinessDays(date: Date, count = config.policy.failedPaymentGraceBusinessDays) {
  const result = new Date(date);
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.policy.businessDayTimeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  });
  let added = 0;
  while (added < count) {
    result.setUTCDate(result.getUTCDate() + 1);
    const parts = Object.fromEntries(format.formatToParts(result).map(p => [p.type, p.value]));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    if (!config.policy.businessDayExcludedWeekdays.includes(weekday)
      && !config.policy.businessDayExcludedDates.includes(`${parts.year}-${parts.month}-${parts.day}` as never)) added++;
  }
  return result;
}
export function cancellationDate(state: BillingState, now: Date) {
  const noticeEnd = new Date(now);
  noticeEnd.setUTCDate(noticeEnd.getUTCDate() + config.policy.cancellationNoticeDays);
  // An invoiced-but-unpaid period is not a paid-period extension.
  return new Date(Math.max(noticeEnd.getTime(), Date.parse(state.paidPeriodEnd ?? "") || 0));
}
export function usagePeriod(state: BillingState, now: Date) {
  if (state.subscriptionId && state.periodStart && state.periodEnd)
    return { start: state.periodStart, end: state.periodEnd };
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}
export function addMonths(date: Date, months: number) {
  const day = date.getUTCDate(), result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

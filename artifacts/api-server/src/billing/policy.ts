import config from "./config.json";
import type { BillingAccount } from "@workspace/api-zod";

export { config };
export type PlanId = NonNullable<BillingAccount["plan"]>;
export type PlanConfig = (typeof config.plans)[number];
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
export function isOneTimePlan(plan: PlanConfig): plan is PlanConfig & { billingType: "one_time"; oneTimeCents: number } {
  return "billingType" in plan && plan.billingType === "one_time"
    && "oneTimeCents" in plan && typeof plan.oneTimeCents === "number";
}
export function isAdminOnlyPlan(planId: string): boolean {
  const plan = config.plans.find(p => p.id === planId);
  return !!plan && "adminOnly" in plan && plan.adminOnly === true;
}
export function isTestPlan(plan: PlanConfig): boolean {
  return "testOnly" in plan && plan.testOnly === true;
}
export function snapshotPlan(plan: PlanConfig) {
  const oneTime = isOneTimePlan(plan);
  return {
    id: plan.id,
    label: plan.label,
    monthlyCents: plan.monthlyCents,
    setupCents: plan.setupCents,
    callLimit: plan.callLimit,
    billingType: oneTime ? "one_time" as const : "recurring" as const,
    oneTimeCents: oneTime ? plan.oneTimeCents : null,
    testOnly: isTestPlan(plan),
  };
}
export class BillingError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type StripeBillingMode = "off" | "test" | "live";

export function publicApiBase(env: NodeJS.ProcessEnv = process.env): URL | null {
  try {
    const base = new URL(env.PUBLIC_API_BASE_URL ?? "");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return null;
    return base;
  } catch {
    return null;
  }
}

export function isConfiguredReplitHost(base: URL, env: NodeJS.ProcessEnv = process.env) {
  const hosts = (env.REPLIT_DOMAINS ?? "").split(",").map((value) => {
    const host = value.trim().replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase();
    return host?.replace(/:\d+$/, "");
  }).filter(Boolean);
  return hosts.includes(base.hostname.toLowerCase());
}

export function billingGate(env: NodeJS.ProcessEnv = process.env) {
  const off = (reason: string) => ({ enabled: false, mode: "off" as const, reason });
  if (env.BILLING_ENABLED !== "true") return off("flag_off");

  const liveOptIn = env.STRIPE_LIVE_MODE_ENABLED === "true";
  const secretKey = env.STRIPE_SECRET_KEY ?? "";
  if (liveOptIn) {
    if (env.NODE_ENV !== "production") return off("live_mode_requires_production");
    if (!secretKey.startsWith("sk_live_") || !env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
      return off("missing_live_credentials");
    const base = publicApiBase(env);
    if (!base || !isConfiguredReplitHost(base, env)) return off("invalid_production_base");
    return { enabled: true, mode: "live" as const, reason: "live_ready" };
  }

  if (secretKey.startsWith("sk_live_")) return off("live_mode_flag_off");
  if (env.NODE_ENV === "production") return off("production_disabled");
  if (!secretKey.startsWith("sk_test_") || !env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    return off("missing_test_credentials");
  if (!publicApiBase(env)) return off("missing_or_invalid_public_base");
  return { enabled: true, mode: "test" as const, reason: "test_only" };
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

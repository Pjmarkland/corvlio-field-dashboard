import {
  billingAccountsTable,
  businessesTable,
  db,
  leadsTable,
  provisioningAttemptsTable,
  retellCallRecordsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { config as billingConfig, initialBillingState, usagePeriod, type BillingState } from "../billing/policy";
import { logger } from "./logger";
import { recordOperationalFailure } from "./operationalFailures";
import { runNotificationOutboxNow } from "./notificationService";
import { getUsageAlertSettings } from "./usageAlertSettings";

const USAGE_ALERT_INTERVAL_MS = 5 * 60_000;
const MINUTES_PER_MILLISECOND = 1 / 60_000;

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutes(value: number): string {
  return value.toFixed(1);
}

export function getUsageAlertUtcWindow(now: Date) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { dayStart, monthStart };
}

export function usageThresholdReached(value: number, threshold: number): boolean {
  return value >= threshold;
}

export function getPlanCallThresholdCount(limit: number, percentage: number): number {
  return Math.ceil(limit * percentage / 100);
}

async function emitUsageAlert(input: {
  eventKey: string;
  summary: string;
  title: string;
  body: string;
  businessId?: number;
  businessName?: string;
  suppressEmail?: boolean;
}) {
  return recordOperationalFailure({
    eventKey: input.eventKey,
    source: "usage_alert",
    summary: input.summary,
    details: "A usage threshold was reached. This alert does not block calls, change a plan, or provision or release phone numbers.",
    businessId: input.businessId ?? null,
    businessName: input.businessName ?? null,
    suppressAlert: input.suppressEmail,
    founderPush: {
      eventKey: input.eventKey,
      title: input.title,
      body: input.body,
      deepLink: input.businessId ? `/admin/businesses/${input.businessId}` : "/admin/overview",
    },
  });
}

export async function runUsageAlertSweep(now = new Date()): Promise<number> {
  const settings = await getUsageAlertSettings();
  const { dayStart, monthStart } = getUsageAlertUtcWindow(now);
  const periodDay = dayStart.toISOString().slice(0, 10);
  const periodMonth = monthStart.toISOString().slice(0, 7);
  let insertedCount = 0;

  const [totalsResult, perBusinessResult, provisionedResult] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN r.call_started_at >= ${dayStart} THEN r.duration_ms ELSE 0 END), 0)::double precision AS daily_duration_ms,
        COALESCE(SUM(r.duration_ms), 0)::double precision AS monthly_duration_ms
      FROM ${retellCallRecordsTable} r
      INNER JOIN ${businessesTable} b ON b.id = r.business_id
      WHERE b.is_sample = false
        AND b.is_internal = false
        AND r.call_started_at >= ${monthStart}
        AND r.call_started_at < ${now}
        AND r.duration_ms > 0
    `),
    db.execute(sql`
      SELECT
        b.id AS business_id,
        b.business_name,
        COALESCE(SUM(CASE WHEN r.call_started_at >= ${dayStart} THEN r.duration_ms ELSE 0 END), 0)::double precision AS daily_duration_ms,
        COALESCE(SUM(r.duration_ms), 0)::double precision AS monthly_duration_ms
      FROM ${businessesTable} b
      INNER JOIN ${retellCallRecordsTable} r ON r.business_id = b.id
      WHERE b.is_sample = false
        AND b.is_internal = false
        AND r.call_started_at >= ${monthStart}
        AND r.call_started_at < ${now}
        AND r.duration_ms > 0
      GROUP BY b.id, b.business_name
    `),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE p.purchased_at >= ${dayStart})::int AS daily_count,
        COUNT(*)::int AS monthly_count
      FROM ${provisioningAttemptsTable} p
      LEFT JOIN ${businessesTable} b ON b.id = p.business_id
      WHERE p.purchased_number IS NOT NULL
        AND p.purchased_at >= ${monthStart}
        AND p.purchased_at < ${now}
        AND (b.id IS NULL OR (b.is_internal = false AND b.is_sample = false))
    `),
  ]);

  const totals = totalsResult.rows[0] as Record<string, unknown> | undefined;
  const totalDailyMinutes = asNumber(totals?.daily_duration_ms) * MINUTES_PER_MILLISECOND;
  const totalMonthlyMinutes = asNumber(totals?.monthly_duration_ms) * MINUTES_PER_MILLISECOND;
  const totalChecks = [
    {
      value: totalDailyMinutes,
      threshold: settings.dailyTotalCallMinutes,
      summary: "Total Retell call minutes reached the daily threshold",
      key: `total-call-minutes:day:${periodDay}`,
      label: "today (UTC)",
    },
    {
      value: totalMonthlyMinutes,
      threshold: settings.monthlyTotalCallMinutes,
      summary: "Total Retell call minutes reached the monthly threshold",
      key: `total-call-minutes:month:${periodMonth}`,
      label: "this month (UTC)",
    },
  ];
  for (const check of totalChecks) {
    if (!usageThresholdReached(check.value, check.threshold)) continue;
    const inserted = await emitUsageAlert({
      eventKey: `usage-alert:${check.key}:${check.threshold}`,
      summary: check.summary,
      title: "Total call usage threshold reached",
      body: `All businesses used ${minutes(check.value)} Retell call minutes ${check.label}; alert threshold ${check.threshold} minutes. Advisory only.`,
    });
    if (inserted) insertedCount += 1;
  }

  for (const row of perBusinessResult.rows as Array<Record<string, unknown>>) {
    const businessId = Number(row.business_id);
    const businessName = String(row.business_name ?? "Business");
    const checks = [
      {
        value: asNumber(row.daily_duration_ms) * MINUTES_PER_MILLISECOND,
        threshold: settings.dailyPerBusinessCallMinutes,
        summary: "A business reached its daily call-minute threshold",
        key: `business-call-minutes:day:${periodDay}`,
        label: "today (UTC)",
      },
      {
        value: asNumber(row.monthly_duration_ms) * MINUTES_PER_MILLISECOND,
        threshold: settings.monthlyPerBusinessCallMinutes,
        summary: "A business reached its monthly call-minute threshold",
        key: `business-call-minutes:month:${periodMonth}`,
        label: "this month (UTC)",
      },
    ];
    for (const check of checks) {
      if (!usageThresholdReached(check.value, check.threshold)) continue;
      const inserted = await emitUsageAlert({
        eventKey: `usage-alert:${check.key}:${businessId}:${check.threshold}`,
        summary: check.summary,
        title: "Business call usage threshold reached",
        body: `${businessName} used ${minutes(check.value)} Retell call minutes ${check.label}; alert threshold ${check.threshold} minutes. Advisory only.`,
        businessId,
        businessName,
      });
      if (inserted) insertedCount += 1;
    }
  }

  const provisioned = provisionedResult.rows[0] as Record<string, unknown> | undefined;
  const numberChecks = [
    {
      count: asNumber(provisioned?.daily_count),
      threshold: settings.dailyProvisionedNumbers,
      summary: "Provisioned phone numbers reached the daily threshold",
      key: `provisioned-numbers:day:${periodDay}`,
      label: "today (UTC)",
    },
    {
      count: asNumber(provisioned?.monthly_count),
      threshold: settings.monthlyProvisionedNumbers,
      summary: "Provisioned phone numbers reached the monthly threshold",
      key: `provisioned-numbers:month:${periodMonth}`,
      label: "this month (UTC)",
    },
  ];
  for (const check of numberChecks) {
    if (!usageThresholdReached(check.count, check.threshold)) continue;
    const inserted = await emitUsageAlert({
      eventKey: `usage-alert:${check.key}:${check.threshold}`,
      summary: check.summary,
      title: "Phone provisioning threshold reached",
      body: `${check.count} phone numbers were provisioned ${check.label}; alert threshold ${check.threshold}. Advisory only.`,
    });
    if (inserted) insertedCount += 1;
  }

  const billableBusinesses = await db.select({
    id: businessesTable.id,
    businessName: businessesTable.businessName,
    chosenPlan: businessesTable.chosenPlan,
  }).from(businessesTable).where(and(
    eq(businessesTable.isInternal, false),
    eq(businessesTable.isSample, false),
  ));
  const billingRows = await db.select({
    businessId: billingAccountsTable.businessId,
    state: billingAccountsTable.state,
  }).from(billingAccountsTable);
  const billingStates = new Map(billingRows.map((row) => [row.businessId, row.state]));
  for (const business of billableBusinesses) {
    if (!business.chosenPlan) continue;
    const plan = billingConfig.plans.find((candidate) => candidate.id === business.chosenPlan);
    if (!plan || plan.callLimit === null) continue;
    const billingState = {
      ...initialBillingState(),
      ...(billingStates.get(business.id) ?? {}),
    } as BillingState;
    const period = usagePeriod(billingState, now);
    const callCountResult = await db.execute(sql`
      SELECT count(DISTINCT l.retell_call_id)::int AS count
      FROM ${leadsTable} l
      LEFT JOIN ${retellCallRecordsTable} r
        ON r.retell_call_id = l.retell_call_id AND r.business_id = l.business_id
      WHERE l.business_id = ${business.id}
        AND nullif(trim(l.retell_call_id), '') IS NOT NULL
        AND coalesce(r.call_started_at, l.created_at) >= ${period.start}::timestamptz
        AND coalesce(r.call_started_at, l.created_at) < ${period.end}::timestamptz
        AND (r.id IS NULL OR r.analysis_complete OR r.duration_ms > 0)
        AND (
          nullif(trim(l.transcript), '') IS NOT NULL
          OR nullif(trim(l.summary), '') IS NOT NULL
          OR nullif(trim(l.issue_reason), '') IS NOT NULL
        )
    `);
    const callCount = asNumber(callCountResult.rows[0]?.count);
    const planPeriodKey = period.start;
    for (const threshold of billingConfig.policy.callCapThresholdPercentages) {
      const thresholdCount = getPlanCallThresholdCount(plan.callLimit, threshold);
      if (callCount < thresholdCount) continue;
      const summary = threshold >= 100
        ? "A business reached its plan call limit"
        : "A business reached 80% of its plan call limit";
      const inserted = await emitUsageAlert({
        eventKey: `usage-alert:plan-call-count:${business.id}:${planPeriodKey}:${threshold}`,
        summary,
        title: "Plan call-count threshold reached",
        body: `${business.businessName}: ${callCount} of ${plan.callLimit} calls in the current billing period (${threshold}%). Calls continue; no plan change or per-call charge is made.`,
        businessId: business.id,
        businessName: business.businessName,
        suppressEmail: true,
      });
      if (inserted) insertedCount += 1;
    }
  }

  if (insertedCount > 0) await runNotificationOutboxNow();
  return insertedCount;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;

export function startUsageAlertWorker() {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = runUsageAlertSweep()
      .then(() => undefined)
      .catch((error) => logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Usage alert sweep failed",
      ))
      .finally(() => { running = undefined; });
  };
  run();
  timer = setInterval(run, USAGE_ALERT_INTERVAL_MS);
  timer.unref?.();
}

export async function stopUsageAlertWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await running;
}

import { addBusinessDays, config } from "./policy";

export type BillingEnforcementMode = "off" | "dry_run" | "enforce";
export type BillingEnforcementSource = "stripe" | "manual";
export type WarningDay = 3 | 5;

export type EnforcementCandidate = {
  businessId: number;
  businessName: string;
  source: BillingEnforcementSource;
  invoiceId: string;
  graceStartedAt: Date;
  graceEndsAt: Date;
  neverAutoSuspend: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeStatus?: string | null;
};

export type EnforcementResult =
  | "off"
  | "not_due"
  | "overridden"
  | "invalid_candidate"
  | "dry_run_logged"
  | "verification_failed"
  | "waiting_for_warnings"
  | "suspended"
  | "already_suspended";

export interface EnforcementPorts {
  readMode(): Promise<BillingEnforcementMode>;
  verifyStripe(candidate: EnforcementCandidate): Promise<boolean>;
  recordWouldSuspend(candidate: EnforcementCandidate): Promise<boolean>;
  queueWarning(candidate: EnforcementCandidate, day: WarningDay): Promise<void>;
  warningsDelivered(candidate: EnforcementCandidate): Promise<boolean>;
  suspend(candidate: EnforcementCandidate): Promise<boolean>;
}

function zonedParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
}

function endOfLocalDay(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  const targetLocalSecond = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    23,
    59,
    59,
  );
  let instant = targetLocalSecond;
  for (let i = 0; i < 3; i++) {
    const local = zonedParts(new Date(instant), timeZone);
    const representedAsUtc = Date.UTC(
      Number(local.year),
      Number(local.month) - 1,
      Number(local.day),
      Number(local.hour),
      Number(local.minute),
      Number(local.second),
    );
    instant += targetLocalSecond - representedAsUtc;
  }
  return new Date(instant + 999);
}

export function enforcementMilestoneAt(graceStartedAt: Date, businessDays: WarningDay): Date {
  return endOfLocalDay(
    addBusinessDays(graceStartedAt, businessDays),
    config.policy.businessDayTimeZone,
  );
}

export function hasReachedWarningDay(
  candidate: EnforcementCandidate,
  day: WarningDay,
  now: Date,
): boolean {
  return Number.isFinite(candidate.graceStartedAt.getTime())
    && now.getTime() >= enforcementMilestoneAt(candidate.graceStartedAt, day).getTime();
}

export function hasCompletedGrace(candidate: EnforcementCandidate, now: Date): boolean {
  if (!Number.isFinite(candidate.graceStartedAt.getTime())
    || !Number.isFinite(candidate.graceEndsAt.getTime())) return false;
  const dayFiveEnd = enforcementMilestoneAt(candidate.graceStartedAt, 5).getTime();
  return now.getTime() >= Math.max(candidate.graceEndsAt.getTime(), dayFiveEnd);
}

function validCandidate(candidate: EnforcementCandidate): boolean {
  return Number.isSafeInteger(candidate.businessId)
    && candidate.businessId > 0
    && candidate.businessName.trim().length > 0
    && candidate.invoiceId.trim().length > 0
    && Number.isFinite(candidate.graceStartedAt.getTime())
    && Number.isFinite(candidate.graceEndsAt.getTime())
    && candidate.graceEndsAt.getTime() > candidate.graceStartedAt.getTime()
    && (candidate.source !== "stripe" || (
      candidate.stripeStatus === "past_due"
      && Boolean(candidate.stripeCustomerId?.trim())
      && Boolean(candidate.stripeSubscriptionId?.trim())
    ));
}

export async function evaluateEnforcementCandidate(
  candidate: EnforcementCandidate,
  now: Date,
  ports: EnforcementPorts,
): Promise<EnforcementResult> {
  if (!validCandidate(candidate)) return "invalid_candidate";
  if (candidate.neverAutoSuspend) return "overridden";

  let mode: BillingEnforcementMode;
  try {
    mode = await ports.readMode();
  } catch {
    return "off";
  }
  if (mode === "off") return "off";

  if (mode === "dry_run") {
    if (!hasCompletedGrace(candidate, now)) return "not_due";
    if (candidate.source === "stripe") {
      try {
        if (!await ports.verifyStripe(candidate)) return "verification_failed";
      } catch {
        return "verification_failed";
      }
    }
    try {
      return await ports.recordWouldSuspend(candidate) ? "dry_run_logged" : "already_suspended";
    } catch {
      return "verification_failed";
    }
  }

  try {
    if (hasReachedWarningDay(candidate, 3, now)) await ports.queueWarning(candidate, 3);
    if (hasReachedWarningDay(candidate, 5, now)) await ports.queueWarning(candidate, 5);
  } catch {
    return "waiting_for_warnings";
  }
  if (!hasCompletedGrace(candidate, now)) return "not_due";

  let delivered: boolean;
  try {
    delivered = await ports.warningsDelivered(candidate);
  } catch {
    return "waiting_for_warnings";
  }
  if (!delivered) return "waiting_for_warnings";

  if (candidate.source === "stripe") {
    try {
      if (!await ports.verifyStripe(candidate)) return "verification_failed";
    } catch {
      return "verification_failed";
    }
  }

  try {
    return await ports.suspend(candidate) ? "suspended" : "already_suspended";
  } catch {
    return "verification_failed";
  }
}

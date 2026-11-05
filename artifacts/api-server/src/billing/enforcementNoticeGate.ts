import type { BillingEnforcementMode } from "./enforcementCore";

const ENFORCEMENT_WARNING_NOTICE_PREFIX = "billing-enforcement:warning:";

export function isEnforcementWarningNotice(noticeId: string): boolean {
  return noticeId.startsWith(ENFORCEMENT_WARNING_NOTICE_PREFIX);
}

export function shouldSendEnforcementWarningEmail(
  noticeId: string,
  mode?: BillingEnforcementMode,
): boolean {
  return !isEnforcementWarningNotice(noticeId) || mode === "enforce";
}

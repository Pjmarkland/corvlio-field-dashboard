export function numberActivity(
  business: { retellPhoneNumber: string | null; retellAgentId: string | null; isSample: boolean; provisioningState: string; createdAt: Date },
  calls: Array<{ callStartedAt: Date | null; recordedAt: Date }>,
  now = Date.now(),
  assignedAt = business.createdAt,
) {
  const lastCallAt = calls.reduce<Date | null>((last, call) => {
    const date = call.callStartedAt ?? call.recordedAt;
    return !last || date > last ? date : last;
  }, null);
  const hasPhone = Boolean(business.retellPhoneNumber);
  return {
    isSample: Boolean(business.isSample),
    provisioningState: business.isSample ? "sample" : hasPhone ? "ready" : business.provisioningState || "pending",
    lastCallAt,
    unusedNumber7Days: hasPhone && !business.isSample
      && now - (lastCallAt ?? assignedAt).getTime() >= 7 * 24 * 60 * 60_000,
  };
}
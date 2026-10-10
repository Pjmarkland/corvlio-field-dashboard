import type { BillingAccount, BillingSnapshot } from '@workspace/api-client-react';

export function money(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
export function billingDate(value: string | null | undefined, fallback = 'Not scheduled') {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
export function usageText(usage: BillingSnapshot['usage']) {
  return usage.limit === null ? `${usage.count} calls this month (unlimited)` : `${usage.count} of ${usage.limit} calls this month`;
}
export function periodLabel(usage: BillingSnapshot['usage']) {
  return `${billingDate(usage.start)} to ${billingDate(usage.end)}`;
}
export function isAssignedStartup(account: BillingAccount) {
  return account.plan === 'startup' && account.startupEligible;
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message.replace(/^HTTP \d+ [^:]*:\s*/, '') : 'Something went wrong. Try again.';
}

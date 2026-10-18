export type PlanId = 'startup' | 'starter' | 'professional' | 'managed';
export type PlanOption = { id: PlanId; name: string; monthly: number; setup: number; benefits: string[]; badge?: string };
export const PLAN_OPTIONS: PlanOption[] = [
  { id: 'startup', name: 'Startup', monthly: 500, setup: 250, benefits: ['100 calls per month', 'For businesses under 18 months old', 'Starts after admin approval'] },
  { id: 'starter', name: 'Starter', monthly: 750, setup: 300, benefits: ['150 calls per month', 'Lead capture and alerts'] },
  { id: 'professional', name: 'Professional', monthly: 1000, setup: 300, badge: 'Most Popular', benefits: ['Unlimited calls', 'Lead capture and alerts'] },
  { id: 'managed', name: 'Managed', monthly: 1250, setup: 300, benefits: ['Unlimited calls', 'Dedicated account management', 'Weekly reports'] },
];
export const planName = (plan: string | null | undefined) => PLAN_OPTIONS.find((p) => p.id === plan)?.name ?? (plan ?? 'Unassigned');
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function validStartupAge(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 17 ? n : null;
}
export function safeHttpsUrl(value: string): string | null {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export const fmtDate = (v: string | null | undefined) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d) : 'Not recorded';
};

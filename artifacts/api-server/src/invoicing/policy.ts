export const PAYEE = "Markland Ventures LLC (DBA Corvlio)";
export const PLANS = {
  startup: { name: "Startup", monthlyCents: 50000, setupCents: 25000, calls: 100 },
  starter: { name: "Starter", monthlyCents: 75000, setupCents: 30000, calls: 150 },
  professional: { name: "Professional", monthlyCents: 100000, setupCents: 30000, calls: null },
  managed: { name: "Managed", monthlyCents: 125000, setupCents: 30000, calls: null },
} as const;
export type Plan = keyof typeof PLANS;
export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && Object.hasOwn(PLANS, value);
}
export function invoiceNumber(id: number) { return `CORV-${String(id).padStart(3, "0")}`; }
export function addDays(date: Date, count: number) {
  const result = new Date(date); result.setUTCDate(result.getUTCDate() + count); return result;
}
// Always calculate from the original anniversary, not the previous clamped date.
export function anniversary(anchor: Date, month: number) {
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + month);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(anchor.getUTCDate(), last));
  return result;
}
export function invoiceStatus(paidAt: Date | null, dueAt: Date, now = new Date()) {
  return paidAt ? "paid" as const : dueAt < now ? "overdue" as const : "invoiced" as const;
}
export function validPaymentLink(value: string) {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}

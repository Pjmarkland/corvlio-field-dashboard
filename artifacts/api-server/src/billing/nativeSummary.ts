import { db, billingAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NativeBillingSummary } from "@workspace/api-zod";
import { config, initialBillingState, type BillingState } from "./policy";
import { billingEnabled } from "./stripeClient";

type SummaryState = Pick<BillingState, "plan" | "status" | "periodEnd" | "cancelAt" | "subscriptionId" | "customerId">;
export function nativeBillingSummary(state: SummaryState, enabled: boolean, now = new Date()): NativeBillingSummary {
  const status = state.status === "active" || state.status === "past_due" || state.status === "canceled"
    ? state.status : "not_subscribed";
  const end = Date.parse(state.periodEnd ?? "");
  const cancel = Date.parse(state.cancelAt ?? "");
  const nextChargeDate = state.subscriptionId && (status === "active" || status === "past_due")
    && Number.isFinite(end) && end > now.getTime() && !(Number.isFinite(cancel) && cancel <= end)
    ? new Date(end) : null;
  return {
    planName: config.plans.find(p => p.id === state.plan)?.label ?? null,
    status, nextChargeDate, billingEnabled: enabled, hasStripeCustomer: Boolean(state.customerId),
  };
}

/** Only a scoped SELECT. No account creation, usage refresh, notices or Stripe API. */
export async function readNativeBillingSummary(businessId: number) {
  const [row] = await db.select().from(billingAccountsTable)
    .where(eq(billingAccountsTable.businessId, businessId)).limit(1);
  const state = { ...initialBillingState(), ...row?.state,
    customerId: row?.customerId ?? row?.state.customerId ?? null,
    subscriptionId: row?.subscriptionId ?? row?.state.subscriptionId ?? null,
  } as BillingState;
  return nativeBillingSummary(state, billingEnabled());
}

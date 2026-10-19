import { db, pool, billingAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NativeBillingSummary } from "@workspace/api-zod";
import { config, initialBillingState, type BillingState } from "./policy";
import { billingEnabled } from "./stripeClient";
import { anniversary, isPlan, PLANS } from "../invoicing/policy";

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
    status, nextChargeDate, nextInvoiceDate:nextChargeDate, billingEnabled: enabled, hasStripeCustomer: Boolean(state.customerId),
  };
}

/** Only a scoped SELECT. No account creation, usage refresh, notices or Stripe API. */
export async function readNativeBillingSummary(businessId: number) {
  const business=(await pool.query(`SELECT is_internal,chosen_plan,manual_payment_state,first_invoice_paid_at,billing_mode
    FROM businesses WHERE id=$1`,[businessId])).rows[0];
  if(!business || business.is_internal) throw new Error("Billing summary unavailable.");
  const plan:unknown=business.chosen_plan;
  if (business.billing_mode==="manual" && isPlan(plan)) {
    const invoices=(await pool.query(`SELECT due_at,paid_at FROM manual_invoices WHERE business_id=$1`,[businessId])).rows;
    const now=new Date();
    const status=business.manual_payment_state==="requested" ? "requested"
      : invoices.some(i=>!i.paid_at && i.due_at<now) ? "overdue"
      : invoices.some(i=>!i.paid_at) || !business.first_invoice_paid_at ? "invoiced" : "paid";
    return {planName:PLANS[plan].name,status,
      nextInvoiceDate:nextManualInvoiceDate(business.first_invoice_paid_at,now),
      nextChargeDate:null,billingEnabled:false,hasStripeCustomer:false} satisfies NativeBillingSummary;
  }
  const [row] = await db.select().from(billingAccountsTable)
    .where(eq(billingAccountsTable.businessId, businessId)).limit(1);
  const state = { ...initialBillingState(), ...row?.state,
    customerId: row?.customerId ?? row?.state.customerId ?? null,
    subscriptionId: row?.subscriptionId ?? row?.state.subscriptionId ?? null,
  } as BillingState;
  return nativeBillingSummary(state, billingEnabled());
}

export function nextManualInvoiceDate(anchor:Date|null,now=new Date()):Date|null {
  if(!anchor) return null;
  let month=Math.max(1,(now.getUTCFullYear()-anchor.getUTCFullYear())*12+now.getUTCMonth()-anchor.getUTCMonth());
  while(anniversary(anchor,month)<=now) month++;
  return anniversary(anchor,month);
}

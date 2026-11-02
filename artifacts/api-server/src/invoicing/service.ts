import { pool, type PoolClient } from "@workspace/db";
import type { InvoiceOverview, ManualInvoice, PaymentInstructions } from "@workspace/api-zod";
import { addDays, anniversary, invoiceNumber, invoiceStatus, isPlan, PAYEE, PLANS } from "./policy";

export class InvoiceError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type InvoiceBusiness = {
  id: number; business_name: string; owner_email: string | null;
  chosen_plan: string | null; startup_age_months: number | null;
  manual_payment_state: string | null; first_invoice_paid_at: Date | null;
  provisioning_state: string; retell_phone_number: string | null; is_sample: boolean;
  billing_mode: "manual" | "square";
  is_internal: boolean;
};
export type InvoiceRow = {
  id: number; business_id: number; business_name: string; plan: string;
  period_key: string; monthly_cents: number; setup_cents: number;
  issued_at: Date; due_at: Date; paid_at: Date | null; payment_reference: string | null;
  delivery_status?: string; reminder_status?: string;
};
export async function withInvoiceTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const result = await work(c); await c.query("COMMIT"); return result; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
export async function paymentInstructions(): Promise<PaymentInstructions> {
  const r = await pool.query("SELECT instructions, payment_link FROM invoice_settings WHERE id=1");
  return { instructions: r.rows[0]?.instructions ?? "", paymentLink: r.rows[0]?.payment_link ?? "" };
}
export async function insertInvoice(c: PoolClient, b: InvoiceBusiness, key: string, date: Date) {
  if (b.is_internal) return;
  if (b.billing_mode === "square") return;
  if (!isPlan(b.chosen_plan)) throw new InvoiceError("A valid plan is required.");
  const p = PLANS[b.chosen_plan];
  const r = await c.query<InvoiceRow>(`INSERT INTO manual_invoices
    (business_id,business_name,plan,period_key,monthly_cents,setup_cents,issued_at,due_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8
    WHERE NOT EXISTS (SELECT 1 FROM manual_invoices WHERE business_id=$1 AND period_key=$4)
    ON CONFLICT(business_id,period_key) DO NOTHING RETURNING *`,
  [b.id,b.business_name,b.chosen_plan,key,p.monthlyCents,key === "initial" ? p.setupCents : 0,date,addDays(date,5)]);
  if (r.rows[0]) await c.query("INSERT INTO invoice_emails(invoice_id,kind) VALUES($1,'invoice') ON CONFLICT DO NOTHING", [r.rows[0].id]);
  return r.rows[0];
}
export async function initializeInvoices(businessId: number, now = new Date()) {
  await withInvoiceTransaction(async c => {
    const b = (await c.query<InvoiceBusiness>("SELECT * FROM businesses WHERE id=$1 FOR UPDATE", [businessId])).rows[0];
    if (!b || b.is_internal || b.is_sample || !b.chosen_plan || b.manual_payment_state === "requested") return;
    await insertInvoice(c,b,"initial",now);
  });
}
export async function ownerInvoiceOverview(businessId: number, now = new Date()): Promise<InvoiceOverview> {
  const b = (await pool.query<InvoiceBusiness>("SELECT * FROM businesses WHERE id=$1", [businessId])).rows[0];
  if (!b) throw new InvoiceError("Business not found.",404);
  if (b.is_internal) throw new InvoiceError("Internal businesses are not billed.",404);
  const settings = await paymentInstructions();
  const rows = await pool.query<InvoiceRow>(`SELECT i.*,
    coalesce(e.status,'pending') AS delivery_status,coalesce(r.status,'not_scheduled') AS reminder_status
    FROM manual_invoices i
    LEFT JOIN invoice_emails e ON e.invoice_id=i.id AND e.kind='invoice'
    LEFT JOIN invoice_emails r ON r.invoice_id=i.id AND r.kind='reminder'
    WHERE i.business_id=$1 ORDER BY i.issued_at DESC,i.id DESC`,[businessId]);
  const ready = Boolean(settings.instructions.trim() || settings.paymentLink);
  const invoices: ManualInvoice[] = rows.rows.map(i => ({
    id:i.id,number:invoiceNumber(i.id),businessName:i.business_name,plan:i.plan,payee:PAYEE,
    monthlyCents:i.monthly_cents,setupCents:i.setup_cents,totalCents:i.monthly_cents+i.setup_cents,
    issuedAt:i.issued_at.toISOString(),dueAt:i.due_at.toISOString(),periodKey:i.period_key,
    status:invoiceStatus(i.paid_at,i.due_at,now),paidAt:i.paid_at?.toISOString() ?? null,
    paymentReference:i.payment_reference,
    deliveryStatus:!ready && i.delivery_status === "pending" ? "awaiting_instructions" : i.delivery_status ?? "pending",
    reminderStatus:i.reminder_status ?? "not_scheduled",
  }));
  const status = !b.chosen_plan || b.is_sample ? "legacy" : b.manual_payment_state === "requested"
    ? "requested" : invoices.some(i => i.status === "overdue") ? "overdue"
    : invoices.some(i => i.status === "invoiced") || !b.first_invoice_paid_at ? "invoiced" : "paid";
  const setupStatus = !b.chosen_plan && b.provisioning_state === "awaiting_activation"
    ? "awaiting_activation" : status;
  return {
    businessId:b.id,businessName:b.business_name,plan:b.chosen_plan,businessAgeMonths:b.startup_age_months,
    status:setupStatus,
    serviceActive:(b.provisioning_state !== "awaiting_activation" && !b.chosen_plan) || b.is_sample
      || Boolean(b.first_invoice_paid_at && b.retell_phone_number),
    provisioningState:b.provisioning_state,invoices,settings,
  };
}
export async function assignBusinessPlan(
  businessId: number,
  plan: string,
  startupAgeMonths?: number,
) {
  if (!isPlan(plan)) throw new InvoiceError("Choose a valid plan.", 400);
  if (plan === "startup" && (startupAgeMonths === undefined
    || !Number.isInteger(startupAgeMonths) || startupAgeMonths < 0 || startupAgeMonths >= 18)) {
    throw new InvoiceError("Startup is available only to businesses under 18 months old.", 400);
  }

  await withInvoiceTransaction(async c => {
    const b = (await c.query<InvoiceBusiness>(
      "SELECT * FROM businesses WHERE id=$1 FOR UPDATE", [businessId],
    )).rows[0];
    if (!b || b.is_internal || b.is_sample) throw new InvoiceError("Business not found.", 404);
    if (b.provisioning_state !== "awaiting_activation") {
      throw new InvoiceError("Only a pending native setup can have its plan assigned here.");
    }
    if (b.first_invoice_paid_at || b.retell_phone_number) {
      throw new InvoiceError("A paid or activated business cannot have its plan changed.");
    }
    const age = plan === "startup" ? startupAgeMonths! : null;
    if (b.chosen_plan === plan && b.startup_age_months === age) return;
    const paymentState = plan === "startup" ? "requested" : "invoiced";
    const invoiceHistory = await c.query<InvoiceRow>(
      "SELECT * FROM manual_invoices WHERE business_id=$1 FOR UPDATE", [businessId],
    );
    if (invoiceHistory.rows.length) {
      if (plan === "startup") {
        throw new InvoiceError("Startup cannot replace an invoice that has already been issued.");
      }
      if (invoiceHistory.rows.some(invoice => invoice.paid_at || invoice.period_key !== "initial")) {
        throw new InvoiceError("A plan cannot be changed after payment or recurring invoices exist.");
      }
      for (const invoice of invoiceHistory.rows) {
        const email = await c.query<{status:string}>(
          "SELECT status FROM invoice_emails WHERE invoice_id=$1 AND kind='invoice' FOR UPDATE",
          [invoice.id],
        );
        if (email.rows.some(({status}) => !["pending", "unconfigured"].includes(status))) {
          throw new InvoiceError("This invoice has already been sent or is being processed. Contact support before changing the plan.");
        }
        const pricing = PLANS[plan];
        await c.query(
          "UPDATE manual_invoices SET plan=$2,monthly_cents=$3,setup_cents=$4 WHERE id=$1",
          [invoice.id, plan, pricing.monthlyCents, pricing.setupCents],
        );
      }
    }
    await c.query(
      `UPDATE businesses SET chosen_plan=$2,startup_age_months=$3,
        manual_payment_state=$4,updated_at=now() WHERE id=$1`,
      [businessId, plan, age, paymentState],
    );
    if (plan !== "startup" && !invoiceHistory.rows.length) {
      await insertInvoice(c, {
        ...b,
        chosen_plan: plan,
        startup_age_months: age,
        manual_payment_state: paymentState,
      }, "initial", new Date());
    }
  });
  return ownerInvoiceOverview(businessId);
}

export async function activateBusiness(businessId: number) {
  await withInvoiceTransaction(async c => {
    const b = (await c.query<InvoiceBusiness>(
      "SELECT * FROM businesses WHERE id=$1 FOR UPDATE", [businessId],
    )).rows[0];
    if (!b || b.is_internal || b.is_sample) throw new InvoiceError("Business not found.", 404);
    const hasPaidSetup = Boolean(b.chosen_plan && b.first_invoice_paid_at
      && b.manual_payment_state === "paid");
    if (!hasPaidSetup) {
      throw new InvoiceError("Assign a plan and confirm the first invoice payment before activation.");
    }
    if (b.provisioning_state === "awaiting_activation") {
      await c.query(
        "UPDATE businesses SET provisioning_state=$2,updated_at=now() WHERE id=$1",
        [businessId, b.retell_phone_number ? "ready" : "awaiting_payment"],
      );
    } else if (b.provisioning_state !== "awaiting_payment"
      && !(b.provisioning_state === "ready" && b.retell_phone_number)) {
      throw new InvoiceError("This business is not waiting for activation.");
    }
  });
  return ownerInvoiceOverview(businessId);
}

export async function approveStartup(businessId: number) {
  await withInvoiceTransaction(async c => {
    const b = (await c.query<InvoiceBusiness>("SELECT * FROM businesses WHERE id=$1 FOR UPDATE",[businessId])).rows[0];
    if (!b || b.is_internal || b.chosen_plan !== "startup" || b.is_sample) throw new InvoiceError("No Startup request exists.",404);
    if (b.startup_age_months === null || b.startup_age_months < 0 || b.startup_age_months >= 18)
      throw new InvoiceError("Startup is available only to businesses under 18 months old.");
    if (b.manual_payment_state !== "requested") return; // Idempotent approval.
    await insertInvoice(c,b,"initial",new Date());
    await c.query("UPDATE businesses SET manual_payment_state='invoiced' WHERE id=$1",[businessId]);
  });
  return ownerInvoiceOverview(businessId);
}
export async function markInvoicePaid(invoiceId: number, actor: string, reference: string) {
  const businessId = await withInvoiceTransaction(async c => {
    // Lock business before invoice consistently with generation/deletion.
    const match = (await c.query("SELECT business_id FROM manual_invoices WHERE id=$1",[invoiceId])).rows[0];
    if (!match) throw new InvoiceError("Invoice not found.",404);
    const b = (await c.query<InvoiceBusiness>("SELECT * FROM businesses WHERE id=$1 FOR UPDATE",[match.business_id])).rows[0];
    if (!b) throw new InvoiceError("Business not found.",404);
    if (b.is_internal) throw new InvoiceError("Internal businesses are not billed.",404);
    const i = (await c.query<InvoiceRow>("SELECT * FROM manual_invoices WHERE id=$1 FOR UPDATE",[invoiceId])).rows[0];
    if (!i) throw new InvoiceError("Invoice not found.",404);
    if (!i.paid_at) {
      await c.query("UPDATE manual_invoices SET paid_at=now(),paid_by=$2,payment_reference=$3 WHERE id=$1",[invoiceId,actor,reference]);
      if (i.period_key === "initial") await c.query(
        "UPDATE businesses SET first_invoice_paid_at=coalesce(first_invoice_paid_at,now()),manual_payment_state='paid' WHERE id=$1",[b.id]);
    }
    return b.id;
  });
  return ownerInvoiceOverview(businessId);
}
export async function scheduleInvoiceWork(now = new Date(), onlyBusinessIds: number[] | null = null) {
  const businesses = await pool.query<{id:number}>(
    "SELECT id FROM businesses WHERE is_internal=false AND chosen_plan IS NOT NULL AND is_sample=false AND ($1::int[] IS NULL OR id=ANY($1::int[]))",[onlyBusinessIds]);
  for (const {id} of businesses.rows) {
    await withInvoiceTransaction(async c => {
      const b = (await c.query<InvoiceBusiness>("SELECT * FROM businesses WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if (!b || b.is_internal || b.manual_payment_state === "requested") return;
      await insertInvoice(c,b,"initial",now);
      if (b.first_invoice_paid_at) {
        const anchor = b.first_invoice_paid_at;
        const months = (now.getUTCFullYear()-anchor.getUTCFullYear())*12 + now.getUTCMonth()-anchor.getUTCMonth();
        // Stable period keys and database uniqueness prevent duplicate monthly invoices.
        for (let month=1;month<=months;month++) {
          const date = anniversary(anchor,month);
          if (date <= now) await insertInvoice(c,b,`monthly:${month}`,date);
        }
      }
    });
  }
  await pool.query(`INSERT INTO invoice_emails(invoice_id,kind)
    SELECT i.id,'reminder' FROM manual_invoices i
    JOIN invoice_emails e ON e.invoice_id=i.id AND e.kind='invoice' AND e.status='sent'
    JOIN businesses b ON b.id=i.business_id AND b.billing_mode='manual' AND b.is_internal=false
    WHERE i.paid_at IS NULL AND i.due_at <= $1 AND ($2::int[] IS NULL OR i.business_id=ANY($2::int[]))
    ON CONFLICT(invoice_id,kind) DO NOTHING`,[addDays(now,-3),onlyBusinessIds]);
}

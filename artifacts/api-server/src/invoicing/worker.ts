import { pool } from "@workspace/db";
import { databaseErrorFields } from "@workspace/db/errors";
import { logger } from "../lib/logger";
import { sendBillingNotificationEmail } from "../lib/gmail";
import { saveBusinessWithOptionalPhone } from "../lib/retellProvisioning";
import { findBusinessById } from "../lib/businessDirectory";
import { invoiceNumber, PAYEE, PLANS, isPlan } from "./policy";
import { paymentInstructions, scheduleInvoiceWork, type InvoiceRow } from "./service";

function money(cents: number) { return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100); }
export function invoiceEmailBody(i: InvoiceRow, instructions: string, link: string, reminder: boolean) {
  return [
    reminder ? "A friendly reminder: our records show this invoice is still unpaid. If you have already paid, please contact us so we can confirm your payment." : "Thank you for choosing Corvlio. Your invoice is ready.",
    "",`Invoice: ${invoiceNumber(i.id)}`,`Payee: ${PAYEE}`,`Business: ${i.business_name}`,
    `Plan: ${isPlan(i.plan) ? PLANS[i.plan].name : i.plan}`,
    `Issued: ${i.issued_at.toISOString().slice(0,10)}`,`Due: ${i.due_at.toISOString().slice(0,10)}`,
    `Monthly service: ${money(i.monthly_cents)}`,
    ...(i.setup_cents ? [`One-time setup: ${money(i.setup_cents)}`] : []),
    `Total due: ${money(i.monthly_cents+i.setup_cents)}`,"","How to pay:",instructions,
    ...(link ? [`Payment link: ${link}`] : []),
    `Please include ${invoiceNumber(i.id)} as your payment reference.`,
    i.period_key === "initial" ? "Your receptionist and phone number will be activated after we confirm your first payment." : "Thank you for your business.",
    "View your invoice and current payment instructions in your Corvlio dashboard.",
  ].join("\n");
}
export async function deliverInvoiceEmails() {
  const settings = await paymentInstructions();
  if (!settings.instructions.trim() && !settings.paymentLink) return;
  // An interrupted or ambiguous send must NEVER be automatically attempted twice.
  await pool.query(`UPDATE invoice_emails SET status='needs_review'
    WHERE status='sending' AND claimed_at < now()-interval '15 minutes'`);
  const candidates = await pool.query<{id:number}>("SELECT id FROM invoice_emails WHERE status IN ('pending','unconfigured') ORDER BY id LIMIT 50");
  for (const {id} of candidates.rows) {
    const claim = await pool.query<{invoice_id:number;kind:string}>(`UPDATE invoice_emails e
      SET status='sending',claimed_at=now() FROM manual_invoices i
      WHERE e.id=$1 AND e.status IN ('pending','unconfigured') AND i.id=e.invoice_id AND i.paid_at IS NULL
        AND EXISTS (SELECT 1 FROM businesses b WHERE b.id=i.business_id AND b.billing_mode='manual' AND b.is_internal=false)
      RETURNING e.invoice_id,e.kind`,[id]);
    const item = claim.rows[0];
    if (!item) continue;
    const result = await pool.query<InvoiceRow & {owner_email:string|null;billing_mode:string;is_internal:boolean}>(`SELECT i.*,b.owner_email,b.billing_mode,b.is_internal
      FROM manual_invoices i JOIN businesses b ON b.id=i.business_id WHERE i.id=$1`,[item.invoice_id]);
    const invoice = result.rows[0];
    if (!invoice || invoice.is_internal || invoice.paid_at || invoice.billing_mode !== "manual") {
      await pool.query("UPDATE invoice_emails SET status='skipped' WHERE id=$1",[id]); continue;
    }
    try {
      const sent = await sendBillingNotificationEmail(invoice.owner_email,
        `${item.kind === "reminder" ? "Payment reminder — " : ""}Invoice ${invoiceNumber(invoice.id)} | Corvlio`,
        invoiceEmailBody(invoice,settings.instructions,settings.paymentLink,item.kind === "reminder"));
      await pool.query("UPDATE invoice_emails SET status=$2,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE id=$1",
        [id,sent ? "sent" : "unconfigured"]);
    } catch (error) {
      await pool.query("UPDATE invoice_emails SET status='needs_review' WHERE id=$1",[id]);
      logger.error({emailId:id,...databaseErrorFields(error)},"Invoice email delivery uncertain; review before resending");
    }
  }
}
export async function provisionPaidBusinesses() {
  const candidates = await pool.query<{id:number}>(`SELECT id FROM businesses
    WHERE is_internal=false AND chosen_plan IS NOT NULL AND first_invoice_paid_at IS NOT NULL AND is_sample=false
      AND retell_phone_number IS NULL AND provisioning_state IN ('awaiting_payment','recovery')`);
  for (const {id} of candidates.rows) {
    const b = await findBusinessById(id);
    if (!b) continue;
    // Existing provisioning journal, caps, account lock and uncertain-purchase recovery remain authoritative.
    const {id:_id,createdAt:_created,updatedAt:_updated,retellPhoneNumber:_phone,retellAgentId:_agent,...input} = b;
    await saveBusinessWithOptionalPhone(input);
  }
}
let running: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
export function runInvoiceCycle() {
  if (running) return running;
  running = (async () => {
    await scheduleInvoiceWork();
    await deliverInvoiceEmails();
    await provisionPaidBusinesses();
  })().catch(error => logger.error(databaseErrorFields(error),"Manual invoice worker failed"))
    .finally(() => { running=null; });
  return running;
}
export function startInvoiceWorker() {
  if (timer) return;
  timer=setInterval(() => void runInvoiceCycle(),60_000);
  timer.unref(); void runInvoiceCycle();
}
export async function stopInvoiceWorker() {
  if (timer) clearInterval(timer);
  timer=null; await running;
}

import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { approveStartup, initializeInvoices, markInvoicePaid, ownerInvoiceOverview, scheduleInvoiceWork } from "../../src/invoicing/service";

// Explicit opt-in: temporary DEVELOPMENT records only, no email worker or provider calls.
describe.skipIf(process.env.RUN_MANUAL_INVOICE_DB_TESTS !== "true")("manual invoice PostgreSQL integration",()=>{
  const ids:number[]=[];
  async function business(plan="starter",age:number|null=null) {
    const r=await pool.query(`INSERT INTO businesses
      (business_name,clerk_user_id,owner_email,chosen_plan,startup_age_months,manual_payment_state,provisioning_state)
      VALUES($1,$2,'invoice-test@example.test',$3,$4,$5,'awaiting_payment') RETURNING id`,
      [`Temporary invoice verification ${randomUUID()}`,`invoice_test_${randomUUID()}`,plan,age,plan === "startup" ? "requested" : "invoiced"]);
    const id=Number(r.rows[0].id);ids.push(id);return id;
  }
  afterAll(async()=>{
    if(ids.length) await pool.query("DELETE FROM businesses WHERE id=ANY($1::int[])",[ids]);
    await pool.end();
  });
  it("atomically deduplicates concurrent signup invoices, email records and payment confirmations",async()=>{
    const id=await business();
    await Promise.all(Array.from({length:12},()=>initializeInvoices(id)));
    const before=await ownerInvoiceOverview(id);
    expect(before.invoices).toHaveLength(1);
    expect(before.invoices[0]).toMatchObject({setupCents:30000,monthlyCents:75000,totalCents:105000,status:"invoiced"});
    expect(before.serviceActive).toBe(false);
    const invoice=before.invoices[0];
    const r=await pool.query("SELECT count(*)::int AS count FROM invoice_emails WHERE invoice_id=$1",[invoice.id]);
    expect(r.rows[0].count).toBe(1);
    await Promise.all(Array.from({length:5},()=>markInvoicePaid(invoice.id,"test_admin","verified check 123")));
    const after=await ownerInvoiceOverview(id);
    expect(after.invoices[0].status).toBe("paid");
    expect(after.invoices[0].paymentReference).toBe("verified check 123");
    expect(after.serviceActive).toBe(false); // Payment does not pretend provisioning has completed.
    const first=after.invoices[0].paidAt;
    await markInvoicePaid(invoice.id,"another_admin","do not overwrite");
    expect((await ownerInvoiceOverview(id)).invoices[0]).toMatchObject({paidAt:first,paymentReference:"verified check 123"});
  });
  it("keeps Startup unbilled until approval and rejects ineligible requests",async()=>{
    const id=await business("startup",12);
    await initializeInvoices(id);
    expect((await ownerInvoiceOverview(id)).invoices).toHaveLength(0);
    await Promise.all([approveStartup(id),approveStartup(id)]);
    expect((await ownerInvoiceOverview(id)).invoices).toHaveLength(1);
    expect((await ownerInvoiceOverview(id)).invoices[0].totalCents).toBe(75000);
    const invalid=await business("startup",18);
    await expect(approveStartup(invalid)).rejects.toThrow("under 18 months");
    expect((await ownerInvoiceOverview(invalid)).invoices).toHaveLength(0);
  });
  it("creates anniversary invoices without setup, deduplicates polling, and schedules exactly one reminder",async()=>{
    const id=await business("managed");
    await initializeInvoices(id);
    const initial=(await ownerInvoiceOverview(id)).invoices[0];
    await markInvoicePaid(initial.id,"test_admin","verified bank transfer");
    await pool.query("UPDATE businesses SET first_invoice_paid_at=$2 WHERE id=$1",[id,new Date("2026-01-31T12:00Z")]);
    const now=new Date("2026-04-09T12:00Z");
    await Promise.all([scheduleInvoiceWork(now,[id]),scheduleInvoiceWork(now,[id])]);
    const overview=await ownerInvoiceOverview(id,now);
    expect(overview.invoices).toHaveLength(3);
    const recurring=overview.invoices.filter(i=>i.periodKey!=="initial");
    expect(recurring.map(i=>i.setupCents)).toEqual([0,0]);
    expect(recurring.every(i=>i.totalCents===125000)).toBe(true);
    expect(recurring.map(i=>i.issuedAt).sort()).toEqual(["2026-02-28T12:00:00.000Z","2026-03-31T12:00:00.000Z"]);
    // Simulate a confirmed Gmail send only for these disposable records.
    await pool.query("UPDATE invoice_emails SET status='sent' WHERE invoice_id=ANY($1::int[])",[recurring.map(i=>i.id)]);
    await Promise.all([scheduleInvoiceWork(now,[id]),scheduleInvoiceWork(now,[id])]);
    const reminders=await pool.query(`SELECT e.invoice_id,count(*)::int AS count FROM invoice_emails e
      JOIN manual_invoices i ON i.id=e.invoice_id WHERE i.business_id=$1 AND e.kind='reminder' GROUP BY e.invoice_id`,[id]);
    expect(reminders.rows).toHaveLength(2);
    expect(reminders.rows.every(r=>r.count===1)).toBe(true);
  });
  it("defaults to manual and suppresses Square generation and reminders without changing old invoices",async()=>{
    const id=await business();
    const mode=await pool.query("SELECT billing_mode FROM businesses WHERE id=$1",[id]);
    expect(mode.rows[0].billing_mode).toBe("manual");
    await initializeInvoices(id);
    const original=(await ownerInvoiceOverview(id)).invoices[0];
    await pool.query("UPDATE invoice_emails SET status='sent' WHERE invoice_id=$1",[original.id]);
    await pool.query("UPDATE businesses SET billing_mode='square',first_invoice_paid_at=$2 WHERE id=$1",
      [id,new Date("2026-01-31T12:00Z")]);
    await initializeInvoices(id);
    await scheduleInvoiceWork(new Date("2026-12-01T12:00Z"),[id]);
    expect((await ownerInvoiceOverview(id)).invoices).toHaveLength(1);
    const reminders=await pool.query("SELECT id FROM invoice_emails WHERE invoice_id=$1 AND kind='reminder'",[original.id]);
    expect(reminders.rows).toHaveLength(0);
    await expect(pool.query("UPDATE businesses SET billing_mode='invalid' WHERE id=$1",[id])).rejects.toThrow();
  });
});

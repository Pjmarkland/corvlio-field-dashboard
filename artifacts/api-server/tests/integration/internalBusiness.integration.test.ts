import { createHmac, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn().mockResolvedValue(undefined), ownerUserId: "" }));
vi.mock("../../src/lib/notificationService", () => ({ runNotificationOutboxNow: mocks.dispatch }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({userId:mocks.ownerUserId}) }));
vi.mock("../../src/middlewares/requireAdmin", () => ({ requireAdmin: (_req:unknown,_res:unknown,next:()=>void) => next() }));
import retellRouter from "../../src/routes/retell";
import invoicingRouter from "../../src/routes/invoicing";
import { findBusinessByPhoneNumber } from "../../src/lib/businessDirectory";
import { initializeInvoices, insertInvoice, ownerInvoiceOverview, scheduleInvoiceWork } from "../../src/invoicing/service";
import { billingStore } from "../../src/billing/store";

describe.skipIf(process.env.RUN_INTERNAL_BUSINESS_DB_TESTS !== "true")("internal Corvlio dev integration — no external deliveries", () => {
  let server: Server;
  let url: string;
  let businessId: number;
  let baseUrl: string;
  const callId = `internal-simulation-${randomUUID()}`;
  // This is a fabricated test signing key, not the workspace Retell credential.
  const testKey = "internal-business-integration-fake-signing-key";
  async function cleanup() {
    await pool.query("DELETE FROM notification_events WHERE business_id=$1 AND lead_id IN (SELECT id::text FROM leads WHERE retell_call_id=$2)",[String(businessId),callId]);
    await pool.query("DELETE FROM retell_call_records WHERE retell_call_id=$1",[callId]);
    await pool.query("DELETE FROM leads WHERE retell_call_id=$1",[callId]);
  }
  beforeAll(async () => {
    if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT) throw new Error("Development only");
    const b = await findBusinessByPhoneNumber("+12397882087");
    expect(b?.businessName).toBe("Corvlio");
    expect(b?.isInternal).toBe(true);
    businessId = b!.id;
    mocks.ownerUserId = b!.clerkUserId!;
    vi.stubEnv("RETELL_API_KEY",testKey);
    const app = express();
    app.use(express.json({verify(req,_res,body){(req as express.Request).rawBody=body;}}));
    app.use((req,_res,next) => {req.log={info:vi.fn(),warn:vi.fn(),error:vi.fn()} as any;next();});
    app.use("/api",retellRouter);
    app.use("/api",invoicingRouter);
    server = await new Promise<Server>(resolve => {const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    const address = server.address() as {port:number};
    baseUrl = `http://127.0.0.1:${address.port}`;
    url = `${baseUrl}/api/webhooks/retell/post-call`;
    const localFetch = globalThis.fetch;
    vi.spyOn(globalThis,"fetch").mockImplementation((input,options) => {
      if (!String(input).startsWith(baseUrl+"/")) throw new Error("External requests are forbidden in this test");
      return localFetch(input,options);
    });
  });
  afterAll(async () => {
    if (businessId) await cleanup();
    if (server) await new Promise<void>(resolve => server.close(()=>resolve()));
    vi.unstubAllEnvs();
    await pool.end();
  });
  it("matches the assigned number with formatting, preserves owner and blank agent ID",async()=>{
    const b = await findBusinessByPhoneNumber("+1 (239) 788-2087");
    expect(b?.id).toBe(businessId);
    expect(b?.clerkUserId).toBeTruthy();
    expect(b?.isSample).toBe(false);
    expect(b?.leadAlertsEnabled).toBe(true);
    expect(b?.retellAgentId).toBeNull();
  });
  it("excludes internal businesses from invoices, schedules, billing accounts and Square",async()=>{
    await initializeInvoices(businessId);
    await scheduleInvoiceWork(new Date("2028-10-19"),[businessId]);
    const c=await pool.connect();
    try {
      const b=(await c.query("SELECT * FROM businesses WHERE id=$1",[businessId])).rows[0];
      expect(await insertInvoice(c,{...b,chosen_plan:"professional"},"initial",new Date())).toBeUndefined();
    } finally {c.release();}
    await expect(ownerInvoiceOverview(businessId)).rejects.toThrow("Internal businesses are not billed");
    expect(await billingStore.business(businessId)).toBeNull();
    expect((await billingStore.businesses()).some(b=>b.id===businessId)).toBe(false);
    await expect(billingStore.transact(businessId,async()=>true)).rejects.toThrow("unavailable for billing");
    for (const change of ["billing_mode='square'","chosen_plan='professional'","manual_payment_state='invoiced'"]) {
      await expect(pool.query(`UPDATE businesses SET ${change} WHERE id=$1`,[businessId])).rejects.toMatchObject({code:"23514"});
    }
    const r=await pool.query(`SELECT
      (SELECT count(*) FROM manual_invoices WHERE business_id=$1)::int AS invoices,
      (SELECT count(*) FROM billing_accounts WHERE business_id=$1)::int AS accounts,
      (SELECT count(*) FROM invoice_emails e JOIN manual_invoices i ON i.id=e.invoice_id WHERE i.business_id=$1)::int AS emails`,[businessId]);
    expect(r.rows[0]).toEqual({invoices:0,accounts:0,emails:0});
    const list = await fetch(`${baseUrl}/api/admin/invoicing`);
    expect(list.status).toBe(200);
    const overview = await list.json() as {businesses:Array<{businessId:number}>};
    expect(overview.businesses.some(b=>b.businessId===businessId)).toBe(false);
    const owner = await fetch(`${baseUrl}/api/invoicing/me`);
    expect(owner.status).toBe(404);
  });
  it("accepts a signed Aria analyzed call, creates exactly one lead and alert, tolerates sparse fields, then removes it",async()=>{
    const payload=JSON.stringify({event:"call_analyzed",call:{
      call_id:callId,direction:"inbound",to_number:"+12397882087",from_number:"+12025550199",
      duration_ms:45000,start_timestamp:Date.now(),
      call_analysis:{call_summary:"Simulated Corvlio sales inquiry",call_successful:true,user_sentiment:"Positive",
        custom_analysis_data:{"User_phone":"+12025550199","User name":"Internal Test Caller",
          reason_for_call:"Ask about the receptionist",appointment_booked:false}},
    }});
    const timestamp=Date.now();
    const signature=createHmac("sha256",testKey).update(payload).update(String(timestamp)).digest("hex");
    try {
      for(let i=0;i<2;i++) {
        const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-retell-signature":`v=${timestamp},d=${signature}`},body:payload});
        expect(res.status).toBe(204);
      }
      const leads=await pool.query("SELECT * FROM leads WHERE retell_call_id=$1",[callId]);
      expect(leads.rows).toHaveLength(1);
      expect(leads.rows[0]).toMatchObject({business_id:businessId,caller_name:"Internal Test Caller",issue_reason:"Ask about the receptionist",phone_number:"+12025550199",address:null});
      const events=await pool.query("SELECT * FROM notification_events WHERE business_id=$1 AND lead_id=$2",[String(businessId),String(leads.rows[0].id)]);
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]).toMatchObject({status:"queued",email_status:"queued"});
      expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    } finally {await cleanup();}
    expect((await pool.query("SELECT id FROM leads WHERE retell_call_id=$1",[callId])).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM retell_call_records WHERE retell_call_id=$1",[callId])).rowCount).toBe(0);
  });
});

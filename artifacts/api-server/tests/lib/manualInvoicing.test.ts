import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks=vi.hoisted(()=>({
  query:vi.fn(),connect:vi.fn(),release:vi.fn(),send:vi.fn(),provision:vi.fn(),find:vi.fn(),
}));
vi.mock("@workspace/db",()=>({pool:{query:mocks.query,connect:mocks.connect}}));
vi.mock("../../src/lib/gmail",()=>({sendBillingNotificationEmail:mocks.send}));
vi.mock("../../src/lib/retellProvisioning",()=>({saveBusinessWithOptionalPhone:mocks.provision}));
vi.mock("../../src/lib/businessDirectory",()=>({findBusinessById:mocks.find}));
vi.mock("../../src/lib/logger",()=>({logger:{error:vi.fn()}}));
import { addDays,anniversary,invoiceNumber,invoiceStatus,PLANS,validPaymentLink } from "../../src/invoicing/policy";
import { activateBusiness,approveStartup,assignBusinessPlan,initializeInvoices,insertInvoice,markInvoicePaid,scheduleInvoiceWork,ownerInvoiceOverview } from "../../src/invoicing/service";
import { deliverInvoiceEmails,invoiceEmailBody,provisionPaidBusinesses } from "../../src/invoicing/worker";

const b={id:71,business_name:"Test Invoice Business",owner_email:"test@example.test",chosen_plan:"starter",
  billing_mode:"manual" as const,
  startup_age_months:null,manual_payment_state:"invoiced",first_invoice_paid_at:null,provisioning_state:"awaiting_payment",retell_phone_number:null,is_sample:false};
const i={id:91,business_id:71,business_name:b.business_name,plan:"starter",period_key:"initial",
  monthly_cents:75000,setup_cents:30000,issued_at:new Date("2026-10-18T12:00Z"),due_at:new Date("2026-10-23T12:00Z"),
  paid_at:null,payment_reference:null,delivery_status:"pending",reminder_status:"not_scheduled"};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({query:mocks.query,release:mocks.release});
  mocks.query.mockResolvedValue({rows:[]});
});
describe("manual invoicing policy",()=>{
  it("matches all four approved USD prices",()=>{
    expect(Object.values(PLANS).map(p=>[p.monthlyCents,p.setupCents])).toEqual([[50000,25000],[75000,30000],[100000,30000],[125000,30000]]);
  });
  it("uses stable invoice numbers and five-day dates",()=>{
    expect(invoiceNumber(1)).toBe("CORV-001");
    expect(invoiceNumber(1001)).toBe("CORV-1001");
    expect(addDays(i.issued_at,5)).toEqual(i.due_at);
  });
  it("clamps February without drifting the March anniversary",()=>{
    const jan=new Date("2028-01-31T12:34:56Z");
    expect(anniversary(jan,1).toISOString()).toBe("2028-02-29T12:34:56.000Z");
    expect(anniversary(jan,2).toISOString()).toBe("2028-03-31T12:34:56.000Z");
    expect(anniversary(new Date("2026-12-31T00:00Z"),1).toISOString()).toBe("2027-01-31T00:00:00.000Z");
  });
  it("only marks unpaid invoices overdue",()=>{
    expect(invoiceStatus(null,i.due_at,new Date("2026-10-24"))).toBe("overdue");
    expect(invoiceStatus(new Date(),i.due_at,new Date("2026-10-24"))).toBe("paid");
  });
  it.each(["javascript:alert(1)","http://pay.example","https://user:pass@pay.example","not a url"])("rejects unsafe payment link %s",v=>{
    expect(validPaymentLink(v)).toBe(false);
  });
  it("accepts an optional HTTPS payment link",()=>{
    expect(validPaymentLink("")).toBe(true);expect(validPaymentLink("https://pay.example/invoice")).toBe(true);
  });
});
describe("invoice persistence and approval",()=>{
  it("assigns a plan and initializes an invoice while keeping native setup pending activation",async()=>{
    let business={...b,chosen_plan:null,manual_payment_state:null,provisioning_state:"awaiting_activation"};
    const invoices:any[]=[];
    mocks.query.mockImplementation(async(sql:string,params:any[] = [])=>{
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[business]};
      if(sql.startsWith("SELECT * FROM manual_invoices WHERE business_id")) return {rows:invoices};
      if(sql.startsWith("UPDATE businesses SET chosen_plan")) {
        business={...business,chosen_plan:params[1],startup_age_months:params[2],manual_payment_state:params[3]};
        return {rows:[]};
      }
      if(sql.startsWith("INSERT INTO manual_invoices")) {
        const [business_id,business_name,plan,period_key,monthly_cents,setup_cents,issued_at,due_at]=params;
        const invoice={id:91,business_id,business_name,plan,period_key,monthly_cents,setup_cents,issued_at,due_at,paid_at:null,payment_reference:null};
        invoices.push(invoice);
        return {rows:[invoice]};
      }
      if(sql.includes("SELECT i.*")) return {rows:invoices.map(invoice=>({...invoice,delivery_status:"pending",reminder_status:"not_scheduled"}))};
      if(sql.startsWith("SELECT instructions")) return {rows:[]};
      return {rows:[]};
    });
    const overview=await assignBusinessPlan(71,"starter");
    expect(overview).toMatchObject({
      plan:"starter",status:"invoiced",serviceActive:false,provisioningState:"awaiting_activation",
      invoices:[{plan:"starter",status:"invoiced",monthlyCents:75000,setupCents:30000}],
    });
    expect(business).toMatchObject({
      chosen_plan:"starter",manual_payment_state:"invoiced",provisioning_state:"awaiting_activation",
    });
  });

  it("rejects Startup assignments for businesses aged 18 months or more",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>({
      rows:sql.startsWith("SELECT * FROM businesses")
        ? [{...b,chosen_plan:null,manual_payment_state:null,provisioning_state:"awaiting_activation"}] : [],
    }));
    await expect(assignBusinessPlan(71,"startup",18)).rejects.toThrow("under 18 months");
    expect(mocks.query.mock.calls.some(([sql])=>String(sql).startsWith("UPDATE businesses"))).toBe(false);
  });

  it("changes an unpaid, unsent initial invoice without creating a second invoice",async()=>{
    let business={...b,chosen_plan:"starter",provisioning_state:"awaiting_activation"};
    const invoice={...i};
    mocks.query.mockImplementation(async(sql:string,params:any[] = [])=>{
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[business]};
      if(sql.startsWith("SELECT * FROM manual_invoices WHERE business_id")) return {rows:[invoice]};
      if(sql.startsWith("SELECT status FROM invoice_emails")) return {rows:[{status:"pending"}]};
      if(sql.startsWith("UPDATE manual_invoices SET plan")) {
        Object.assign(invoice,{plan:params[1],monthly_cents:params[2],setup_cents:params[3]});
        return {rows:[]};
      }
      if(sql.startsWith("UPDATE businesses SET chosen_plan")) {
        business={...business,chosen_plan:params[1],startup_age_months:params[2],manual_payment_state:params[3]};
        return {rows:[]};
      }
      if(sql.includes("SELECT i.*")) return {rows:[{...invoice,delivery_status:"pending",reminder_status:"not_scheduled"}]};
      if(sql.startsWith("SELECT instructions")) return {rows:[]};
      return {rows:[]};
    });
    const overview=await assignBusinessPlan(71,"professional");
    expect(overview.plan).toBe("professional");
    expect(overview.invoices).toHaveLength(1);
    expect(invoice).toMatchObject({plan:"professional",monthly_cents:100000,setup_cents:30000});
    expect(mocks.query.mock.calls.filter(([sql])=>String(sql).startsWith("INSERT INTO manual_invoices"))).toHaveLength(0);
  });

  it("requires payment before native setup activation",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>({
      rows:sql.startsWith("SELECT * FROM businesses")
        ? [{...b,chosen_plan:null,manual_payment_state:null,provisioning_state:"awaiting_activation"}] : [],
    }));
    await expect(activateBusiness(71)).rejects.toThrow("confirm the first invoice payment");
    expect(mocks.query.mock.calls.some(([sql])=>String(sql).startsWith("UPDATE businesses"))).toBe(false);
  });

  it("moves a paid setup into the guarded phone-provisioning state on activation",async()=>{
    let business={...b,chosen_plan:"starter",manual_payment_state:"paid",first_invoice_paid_at:new Date(),provisioning_state:"awaiting_activation"};
    const paidInvoice={...i,paid_at:new Date()};
    mocks.query.mockImplementation(async(sql:string,params:any[] = [])=>{
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[business]};
      if(sql.startsWith("UPDATE businesses SET provisioning_state")) {
        business={...business,provisioning_state:params[1]};
        return {rows:[]};
      }
      if(sql.includes("SELECT i.*")) return {rows:[{...paidInvoice,delivery_status:"sent",reminder_status:"not_scheduled"}]};
      if(sql.startsWith("SELECT instructions")) return {rows:[]};
      return {rows:[]};
    });
    const overview=await activateBusiness(71);
    expect(overview.provisioningState).toBe("awaiting_payment");
    expect(overview.serviceActive).toBe(false);
    expect(business.provisioning_state).toBe("awaiting_payment");
  });

  it("uses business-period uniqueness and does not enqueue a duplicate email",async()=>{
    await insertInvoice({query:mocks.query} as any,b as any,"initial",i.issued_at);
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0][0]).toContain("ON CONFLICT(business_id,period_key) DO NOTHING");
    expect(mocks.query.mock.calls[0][1]).toContain(30000);
  });
  it("never adds a second setup fee to recurring invoices",async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{...i,id:92}]});
    await insertInvoice({query:mocks.query} as any,b as any,"monthly:1",i.issued_at);
    expect(mocks.query.mock.calls[0][1][5]).toBe(0);
    expect(mocks.query.mock.calls[1][0]).toContain("ON CONFLICT DO NOTHING");
  });
  it.each([{...b,chosen_plan:"startup",manual_payment_state:"requested"},{...b,is_sample:true},{...b,chosen_plan:null}])
  ("does not invoice a pending Startup, sample, or legacy business",async business=>{
    mocks.query.mockImplementation(async sql=>({rows:String(sql).startsWith("SELECT * FROM businesses")?[business]:[]}));
    await initializeInvoices(b.id);
    expect(mocks.query.mock.calls.some(c=>String(c[0]).startsWith("INSERT INTO manual_invoices"))).toBe(false);
  });
  it("rejects ineligible Startup before issuing an invoice",async()=>{
    mocks.query.mockImplementation(async sql=>({rows:String(sql).startsWith("SELECT * FROM businesses")?[{...b,chosen_plan:"startup",startup_age_months:18,manual_payment_state:"requested"}]:[]}));
    await expect(approveStartup(71)).rejects.toThrow("under 18 months");
    expect(mocks.query.mock.calls.some(c=>String(c[0]).startsWith("INSERT INTO manual_invoices"))).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
  });
  it("rolls back a missing payment rather than recording it on another business",async()=>{
    await expect(markInvoicePaid(999,"admin","check 123")).rejects.toThrow("not found");
    expect(mocks.query.mock.calls.some(c=>String(c[0]).startsWith("UPDATE"))).toBe(false);
  });
  it("records the payment actor/reference and first paid activation atomically",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.startsWith("SELECT business_id")) return {rows:[{business_id:71}]};
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[b]};
      if(sql.startsWith("SELECT * FROM manual_invoices")) return {rows:[i]};
      if(sql.includes("SELECT i.*")) return {rows:[{...i,paid_at:new Date()}]};
      return {rows:[]};
    });
    await markInvoicePaid(91,"admin_test","Zelle verified 123");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("paid_by=$2"),[91,"admin_test","Zelle verified 123"]);
    expect(mocks.query.mock.calls.some(c=>String(c[0]).includes("first_invoice_paid_at=coalesce"))).toBe(true);
  });
  it("a repeated payment confirmation does not overwrite its reference or activation date",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.startsWith("SELECT business_id")) return {rows:[{business_id:71}]};
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[{...b,first_invoice_paid_at:new Date()}]};
      if(sql.startsWith("SELECT * FROM manual_invoices")||sql.includes("SELECT i.*")) return {rows:[{...i,paid_at:new Date()}]};
      return {rows:[]};
    });
    await markInvoicePaid(91,"admin_test","different reference");
    expect(mocks.query.mock.calls.some(c=>String(c[0]).startsWith("UPDATE"))).toBe(false);
  });
  it("derives overdue without disabling an already-paid receptionist",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[{...b,first_invoice_paid_at:new Date(),retell_phone_number:"+15550000000"}]};
      if(sql.includes("SELECT i.*")) return {rows:[i]};
      return {rows:[]};
    });
    const overview=await ownerInvoiceOverview(71,new Date("2026-10-28"));
    expect(overview).toMatchObject({status:"overdue",serviceActive:true});
    expect(overview.invoices[0].deliveryStatus).toBe("awaiting_instructions");
  });
  it("generates monthly periods anchored to first payment and schedules only one overdue reminder",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.startsWith("SELECT id FROM businesses")) return {rows:[{id:71}]};
      if(sql.startsWith("SELECT * FROM businesses")) return {rows:[{...b,first_invoice_paid_at:new Date("2026-08-31T12:00Z")}]};
      return {rows:[]};
    });
    await scheduleInvoiceWork(new Date("2026-10-31T12:00Z"));
    const inserts=mocks.query.mock.calls.filter(c=>String(c[0]).startsWith("INSERT INTO manual_invoices"));
    expect(inserts.map(c=>c[1][3])).toEqual(["initial","monthly:1","monthly:2"]);
    expect(inserts.map(c=>c[1][5])).toEqual([30000,0,0]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT(invoice_id,kind) DO NOTHING"),[new Date("2026-10-28T12:00Z"),null]);
  });
});
describe("email and provisioning safety",()=>{
  it("includes the professional invoice, payee, totals, instructions and reference",()=>{
    const text=invoiceEmailBody(i,"Pay by check.","https://pay.example",false);
    expect(text).toContain("Markland Ventures LLC (DBA Corvlio)");
    expect(text).toContain("CORV-091");
    expect(text).toContain("$1,050.00");
    expect(text).toContain("Pay by check.");
    expect(text).toContain("2026-10-23");
  });
  it("does not contact Gmail until payment instructions have been configured",async()=>{
    await deliverInvoiceEmails();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("claims an email before Gmail and does not resend on ambiguous failure",async()=>{
    let claimed=false;
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.startsWith("SELECT instructions")) return {rows:[{instructions:"Pay by check",payment_link:""}]};
      if(sql.startsWith("SELECT id FROM invoice_emails")) return {rows:[{id:1}]};
      if(sql.startsWith("UPDATE invoice_emails e")) {if(claimed)return {rows:[]};claimed=true;return {rows:[{invoice_id:91,kind:"invoice"}]};}
      if(sql.startsWith("SELECT i.*")) return {rows:[{...i,owner_email:"test@example.test",billing_mode:"manual"}]};
      return {rows:[]};
    });
    mocks.send.mockRejectedValue(new Error("Network response lost"));
    await deliverInvoiceEmails();await deliverInvoiceEmails();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith("UPDATE invoice_emails SET status='needs_review' WHERE id=$1",[1]);
  });
  it("does not purchase anything when no first-paid activation is queued",async()=>{
    await provisionPaidBusinesses();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0][0]).toContain("first_invoice_paid_at IS NOT NULL");
  });
  it("never creates a local invoice for a Square-mode business",async()=>{
    await insertInvoice({query:mocks.query} as any,{...b,billing_mode:"square"},"initial",new Date());
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("does not email a Square business even if a stale local email was claimed",async()=>{
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.startsWith("SELECT instructions")) return {rows:[{instructions:"Pay by check",payment_link:""}]};
      if(sql.startsWith("SELECT id FROM invoice_emails")) return {rows:[{id:1}]};
      if(sql.startsWith("UPDATE invoice_emails e")) return {rows:[{invoice_id:91,kind:"reminder"}]};
      if(sql.startsWith("SELECT i.*")) return {rows:[{...i,owner_email:"test@example.test",billing_mode:"square"}]};
      return {rows:[]};
    });
    await deliverInvoiceEmails();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("b.billing_mode='manual'"),[1]);
    expect(mocks.query).toHaveBeenCalledWith("UPDATE invoice_emails SET status='skipped' WHERE id=$1",[1]);
  });
});

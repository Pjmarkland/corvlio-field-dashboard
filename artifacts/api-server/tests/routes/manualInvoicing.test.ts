import { createServer, type Server } from "node:http";
import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({
  user:vi.fn(),admin:vi.fn(),find:vi.fn(),overview:vi.fn(),approve:vi.fn(),paid:vi.fn(),settings:vi.fn(),query:vi.fn(),cycle:vi.fn(),
}));
vi.mock("@clerk/express",()=>({getAuth:m.user}));
vi.mock("@workspace/db",()=>({pool:{query:m.query}}));
vi.mock("../../src/middlewares/requireAdmin",()=>({requireAdmin:m.admin}));
vi.mock("../../src/lib/businessDirectory",()=>({findBusinessByClerkUserId:m.find}));
vi.mock("../../src/invoicing/worker",()=>({runInvoiceCycle:m.cycle}));
vi.mock("../../src/invoicing/service",async(importOriginal)=>({
  ...await importOriginal<typeof import("../../src/invoicing/service")>(),
  ownerInvoiceOverview:m.overview,approveStartup:m.approve,markInvoicePaid:m.paid,paymentInstructions:m.settings,
}));
import router from "../../src/routes/invoicing";
let server:Server,url:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{(req as any).log={error:vi.fn()};next();});
  app.use(router);server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  url=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{
  vi.clearAllMocks();
  m.user.mockReturnValue({userId:"owner_a"});
  m.admin.mockImplementation((_req,res)=>res.sendStatus(404));
  m.find.mockResolvedValue({id:7});
  m.overview.mockResolvedValue({businessId:7,status:"invoiced",invoices:[]});
  m.approve.mockResolvedValue({businessId:7,status:"invoiced"});
  m.paid.mockResolvedValue({businessId:7,status:"paid"});
  m.query.mockResolvedValue({rows:[]});
  m.settings.mockResolvedValue({instructions:"",paymentLink:""});
  m.cycle.mockResolvedValue(undefined);
});
const post=(path:string,data={})=>fetch(url+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
describe("manual invoice boundaries",()=>{
  it("requires authentication for owner invoice reads",async()=>{
    m.user.mockReturnValue({userId:null});
    expect((await fetch(url+"/invoicing/me")).status).toBe(401);
    expect(m.find).not.toHaveBeenCalled();
  });
  it("derives the business from authenticated identity, ignoring a supplied business ID",async()=>{
    const response=await fetch(url+"/invoicing/me?businessId=999");
    expect(response.status).toBe(200);
    expect(m.find).toHaveBeenCalledWith("owner_a");
    expect(m.overview).toHaveBeenCalledWith(7);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not reveal another business to an unconfigured identity",async()=>{
    m.find.mockResolvedValue(undefined);
    expect((await fetch(url+"/invoicing/me")).status).toBe(404);
    expect(m.overview).not.toHaveBeenCalled();
  });
  it.each(["/admin/invoicing/7/approve-startup","/admin/invoicing/invoices/9/paid"])("protects admin mutations: %s",async path=>{
    expect((await post(path,{reference:"fake"})).status).toBe(404);
    expect(m.paid).not.toHaveBeenCalled();expect(m.approve).not.toHaveBeenCalled();
  });
  it("rejects empty payment references and unexpected identity overrides",async()=>{
    m.admin.mockImplementation((_req,_res,next)=>next());
    expect((await post("/admin/invoicing/invoices/9/paid",{reference:""})).status).toBe(400);
    expect((await post("/admin/invoicing/invoices/9/paid",{reference:"check",paidBy:"another_owner"})).status).toBe(400);
    expect(m.paid).not.toHaveBeenCalled();
  });
  it("uses the verified admin identity and queues activation after recording payment",async()=>{
    m.admin.mockImplementation((_req,_res,next)=>next());m.user.mockReturnValue({userId:"verified_admin"});
    expect((await post("/admin/invoicing/invoices/9/paid",{reference:" Zelle 123 "})).status).toBe(200);
    expect(m.paid).toHaveBeenCalledWith(9,"verified_admin","Zelle 123");
    expect(m.cycle).toHaveBeenCalledOnce();
  });
  it("approves Startup through the approval service",async()=>{
    m.admin.mockImplementation((_req,_res,next)=>next());
    expect((await post("/admin/invoicing/7/approve-startup")).status).toBe(200);
    expect(m.approve).toHaveBeenCalledWith(7);
  });
  it("rejects unsafe payment URLs before persisting",async()=>{
    m.admin.mockImplementation((_req,_res,next)=>next());
    const r=await fetch(url+"/admin/invoicing/settings",{method:"PATCH",headers:{"content-type":"application/json"},
      body:JSON.stringify({instructions:"Pay here",paymentLink:"javascript:alert(1)"})});
    expect(r.status).toBe(400);expect(m.query).not.toHaveBeenCalled();
  });
});

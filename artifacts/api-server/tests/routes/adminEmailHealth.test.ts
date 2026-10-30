import {createServer,type Server} from "node:http";
import express from "express";
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({admin:vi.fn(),user:vi.fn(),query:vi.fn(),send:vi.fn(),health:vi.fn(),retry:vi.fn(),incident:vi.fn()}));
vi.mock("@clerk/express",()=>({getAuth:()=>({userId:"admin1"}),clerkClient:{users:{getUser:m.user}}}));
vi.mock("@workspace/db",()=>({pool:{query:m.query,connect:async()=>({query:m.query,release:vi.fn()})}}));
vi.mock("../../src/middlewares/requireAdmin",()=>({requireAdmin:m.admin,parseAdminEmails:()=>new Set(["admin@example.test"])}));
vi.mock("../../src/lib/emailHealth",()=>({getEmailHealth:m.health,retryFailedLeadEmails:m.retry}));
vi.mock("../../src/lib/gmail",()=>({sendAdminTestEmail:m.send}));
vi.mock("../../src/lib/operationalFailures",()=>({recordOperationalFailure:m.incident}));
import router from "../../src/routes/adminEmailHealth";
let server:Server,url:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{(req as any).log={error:vi.fn(),warn:vi.fn()};next();});
  app.use(router);server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  url=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{
  vi.clearAllMocks();
  m.admin.mockImplementation((_req,res)=>res.sendStatus(404));
  m.query.mockResolvedValue({rows:[],rowCount:0});
  m.send.mockResolvedValue(undefined);m.incident.mockResolvedValue(false);
  m.user.mockResolvedValue({primaryEmailAddressId:"email1",emailAddresses:[
    {id:"email1",emailAddress:"admin@example.test",verification:{status:"verified"}},
  ]});
  m.health.mockResolvedValue({lastSuccess:null,lastFailure:null,failed:[],hasMore:false});
  m.retry.mockResolvedValue({queued:1});
});
const post=(path:string,body:unknown)=>fetch(url+"/admin/email-health"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const allow=()=>m.admin.mockImplementation((_req,_res,next)=>next());
const requestId="59eb4826-bf00-4978-b7e5-e9caa9aff919";
describe("email health safety boundaries",()=>{
  it("denies non-admin health, test and retry requests",async()=>{
    expect((await fetch(url+"/admin/email-health")).status).toBe(404);
    expect((await post("/test",{requestId})).status).toBe(404);
    expect((await post("/retry",{confirmed:true,entries:[{id:1,recipient:"client@example.test"}]})).status).toBe(404);
    expect(m.send).not.toHaveBeenCalled();expect(m.retry).not.toHaveBeenCalled();
  });
  it("GET is read-only and never sends or retries anything",async()=>{
    allow();expect((await fetch(url+"/admin/email-health")).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();expect(m.retry).not.toHaveBeenCalled();
  });
  it("rejects a recipient override",async()=>{
    allow();expect((await post("/test",{requestId,recipient:"client@example.test"})).status).toBe(400);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("sends exactly one test only to the verified signed-in admin",async()=>{
    allow();const response=await post("/test",{requestId});
    expect(response.status).toBe(200);expect((await response.json()).success).toBe(true);
    expect(m.send).toHaveBeenCalledExactlyOnceWith("admin@example.test");
  });
  it("returns the precise API-disabled cause without automatic send retries",async()=>{
    allow();m.send.mockRejectedValue(new Error("Gmail API admin test email failed (403): Gmail API is not enabled for Google Cloud project 1028015564678."));
    const data=await (await post("/test",{requestId})).json();
    expect(data.success).toBe(false);expect(data.error).toContain("1028015564678");
    expect(data.hint).toContain("then press Send test email");
    expect(m.send).toHaveBeenCalledOnce();expect(m.incident).toHaveBeenCalledOnce();
  });
  it("does not send again when the same test request is repeated",async()=>{
    allow();m.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith("SELECT status,error")?[{status:"sent",error:null}]:[],rowCount:0}));
    expect((await post("/test",{requestId})).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("limits tests to one a minute",async()=>{
    allow();m.query.mockImplementation(async(sql:string)=>({rows:[],rowCount:sql.startsWith("SELECT id FROM email_health_attempts")?1:0}));
    expect((await post("/test",{requestId})).status).toBe(429);expect(m.send).not.toHaveBeenCalled();
  });
  it("never queues absent, empty or unconfirmed batches",async()=>{
    allow();
    for(const body of [{},{confirmed:true,entries:[]},{confirmed:false,entries:[{id:1,recipient:"client@example.test"}]}]){
      expect((await post("/retry",body)).status).toBe(400);
    }
    expect(m.retry).not.toHaveBeenCalled();
  });
  it("queues only explicitly selected, confirmed entries",async()=>{
    allow();const entries=[{id:6,recipient:"owner@example.test"}];
    expect((await post("/retry",{confirmed:true,entries})).status).toBe(200);
    expect(m.retry).toHaveBeenCalledExactlyOnceWith(entries);
    expect(m.send).not.toHaveBeenCalled();
  });
});

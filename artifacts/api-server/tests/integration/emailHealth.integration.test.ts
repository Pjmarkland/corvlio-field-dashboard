import {randomUUID} from "node:crypto";
import {afterAll,describe,expect,it} from "vitest";
import {pool} from "@workspace/db";
import {getEmailHealth,retryFailedLeadEmails} from "../../src/lib/emailHealth";

describe.skipIf(process.env.RUN_EMAIL_HEALTH_DB_TESTS!=="true")("email health PostgreSQL boundaries (no worker or sends)",()=>{
  const businessIds:number[]=[], eventIds:number[]=[];
  afterAll(async()=>{
    if(eventIds.length)await pool.query("DELETE FROM notification_events WHERE id=ANY($1::int[])",[eventIds]);
    if(businessIds.length)await pool.query("DELETE FROM businesses WHERE id=ANY($1::int[])",[businessIds]);
    await pool.end();
  });
  it("leaves old failures untouched on read and queues only confirmed matching recipients",async()=>{
    if(process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN)throw new Error("Development only");
    const b=await pool.query("INSERT INTO businesses(business_name,clerk_user_id,owner_email) VALUES($1,$2,$3) RETURNING id",
      ["Disposable email health verification",`email_health_test_${randomUUID()}`,"health-owner@example.test"]);
    const id=b.rows[0].id;businessIds.push(id);
    const lead=await pool.query("INSERT INTO leads(business_id) VALUES($1) RETURNING id",[id]);
    for(let i=0;i<2;i++){
      const otherLead=i===0?lead:await pool.query("INSERT INTO leads(business_id) VALUES($1) RETURNING id",[id]);
      const event=await pool.query(`INSERT INTO notification_events(business_id,lead_id,title,body,deep_link,email_status,email_attempts,email_last_error,created_at)
        VALUES($1,$2,'Disposable health test','Test only','/dashboard','failed',5,$3,'2026-10-08T13:00:00Z') RETURNING id`,
        [String(id),String(otherLead.rows[0].id),"Gmail API has not been used in project 1028015564678 before or it is disabled."]);
      eventIds.push(event.rows[0].id);
    }
    const overview=await getEmailHealth();
    expect(overview.failed.find(row=>row.id===eventIds[0])?.recipient).toBe("health-owner@example.test");
    const states=await pool.query("SELECT email_status FROM notification_events WHERE id=ANY($1::int[])",[eventIds]);
    expect(states.rows.every(row=>row.email_status==="failed")).toBe(true);
    expect(await retryFailedLeadEmails([{id:eventIds[0],recipient:"different@example.test"}])).toEqual({queued:0});
    expect(await retryFailedLeadEmails([{id:eventIds[0],recipient:"health-owner@example.test"}])).toEqual({queued:1});
    expect(await retryFailedLeadEmails([{id:eventIds[0],recipient:"health-owner@example.test"}])).toEqual({queued:0});
    const final=await pool.query("SELECT id,email_status,email_attempts FROM notification_events WHERE id=ANY($1::int[]) ORDER BY id",[eventIds]);
    expect(final.rows).toEqual([
      {id:eventIds[0],email_status:"queued",email_attempts:0},
      {id:eventIds[1],email_status:"failed",email_attempts:5},
    ]);
  });
});

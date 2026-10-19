import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { emailDiagnosis } from "./emailDiagnostics";

export async function recordLeadEmailAttempt(error: string | null) {
  try {
    await pool.query(`INSERT INTO email_health_attempts(id,kind,status,error,finished_at)
      VALUES($1,'lead',$2,$3,now())`, [randomUUID(), error ? "failed" : "sent", error ? emailDiagnosis(error).error : null]);
  } catch {
    // Never turn an already-sent email into a retry because health logging failed.
    logger.warn("Unable to persist email health history");
  }
}

export async function getEmailHealth() {
  const rows = await pool.query<{at:Date;exact:boolean;error:string|null;status:string}>(`
    SELECT DISTINCT ON (status) at,exact,error,status FROM (
      SELECT finished_at AS at,true AS exact,error,status FROM email_health_attempts WHERE finished_at IS NOT NULL
      UNION ALL
      SELECT created_at AS at,false AS exact,email_last_error AS error,
        CASE WHEN email_status='delivered' THEN 'sent' ELSE 'failed' END AS status
      FROM notification_events WHERE email_status='delivered' OR email_last_error IS NOT NULL
    ) all_sends ORDER BY status,at DESC`);
  const record = (r:typeof rows.rows[number]|undefined) => r ? {
    at:r.at.toISOString(),timestampExact:r.exact,
    ...(r.error ? emailDiagnosis(r.error) : {error:null,cause:"Send succeeded.",hint:""}),
  } : null;
  const failed = await pool.query<{id:number;recipient:string|null;created_at:Date;email_last_error:string|null}>(`
    SELECT n.id,b.owner_email AS recipient,n.created_at,n.email_last_error
    FROM notification_events n JOIN businesses b ON b.id::text=n.business_id
    JOIN leads l ON l.id::text=n.lead_id AND l.business_id=b.id
    WHERE n.email_status='failed' AND b.is_sample=false
    ORDER BY n.created_at ASC,n.id ASC LIMIT 101`);
  return { lastSuccess:record(rows.rows.find(r=>r.status==="sent")),
    lastFailure:record(rows.rows.find(r=>r.status==="failed")),
    failed:failed.rows.slice(0,100).map(r=>({id:r.id,recipient:r.recipient,createdAt:r.created_at.toISOString(),
      ...emailDiagnosis(r.email_last_error ?? "No provider error was recorded.")})),
    hasMore:failed.rows.length>100 };
}

export async function retryFailedLeadEmails(entries: Array<{id:number;recipient:string}>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let queued=0;
    for (const entry of entries) {
      const result=await client.query(`UPDATE notification_events n
        SET email_status='queued',email_attempts=0,email_next_attempt_at=now()
        FROM businesses b,leads l
        WHERE n.id=$1 AND n.email_status='failed' AND b.id::text=n.business_id
          AND l.id::text=n.lead_id AND l.business_id=b.id AND b.is_sample=false
          AND b.lead_alerts_enabled=true AND lower(trim(b.owner_email))=lower(trim($2))
        RETURNING n.id`,[entry.id,entry.recipient]);
      queued+=result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return {queued};
  } catch(e) { await client.query("ROLLBACK");throw e; }
  finally { client.release(); }
}

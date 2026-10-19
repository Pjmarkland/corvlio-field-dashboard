import { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAdmin, parseAdminEmails } from "../middlewares/requireAdmin";
import { getEmailHealth, retryFailedLeadEmails } from "../lib/emailHealth";
import { emailDiagnosis } from "../lib/emailDiagnostics";
import { sendAdminTestEmail } from "../lib/gmail";
import { recordOperationalFailure } from "../lib/operationalFailures";

const router=Router();
router.use("/admin/email-health",requireAdmin,(_req,res,next)=>{
  res.set("Cache-Control","private, no-store");next();
});
router.get("/admin/email-health",async(req,res)=>{
  try {res.json(await getEmailHealth());}
  catch {req.log.error("Unable to load email health");res.status(503).json({error:"Email health is temporarily unavailable."});}
});
const testSchema=z.object({requestId:z.string().uuid()}).strict();
router.post("/admin/email-health/test",async(req,res)=>{
  const body=testSchema.safeParse(req.body);
  if(!body.success){res.status(400).json({error:"A test request ID is required. Recipient overrides are not allowed."});return;}
  const userId=getAuth(req).userId!;
  try {
    const user=await clerkClient.users.getUser(userId);
    const verified=user.emailAddresses.filter(e=>e.verification?.status==="verified");
    const allowed=parseAdminEmails(process.env.ADMIN_EMAILS);
    const email=verified.find(e=>e.id===user.primaryEmailAddressId)
      ?? verified.find(e=>allowed.has(e.emailAddress.toLowerCase()));
    if(!email){res.sendStatus(404);return;}
    const c=await pool.connect();
    let existing;
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(542320,hashtext($1))",[userId]);
      existing=(await c.query("SELECT status,error FROM email_health_attempts WHERE id=$1 AND actor_user_id=$2 AND kind='test'",
        [body.data.requestId,userId])).rows[0];
      if(!existing) {
        const recent=await c.query("SELECT id FROM email_health_attempts WHERE kind='test' AND actor_user_id=$1 AND started_at>now()-interval '1 minute' LIMIT 1",[userId]);
        if(recent.rowCount){await c.query("ROLLBACK");res.status(429).json({error:"Wait one minute before requesting another test."});return;}
        await c.query("INSERT INTO email_health_attempts(id,kind,actor_user_id,recipient,status) VALUES($1,'test',$2,$3,'sending')",
          [body.data.requestId,userId,email.emailAddress]);
      }
      await c.query("COMMIT");
    } catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
    if(existing?.status==="sending"){res.status(409).json({error:"This test is already in progress or requires review. It will not be sent twice."});return;}
    if(existing){res.json(existing.status==="sent"?{success:true,error:null,cause:"Test email sent to your verified email address.",hint:""}:
      {success:false,...emailDiagnosis(existing.error??"Previous test failed.")});return;}
    let failure:string|null=null;
    try {await sendAdminTestEmail(email.emailAddress);}
    catch(e){failure=emailDiagnosis(e instanceof Error?e.message:"Test email failed.").error;}
    await pool.query("UPDATE email_health_attempts SET status=$2,error=$3,finished_at=now() WHERE id=$1",
      [body.data.requestId,failure?"failed":"sent",failure]);
    if(failure){
      req.log.warn({error:failure},"Admin Gmail test failed; no automatic retry");
      await recordOperationalFailure({eventKey:`gmail-test:${body.data.requestId}`,source:"lead_gmail_notification",
        summary:"Admin Gmail test failed",details:failure}).catch(()=>req.log.warn("Unable to record Gmail test incident"));
    }
    res.json(failure?{success:false,...emailDiagnosis(failure)}:
      {success:true,error:null,cause:"Test email sent to your verified email address.",hint:""});
  }catch{req.log.error("Admin email test could not complete; inspect health before requesting another");res.status(503).json({error:"Test status is unavailable. Check Email health before requesting another test."});}
});
const retrySchema=z.object({
  confirmed:z.literal(true),
  entries:z.array(z.object({id:z.number().int().positive(),recipient:z.string().email()}).strict()).min(1).max(50),
}).strict();
router.post("/admin/email-health/retry",async(req,res)=>{
  const body=retrySchema.safeParse(req.body);
  if(!body.success){res.status(400).json({error:"Select 1–50 failed emails and explicitly confirm this batch."});return;}
  try {res.json(await retryFailedLeadEmails(body.data.entries));}
  catch{req.log.error("Failed-email batch could not be queued");res.status(503).json({error:"Retry batch could not be queued."});}
});
export default router;

import { createRequire } from "node:module";
if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production")
  throw new Error("Development workspace only.");
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const apiRequire = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { clerkClient } = apiRequire("@clerk/express");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  const emails = (process.env.ADMIN_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  const { data } = await clerkClient.users.getUserList({ emailAddress: emails, limit: 100 });
  const eligible = data.flatMap(u => {
    const email = u.emailAddresses.find(e => e.verification?.status === "verified" && emails.includes(e.emailAddress.toLowerCase()));
    return email ? [{ userId:u.id, email:email.emailAddress }] : [];
  });
  if (eligible.length !== 1) throw new Error("Owner needs explicit selection; expected one verified admin.");
  const owner = eligible[0];
  await c.query("BEGIN");
  const existing = (await c.query("SELECT * FROM businesses WHERE clerk_user_id=$1 FOR UPDATE",[owner.userId])).rows[0];
  if (existing && existing.business_name !== "Corvlio") throw new Error("Owner already linked to another business; refusing replacement.");
  if (existing) {
    const billing = await c.query(`SELECT
      (SELECT count(*) FROM manual_invoices WHERE business_id=$1)::int AS invoices,
      (SELECT count(*) FROM billing_accounts WHERE business_id=$1)::int AS accounts`,[existing.id]);
    if (billing.rows[0].invoices || billing.rows[0].accounts) throw new Error("Existing billing requires review; no conversion performed.");
    await c.query(`UPDATE businesses SET is_internal=true,is_sample=false,chosen_plan=NULL,billing_mode='manual',
      manual_payment_state=NULL,first_invoice_paid_at=NULL,startup_age_months=NULL,
      retell_phone_number='+12397882087',retell_agent_id=NULL,agent_name='Aria',
      lead_alerts_enabled=true,provisioning_state='internal',owner_email=$2,updated_at=now() WHERE id=$1`,[existing.id,owner.email]);
  } else {
    await c.query(`INSERT INTO businesses(business_name,clerk_user_id,owner_email,is_internal,retell_phone_number,agent_name,provisioning_state)
      VALUES('Corvlio',$1,$2,true,'+12397882087','Aria','internal')`,[owner.userId,owner.email]);
  }
  await c.query("COMMIT");
  console.log("Development Corvlio internal business linked to the sole verified admin. Agent ID blank. No provider requests or sends.");
} catch(e) {await c.query("ROLLBACK");throw e;}
finally {c.release();await pool.end();}

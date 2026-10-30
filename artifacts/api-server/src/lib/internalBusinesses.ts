import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { parseAdminEmails } from "../middlewares/requireAdmin";

export class InternalBusinessError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export async function internalBusinessDirectory() {
  const emails = [...parseAdminEmails(process.env.ADMIN_EMAILS)];
  const users = emails.length ? (await clerkClient.users.getUserList({ emailAddress: emails, limit: 100 })).data : [];
  const linked = (await pool.query("SELECT clerk_user_id,business_name FROM businesses WHERE clerk_user_id IS NOT NULL")).rows;
  const owners = users.flatMap(user => {
    const email = user.emailAddresses.find(e => e.verification?.status === "verified" && emails.includes(e.emailAddress.toLowerCase()));
    return email ? [{ userId: user.id, email: email.emailAddress,
      linkedBusinessName: linked.find(b => b.clerk_user_id === user.id)?.business_name ?? null }] : [];
  });
  const rows = await pool.query(`SELECT id,business_name,retell_phone_number,retell_agent_id,clerk_user_id,owner_email
    FROM businesses WHERE is_internal=true ORDER BY id`);
  return { owners, businesses: rows.rows.map(internalBusinessRecord) };
}
export function internalBusinessRecord(b: Record<string, any>) {
  return { id: b.id, businessName: b.business_name, retellPhoneNumber: b.retell_phone_number,
    retellAgentId: b.retell_agent_id, ownerUserId: b.clerk_user_id, ownerEmail: b.owner_email };
}
export async function createInternalBusiness(input: {
  businessName: string; retellPhoneNumber: string; ownerUserId: string; retellAgentId?: string | null;
}) {
  const { owners } = await internalBusinessDirectory();
  const owner = owners.find(o => o.userId === input.ownerUserId);
  if (!owner) throw new InternalBusinessError("Choose a verified, allowlisted admin owner.", 400);
  if (owner.linkedBusinessName) throw new InternalBusinessError("This owner already has a business. Existing ownership will not be replaced.");
  try {
    const result = await pool.query(`INSERT INTO businesses
      (business_name,retell_phone_number,retell_agent_id,clerk_user_id,owner_email,is_internal,is_sample,lead_alerts_enabled,provisioning_state)
      VALUES($1,$2,$3,$4,$5,true,false,true,'internal') RETURNING *`,
      [input.businessName, input.retellPhoneNumber, input.retellAgentId?.trim() || null, owner.userId, owner.email]);
    return internalBusinessRecord(result.rows[0]);
  } catch (error) {
    if ((error as {code?: string}).code === "23505") throw new InternalBusinessError("That owner or destination number is already assigned.");
    throw error;
  }
}

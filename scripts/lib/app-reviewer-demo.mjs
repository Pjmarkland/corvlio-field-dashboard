export const DEMO_MARKER = "app-reviewer-demo:v1";
const CALL_PREFIX = "app-reviewer-demo:";
export class ReviewerDemoError extends Error {}

export function normalizeReviewerEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ReviewerDemoError("Supply one valid reviewer email address.");
  return email;
}

export async function findReviewerUser(email, listUsers) {
  const result = await listUsers(email);
  const users = result.data.filter(user => user.emailAddresses.some(
    address => address.emailAddress.trim().toLowerCase() === email,
  ));
  if (result.totalCount > result.data.length || users.length !== 1) {
    throw new ReviewerDemoError("Expected exactly one existing Clerk user with that email. No Clerk user will be created.");
  }
  if (!users[0].emailAddresses.some(address =>
    address.emailAddress.trim().toLowerCase() === email && address.verification?.status === "verified")) {
    throw new ReviewerDemoError("The reviewer's email must already be verified in Clerk.");
  }
  return users[0].id;
}

export function reviewerLeads(now = new Date()) {
  const samples = [
    ["Nora Ellis", "0101", "Emergency", "new", 2, "Water spreading from a burst supply pipe under the kitchen sink.", "101 Demo Cypress Lane, Fort Myers, FL 33901", "Available now; water main turned off.", "plumbing"],
    ["Miles Parker", "0102", "Emergency", "new", 5, "AC stopped cooling in a home with an elderly resident; indoor temperature is rising.", "202 Sample Palm Court, Fort Myers, FL 33907", "Someone is home all afternoon.", "hvac"],
    ["Clara Brooks", "0103", "Routine", "new", 20, "Annual AC tune-up and filter replacement before the next hot spell.", "303 Example Heron Way, Fort Myers, FL 33919", "Tomorrow morning works best.", "hvac"],
    ["Owen Reed", "0104", "Routine", "new", 30, "Bathroom faucet drips overnight; no flooding or active water damage.", "404 Demo Mangrove Drive, Fort Myers, FL 33916", "Weekdays after 3 PM.", "plumbing"],
    ["Lena Marsh", "0105", "Urgent", "new", 45, "AC condensate drain is backing up into the drain pan.", "505 Sample Egret Terrace, Fort Myers, FL 33912", "Available this evening.", "hvac"],
    ["Theo Grant", "0106", "Routine", "contacted", 58, "Water heater has inconsistent hot water; owner already called back.", "606 Example Shell Avenue, Fort Myers, FL 33905", "Callback completed; waiting for owner follow-up.", "plumbing"],
    ["June Bell", "0107", "Routine", "contacted", 75, "One bedroom gets less airflow; owner discussed next steps by phone.", "707 Demo Pelican Loop, Fort Myers, FL 33908", "Callback completed yesterday.", "hvac"],
    ["Evan Wells", "0108", "Urgent", "new", 92, "Toilet fills continuously and the shutoff valve is stiff; no overflow.", "808 Sample Seabreeze Place, Fort Myers, FL 33913", "Home until noon tomorrow.", "plumbing"],
  ];
  return samples.map(([name, suffix, urgency, status, hours, issue, address, availability, trade]) => {
    const createdAt = new Date(now.getTime() - hours * 3_600_000);
    return { name, phone: `+1239555${suffix}`, urgency, status, issue, address, availability, trade,
      createdAt, contactedAt: status === "contacted" ? new Date(createdAt.getTime() + 3_600_000) : null };
  });
}

/** Caller supplies a dedicated connected pg client. No providers or startup hooks. */
export async function seedReviewerDemo(client, emailInput, clerkUserId, now = new Date()) {
  const email = normalizeReviewerEmail(emailInput);
  if (typeof clerkUserId !== "string" || !clerkUserId.startsWith("user_")) throw new ReviewerDemoError("Invalid existing Clerk user ID.");
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${DEMO_MARKER}:${clerkUserId}`]);
    const { rows } = await client.query(
      "SELECT * FROM businesses WHERE clerk_user_id = $1 OR lower(trim(owner_email)) = $2 FOR UPDATE",
      [clerkUserId, email],
    );
    if (rows.length > 1 || rows.some(row => row.clerk_user_id !== clerkUserId)) {
      throw new ReviewerDemoError("Email/ownership conflict: refusing to relink or replace an existing business.");
    }
    let business = rows[0];
    if (business && (!business.is_sample
      || business.website_enrichment_sources?._appReviewerDemo !== DEMO_MARKER
      || business.retell_phone_number || business.retell_agent_id)) {
      throw new ReviewerDemoError("Existing business is not an unprovisioned reviewer demo created by this script. Refusing changes.");
    }
    if (business) {
      const prefix = `${CALL_PREFIX}${business.id}:%`;
      const unsafe = await client.query(`
        SELECT EXISTS(SELECT 1 FROM retell_call_records WHERE business_id = $1)
          OR EXISTS(SELECT 1 FROM retell_pending_calls WHERE business_id = $1)
          OR EXISTS(SELECT 1 FROM owner_demo_calls WHERE business_id = $1)
          OR EXISTS(SELECT 1 FROM leads WHERE business_id = $1 AND
            (retell_call_id IS NULL OR retell_call_id NOT LIKE $2
             OR recording_url IS NOT NULL OR caller_id IS NOT NULL OR transcript IS NOT NULL))
          AS unsafe`, [business.id, prefix]);
      if (unsafe.rows[0]?.unsafe !== false) throw new ReviewerDemoError("Real or unrecognized call/lead data found. Refusing to replace leads.");
      // Only this script's synthetic IDs are replaceable. Never delete arbitrary leads.
      await client.query("DELETE FROM leads WHERE business_id = $1 AND retell_call_id LIKE $2", [business.id, prefix]);
      await client.query(
        "UPDATE businesses SET owner_email = $2, lead_alerts_enabled = false, provisioning_state = 'sample', updated_at = $3 WHERE id = $1",
        [business.id, email, now],
      );
    } else {
      const created = await client.query(`
        INSERT INTO businesses (business_name, clerk_user_id, owner_email, agent_name, is_sample,
          provisioning_state, lead_alerts_enabled, business_hours, time_zone, business_type,
          service_area, services_offered, website_enrichment_sources)
        VALUES ($1, $2, $3, 'Aria', true, 'sample', false, 'Mon-Fri 08:00-17:00', 'America/New_York',
          'HVAC and plumbing', 'Fort Myers, Florida', 'AC repair, AC maintenance, leak repair, water heaters', $4::jsonb)
        RETURNING *`, ["Gulf Breeze HVAC & Plumbing — Reviewer Demo", clerkUserId, email,
        JSON.stringify({ _appReviewerDemo: DEMO_MARKER })]);
      business = created.rows[0];
    }
    const leads = reviewerLeads(now);
    for (const [index, lead] of leads.entries()) {
      await client.query(`
        INSERT INTO leads (business_id, retell_call_id, caller_name, phone_number, callback_number,
          issue_reason, address, urgency_level, availability, status, created_at, contacted_at,
          contacted_by, summary, private_notes, trade_intake_answers)
        VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $5, $13, $14)`,
      [business.id, `${CALL_PREFIX}${business.id}:${index + 1}`, lead.name, lead.phone, lead.issue,
        lead.address, lead.urgency, lead.availability, lead.status, lead.createdAt, lead.contactedAt,
        lead.status === "contacted" ? clerkUserId : null,
        "Fictional App Store reviewer sample. No real call was placed.", `Trade: ${lead.trade}. Sample only.`]);
    }
    await client.query("COMMIT");
    return { businessId: business.id, leadCount: leads.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

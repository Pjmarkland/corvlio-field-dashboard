import { clerkClient } from "@clerk/express";
import { pool, type PoolClient } from "@workspace/db";

export const APP_REVIEW_DEMO_NAME = "App Review Demo";
const SEED_CALL_ID_PREFIX = "corvlio-app-review-demo-seed-";
const DEMO_LOCK_NAMESPACE = 542399;

export class AppReviewDemoError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

type DemoBusinessRow = {
  id: number;
  business_name: string;
  owner_email: string | null;
  clerk_user_id: string | null;
  is_sample: boolean;
  is_internal: boolean;
  retell_phone_number: string | null;
  retell_agent_id: string | null;
  chosen_plan: string | null;
  manual_payment_state: string | null;
  first_invoice_paid_at: Date | null;
};

type DemoStatusRow = {
  id: number;
  business_name: string;
  owner_email: string | null;
  clerk_user_id: string | null;
  is_sample: boolean;
  is_internal: boolean;
  lead_count: number;
};

type DemoStatus = {
  exists: boolean;
  businessId: number | null;
  businessName: string | null;
  ownerEmail: string | null;
  linked: boolean;
  leadCount: number;
};

type SeedLead = {
  callerName: string;
  phoneNumber: string;
  issueReason: string;
  address: string;
  urgencyLevel: "urgent" | "normal" | "low";
  availability: string;
  status: "pending" | "contacted";
  minutesAgo: number;
  minutesUntilContacted: number | null;
};

const seedLeads: SeedLead[] = [
  {
    callerName: "Morgan Ellis",
    phoneNumber: "+12025550101",
    issueReason: "Water is coming through the kitchen ceiling beneath the upstairs bathroom.",
    address: "742 Maple Avenue, Example City, FL",
    urgencyLevel: "urgent",
    availability: "Home now; please call before arriving.",
    status: "pending",
    minutesAgo: 18,
    minutesUntilContacted: null,
  },
  {
    callerName: "Riley Carter",
    phoneNumber: "+12025550102",
    issueReason: "The air conditioner is running but the house is not cooling.",
    address: "18 Harbor Lane, Example City, FL",
    urgencyLevel: "urgent",
    availability: "Available this afternoon.",
    status: "contacted",
    minutesAgo: 52,
    minutesUntilContacted: 9,
  },
  {
    callerName: "Jamie Brooks",
    phoneNumber: "+12025550103",
    issueReason: "The water heater stopped producing hot water this morning.",
    address: "905 Pine Street, Example City, FL",
    urgencyLevel: "normal",
    availability: "Weekdays after 3 PM.",
    status: "pending",
    minutesAgo: 126,
    minutesUntilContacted: null,
  },
  {
    callerName: "Casey Nguyen",
    phoneNumber: "+12025550104",
    issueReason: "The bathroom sink drain is slow and backs up when the faucet runs.",
    address: "44 Cedar Court, Example City, FL",
    urgencyLevel: "normal",
    availability: "Available tomorrow morning.",
    status: "pending",
    minutesAgo: 238,
    minutesUntilContacted: null,
  },
  {
    callerName: "Taylor Reed",
    phoneNumber: "+12025550105",
    issueReason: "A toilet is overflowing and the shutoff valve will not turn.",
    address: "311 Willow Drive, Example City, FL",
    urgencyLevel: "urgent",
    availability: "Someone is at the property now.",
    status: "contacted",
    minutesAgo: 341,
    minutesUntilContacted: 12,
  },
  {
    callerName: "Jordan Patel",
    phoneNumber: "+12025550106",
    issueReason: "The garbage disposal hums but the blades are not turning.",
    address: "62 Birch Road, Example City, FL",
    urgencyLevel: "normal",
    availability: "Today after 1 PM.",
    status: "pending",
    minutesAgo: 489,
    minutesUntilContacted: null,
  },
  {
    callerName: "Avery Scott",
    phoneNumber: "+12025550107",
    issueReason: "There is a drip under the laundry-room shutoff valve.",
    address: "120 Spruce Way, Example City, FL",
    urgencyLevel: "low",
    availability: "Flexible this week.",
    status: "pending",
    minutesAgo: 694,
    minutesUntilContacted: null,
  },
  {
    callerName: "Quinn Foster",
    phoneNumber: "+12025550108",
    issueReason: "The outdoor hose bib is leaking when the hose is connected.",
    address: "7 Magnolia Place, Example City, FL",
    urgencyLevel: "low",
    availability: "Any weekday is fine.",
    status: "pending",
    minutesAgo: 1030,
    minutesUntilContacted: null,
  },
];

function statusFromRow(row: DemoStatusRow): DemoStatus {
  if (!row.is_sample || row.is_internal) {
    throw new AppReviewDemoError(
      `A non-sample business already uses the name "${APP_REVIEW_DEMO_NAME}". It was not changed.`,
    );
  }
  return {
    exists: true,
    businessId: row.id,
    businessName: row.business_name,
    ownerEmail: row.owner_email,
    linked: Boolean(row.clerk_user_id),
    leadCount: Number(row.lead_count),
  };
}

export async function getAppReviewDemoStatus(): Promise<DemoStatus> {
  const result = await pool.query<DemoStatusRow>(
    `SELECT b.id, b.business_name, b.owner_email, b.clerk_user_id,
            b.is_sample, b.is_internal, count(l.id)::int AS lead_count
     FROM businesses b
     LEFT JOIN leads l ON l.business_id = b.id
     WHERE b.business_name = $1
     GROUP BY b.id`,
    [APP_REVIEW_DEMO_NAME],
  );
  if (result.rows.length > 1) {
    throw new AppReviewDemoError(
      `Multiple businesses use the name "${APP_REVIEW_DEMO_NAME}". No record was changed.`,
    );
  }
  const row = result.rows[0];
  return row ? statusFromRow(row) : {
    exists: false,
    businessId: null,
    businessName: null,
    ownerEmail: null,
    linked: false,
    leadCount: 0,
  };
}

function ensureSampleBusinessIsSafe(business: DemoBusinessRow): void {
  if (!business.is_sample || business.is_internal) {
    throw new AppReviewDemoError(
      `A non-sample business already uses the name "${APP_REVIEW_DEMO_NAME}". It was not changed.`,
    );
  }
  if (
    business.retell_phone_number
    || business.retell_agent_id
    || business.chosen_plan
    || business.manual_payment_state
    || business.first_invoice_paid_at
  ) {
    throw new AppReviewDemoError(
      "This sample has phone, billing, or provisioning data. It was left unchanged for manual review.",
    );
  }
}

async function ensureNoLiveRecords(client: PoolClient, businessId: number): Promise<void> {
  const activity = await client.query<{
      has_calls: boolean;
      has_provisioning_attempt: boolean;
      has_notifications: boolean;
      has_billing_account: boolean;
      has_billing_event: boolean;
      has_billing_notice: boolean;
      has_invoice: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM retell_call_records WHERE business_id = $1) AS has_calls,
         EXISTS (SELECT 1 FROM provisioning_attempts WHERE business_id = $1) AS has_provisioning_attempt,
         EXISTS (SELECT 1 FROM notification_events WHERE business_id = $1::text) AS has_notifications,
         EXISTS (SELECT 1 FROM billing_accounts WHERE business_id = $1) AS has_billing_account,
         EXISTS (SELECT 1 FROM billing_events WHERE business_id = $1) AS has_billing_event,
         EXISTS (SELECT 1 FROM billing_notices WHERE business_id = $1) AS has_billing_notice,
         EXISTS (SELECT 1 FROM manual_invoices WHERE business_id = $1) AS has_invoice`,
      [businessId],
    );
  const leads = await client.query<{ retell_call_id: string | null }>(
    `SELECT retell_call_id
     FROM leads
     WHERE business_id = $1
     FOR UPDATE`,
    [businessId],
  );
  const records = activity.rows[0];
  const hasExternalActivity = Boolean(records && Object.values(records).some(Boolean));
  const hasNonDemoLead = leads.rows.some(
    (lead) => !lead.retell_call_id?.startsWith(SEED_CALL_ID_PREFIX),
  );
  if (hasExternalActivity || hasNonDemoLead) {
    throw new AppReviewDemoError(
      "This sample contains call, billing, provisioning, notification, or non-demo lead data. It was left unchanged for manual review.",
    );
  }
}

function leadTimes(now: Date, lead: SeedLead) {
  const createdAt = new Date(now.getTime() - lead.minutesAgo * 60_000);
  const contactedAt = lead.minutesUntilContacted === null
    ? null
    : new Date(createdAt.getTime() + lead.minutesUntilContacted * 60_000);
  return { createdAt, contactedAt };
}

export async function resetAppReviewDemo(): Promise<DemoStatus> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1, hashtext($2))",
      [DEMO_LOCK_NAMESPACE, APP_REVIEW_DEMO_NAME],
    );

    const matches = await client.query<DemoBusinessRow>(
      `SELECT id, business_name, owner_email, clerk_user_id, is_sample, is_internal,
              retell_phone_number, retell_agent_id, chosen_plan, manual_payment_state,
              first_invoice_paid_at
       FROM businesses
       WHERE business_name = $1
       FOR UPDATE`,
      [APP_REVIEW_DEMO_NAME],
    );
    if (matches.rows.length > 1) {
      throw new AppReviewDemoError(
        `Multiple businesses use the name "${APP_REVIEW_DEMO_NAME}". No record was changed.`,
      );
    }

    let business: DemoBusinessRow | undefined = matches.rows[0];
    if (business) {
      ensureSampleBusinessIsSafe(business);
      await ensureNoLiveRecords(client, business.id);
      const updated = await client.query<DemoBusinessRow>(
        `UPDATE businesses
         SET business_name = $2,
             business_hours = 'Mon-Fri 08:00-18:00',
             time_zone = 'America/New_York',
             agent_name = 'Aria',
             owner_email = CASE WHEN clerk_user_id IS NULL THEN NULL ELSE owner_email END,
             chosen_plan = NULL,
             is_internal = false,
             billing_mode = 'manual',
             startup_age_months = NULL,
             manual_payment_state = NULL,
             first_invoice_paid_at = NULL,
             owner_phone = NULL,
             lead_alerts_enabled = false,
             retell_phone_number = NULL,
             retell_agent_id = NULL,
             is_sample = true,
             provisioning_state = 'sample',
             service_area = 'Example City and surrounding neighborhoods',
             business_type = 'Plumbing and HVAC',
             services_offered = 'Sample plumbing repairs, HVAC troubleshooting, leak checks, and fixture repairs. Demo data only.',
             major_issue_examples = 'Water leaks, drain backups, water-heater issues, AC cooling failures, and fixture repairs. Demo data only.',
             personality_tone_description = 'Friendly and professional',
             services_not_offered = 'No emergency dispatch or real appointments are offered in this demo.',
             other_policies = NULL,
             pricing_policy = NULL,
             financing_policy = NULL,
             brands_worked_with = NULL,
             typical_response_time_commitment = 'Sample response-time details only.',
             warranty_info = NULL,
             maintenance_plan_offerings = NULL,
             credentials_certifications = NULL,
             owner_availability = 'Sample availability only.',
             emergency_contact_info = NULL,
             business_website_url = NULL,
             website_enrichment_attempted_at = NULL,
             website_enrichment_sources = '{}'::jsonb,
             updated_at = now()
         WHERE id = $1
         RETURNING id, business_name, owner_email, clerk_user_id, is_sample, is_internal,
                   retell_phone_number, retell_agent_id, chosen_plan, manual_payment_state,
                   first_invoice_paid_at`,
        [business.id, APP_REVIEW_DEMO_NAME],
      );
      business = updated.rows[0];
    } else {
      const inserted = await client.query<DemoBusinessRow>(
        `INSERT INTO businesses
           (business_name, business_hours, time_zone, agent_name, is_internal, billing_mode,
            lead_alerts_enabled, retell_phone_number, retell_agent_id, is_sample,
            provisioning_state, service_area, business_type, services_offered,
            major_issue_examples, personality_tone_description, services_not_offered,
            typical_response_time_commitment, owner_availability)
         VALUES
           ($1, 'Mon-Fri 08:00-18:00', 'America/New_York', 'Aria', false, 'manual',
            false, NULL, NULL, true, 'sample', 'Example City and surrounding neighborhoods',
             'Plumbing and HVAC',
             'Sample plumbing repairs, HVAC troubleshooting, leak checks, and fixture repairs. Demo data only.',
             'Water leaks, drain backups, water-heater issues, AC cooling failures, and fixture repairs. Demo data only.',
            'Friendly and professional',
            'No emergency dispatch or real appointments are offered in this demo.',
            'Sample response-time details only.', 'Sample availability only.')
         RETURNING id, business_name, owner_email, clerk_user_id, is_sample, is_internal,
                   retell_phone_number, retell_agent_id, chosen_plan, manual_payment_state,
                   first_invoice_paid_at`,
        [APP_REVIEW_DEMO_NAME],
      );
      business = inserted.rows[0];
    }

    if (!business) throw new Error("App Review demo business write returned no record");

    await client.query(
      "DELETE FROM leads WHERE business_id = $1 AND retell_call_id LIKE $2",
      [business.id, `${SEED_CALL_ID_PREFIX}%`],
    );

    const now = new Date();
    for (const [index, lead] of seedLeads.entries()) {
      const { createdAt, contactedAt } = leadTimes(now, lead);
      const details = `Fictional App Review demo lead. ${lead.callerName} called about: ${lead.issueReason}`;
      await client.query(
        `INSERT INTO leads
           (business_id, caller_name, retell_call_id, phone_number, caller_id,
            callback_number, transcript, summary, issue_reason, address, urgency_level,
            availability, status, contacted_at, contacted_by, created_at)
         VALUES ($1, $2, $3, $4, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          business.id,
          lead.callerName,
          `${SEED_CALL_ID_PREFIX}${String(index + 1).padStart(3, "0")}`,
          lead.phoneNumber,
          `Caller: ${lead.callerName}. ${lead.issueReason}\nRequested availability: ${lead.availability}\nThis is fictional App Review demo content.`,
          details,
          lead.issueReason,
          lead.address,
          lead.urgencyLevel,
          lead.availability,
          lead.status,
          contactedAt,
          contactedAt ? "App Review Demo" : null,
          createdAt,
        ],
      );
    }

    await client.query("COMMIT");
    return {
      exists: true,
      businessId: business.id,
      businessName: APP_REVIEW_DEMO_NAME,
      ownerEmail: business.owner_email,
      linked: Boolean(business.clerk_user_id),
      leadCount: seedLeads.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type ClerkEmailAddress = {
  emailAddress: string;
  verification: { status: string } | null;
};

export async function linkAppReviewDemoEmail(email: string): Promise<DemoStatus> {
  const normalizedEmail = email.trim().toLowerCase();
  const users = (await clerkClient.users.getUserList({
    emailAddress: [normalizedEmail],
    limit: 100,
  })).data;
  const matchedUsers = users.filter((user) => (
    user.emailAddresses.some((address: ClerkEmailAddress) =>
      address.verification?.status === "verified"
      && address.emailAddress.trim().toLowerCase() === normalizedEmail)
  ));
  if (matchedUsers.length !== 1) {
    throw new AppReviewDemoError(
      "No unique Clerk account with this verified email was found. Create and sign in to the demo account first.",
      404,
    );
  }
  const user = matchedUsers[0]!;
  const verifiedEmail = user.emailAddresses.find((address: ClerkEmailAddress) =>
    address.verification?.status === "verified"
    && address.emailAddress.trim().toLowerCase() === normalizedEmail)!.emailAddress.trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1, hashtext($2))",
      [DEMO_LOCK_NAMESPACE, APP_REVIEW_DEMO_NAME],
    );
    const matches = await client.query<DemoBusinessRow>(
      `SELECT id, business_name, owner_email, clerk_user_id, is_sample, is_internal,
              retell_phone_number, retell_agent_id, chosen_plan, manual_payment_state,
              first_invoice_paid_at
       FROM businesses
       WHERE business_name = $1
       FOR UPDATE`,
      [APP_REVIEW_DEMO_NAME],
    );
    if (matches.rows.length !== 1) {
      throw new AppReviewDemoError(
        "Create the App Review Demo business before linking an account.",
        404,
      );
    }
    const business = matches.rows[0]!;
    ensureSampleBusinessIsSafe(business);
    await ensureNoLiveRecords(client, business.id);
    if (business.clerk_user_id && business.clerk_user_id !== user.id) {
      throw new AppReviewDemoError(
        "App Review Demo is already linked to another account. Its ownership was not changed.",
      );
    }
    const otherOwner = await client.query<{ id: number; business_name: string }>(
      `SELECT id, business_name
       FROM businesses
       WHERE clerk_user_id = $1 AND id <> $2
       LIMIT 1`,
      [user.id, business.id],
    );
    if (otherOwner.rows.length) {
      throw new AppReviewDemoError(
        "This account already owns another business. Its ownership was not changed.",
      );
    }

    await client.query(
      `UPDATE businesses
       SET clerk_user_id = $2, owner_email = $3, updated_at = now()
       WHERE id = $1 AND is_sample = true AND is_internal = false`,
      [business.id, user.id, verifiedEmail],
    );
    const leadCount = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM leads WHERE business_id = $1",
      [business.id],
    );
    await client.query("COMMIT");
    return {
      exists: true,
      businessId: business.id,
      businessName: APP_REVIEW_DEMO_NAME,
      ownerEmail: verifiedEmail,
      linked: true,
      leadCount: Number(leadCount.rows[0]?.count ?? 0),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

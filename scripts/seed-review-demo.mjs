import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const REVIEW_DEMO_BUSINESS_NAME = "App Review Demo";
export const REVIEW_DEMO_MARKER = "app-review-demo-seed:v1";
const BUSINESS_MARKER_KEY = "_appReviewDemoSeed";
const CALL_ID_PREFIX = "corvlio-review-demo-cli:";

export class ReviewDemoSeedError extends Error {}

export function parseArgs(args) {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
  let clerkUserId;
  let remove = false;
  let allowProduction = false;

  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index];
    if (arg === "--clerk-user-id") {
      if (
        clerkUserId !== undefined
        || !forwardedArgs[index + 1]
        || forwardedArgs[index + 1].startsWith("--")
      ) {
        throw new ReviewDemoSeedError("A valid --clerk-user-id=<id> is required.");
      }
      clerkUserId = forwardedArgs[index + 1];
      index += 1;
    } else if (arg.startsWith("--clerk-user-id=")) {
      if (clerkUserId !== undefined) {
        throw new ReviewDemoSeedError("Supply --clerk-user-id only once.");
      }
      clerkUserId = arg.slice("--clerk-user-id=".length);
    } else if (arg === "--remove") {
      if (remove) throw new ReviewDemoSeedError("Supply --remove only once.");
      remove = true;
    } else if (arg === "--allow-production") {
      if (allowProduction) throw new ReviewDemoSeedError("Supply --allow-production only once.");
      allowProduction = true;
    } else if (arg === "--help") {
      return { help: true, clerkUserId: null, remove: false, allowProduction: false };
    } else {
      throw new ReviewDemoSeedError("Unrecognized option. Use --help for usage.");
    }
  }

  if (typeof clerkUserId !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(clerkUserId)) {
    throw new ReviewDemoSeedError("A valid --clerk-user-id=<id> is required.");
  }
  return { help: false, clerkUserId, remove, allowProduction };
}

function isSet(value) {
  return typeof value === "string" && value.length > 0 && value !== "0" && value !== "false";
}

export function assertRunTarget(options, env = process.env) {
  const productionRuntime = env.NODE_ENV === "production"
    || env.REPLIT_ENVIRONMENT?.toLowerCase() === "production"
    || isSet(env.REPLIT_DEPLOYMENT);

  if (productionRuntime && !options.allowProduction) {
    throw new ReviewDemoSeedError(
      "Refusing to run in Production unless --allow-production is passed. No database was opened.",
    );
  }
  if (productionRuntime) {
    return "production";
  }

  if (!isSet(env.REPLIT_DEV_DOMAIN)) {
    throw new ReviewDemoSeedError(
      "Refusing to seed outside Replit Development. No database was opened.",
    );
  }
  return "development";
}

export function reviewDemoLeads(now = new Date()) {
  const samples = [
    {
      name: "Maya Bennett",
      phone: "+12395550101",
      urgency: "emergency",
      status: "pending",
      minutesAgo: 18,
      issue: "Water is leaking beneath the kitchen sink and spreading across the cabinet floor.",
      address: "101 Example Cypress Lane, Example City, FL",
      availability: "Home now; the under-sink shutoff is closed.",
      summary: "Fictional call summary: The caller described a kitchen-sink leak and requested an urgent callback. No real call was placed.",
    },
    {
      name: "Leo Morgan",
      phone: "+12395550102",
      urgency: "urgent",
      status: "contacted",
      minutesAgo: 55,
      contactedMinutesAfter: 11,
      issue: "The air conditioner is running but the home is not cooling.",
      address: "202 Sample Heron Way, Example City, FL",
      availability: "Available this afternoon.",
      summary: "Fictional call summary: The caller reported an AC cooling problem; the demo owner called back and discussed a visit window. No real call was placed.",
    },
    {
      name: "Zoe Kim",
      phone: "+12395550103",
      urgency: "normal",
      status: "pending",
      minutesAgo: 130,
      issue: "The water heater has inconsistent hot water.",
      address: "303 Demo Mangrove Drive, Example City, FL",
      availability: "Weekdays after 3 PM.",
      summary: null,
    },
    {
      name: "Noah Rivera",
      phone: "+12395550104",
      urgency: "normal",
      status: "pending",
      minutesAgo: 245,
      issue: "A bathroom faucet drips overnight; there is no active water damage.",
      address: "404 Example Egret Court, Example City, FL",
      availability: "Tomorrow morning works best.",
      summary: null,
    },
    {
      name: "Ava Brooks",
      phone: "+12395550105",
      urgency: "urgent",
      status: "contacted",
      minutesAgo: 350,
      contactedMinutesAfter: 17,
      issue: "The AC condensate drain is backing up into the drain pan.",
      address: "505 Sample Palm Street, Example City, FL",
      availability: "Someone is at the property now.",
      summary: "Fictional call summary: The caller described a backed-up condensate drain; a demo callback reviewed next steps. No real call was placed.",
    },
    {
      name: "Eli Patel",
      phone: "+12395550106",
      urgency: "normal",
      status: "pending",
      minutesAgo: 500,
      issue: "A slow tub drain is affecting one bathroom.",
      address: "606 Demo Shell Avenue, Example City, FL",
      availability: "Today after 1 PM.",
      summary: null,
    },
    {
      name: "Ivy Chen",
      phone: "+12395550107",
      urgency: "low",
      status: "pending",
      minutesAgo: 720,
      issue: "The garbage disposal hums but does not turn.",
      address: "707 Example Palmetto Road, Example City, FL",
      availability: "Flexible this week.",
      summary: null,
    },
    {
      name: "Theo James",
      phone: "+12395550108",
      urgency: "low",
      status: "contacted",
      minutesAgo: 1440,
      contactedMinutesAfter: 23,
      issue: "There is a small drip at an outdoor hose connection.",
      address: "808 Sample Magnolia Place, Example City, FL",
      availability: "Any weekday is fine.",
      summary: null,
    },
  ];

  return samples.map((lead) => {
    const createdAt = new Date(now.getTime() - lead.minutesAgo * 60_000);
    const contactedAt = lead.contactedMinutesAfter === undefined
      ? null
      : new Date(createdAt.getTime() + lead.contactedMinutesAfter * 60_000);
    return { ...lead, createdAt, contactedAt };
  });
}

function markerMatches(value) {
  let sources = value;
  if (typeof sources === "string") {
    try {
      sources = JSON.parse(sources);
    } catch {
      return false;
    }
  }
  return sources !== null
    && typeof sources === "object"
    && sources[BUSINESS_MARKER_KEY] === REVIEW_DEMO_MARKER;
}

function assertOwnedDemoBusiness(business, clerkUserId) {
  if (
    business.business_name !== REVIEW_DEMO_BUSINESS_NAME
    || business.clerk_user_id !== clerkUserId
    || business.is_sample !== true
    || business.is_internal !== false
    || business.billing_mode !== "manual"
    || business.chosen_plan !== null
    || business.manual_payment_state !== null
    || business.first_invoice_paid_at !== null
    || business.retell_phone_number !== null
    || business.retell_agent_id !== null
    || business.lead_alerts_enabled !== false
    || business.provisioning_state !== "sample"
    || !markerMatches(business.website_enrichment_sources)
  ) {
    throw new ReviewDemoSeedError(
      "A conflicting or modified business uses this name or Clerk ID. Nothing was changed.",
    );
  }
}

function callIdFor(businessId, index) {
  return `${CALL_ID_PREFIX}${businessId}:${String(index + 1).padStart(3, "0")}`;
}

function expectedCallIds(businessId) {
  return reviewDemoLeads().map((_lead, index) => callIdFor(businessId, index));
}

async function lockDemo(client, clerkUserId) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${REVIEW_DEMO_MARKER}:business-name`],
  );
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${REVIEW_DEMO_MARKER}:${clerkUserId}`],
  );
}

async function findConflictingBusiness(client, clerkUserId) {
  const { rows } = await client.query(
    `SELECT id, business_name, clerk_user_id, is_sample, is_internal, billing_mode,
            chosen_plan, manual_payment_state, first_invoice_paid_at, retell_phone_number,
            retell_agent_id, lead_alerts_enabled, provisioning_state, website_enrichment_sources
     FROM businesses
     WHERE business_name = $1 OR clerk_user_id = $2
     FOR UPDATE`,
    [REVIEW_DEMO_BUSINESS_NAME, clerkUserId],
  );
  if (rows.length > 1) {
    throw new ReviewDemoSeedError(
      "Multiple businesses match this demo name or Clerk ID. Nothing was changed.",
    );
  }
  return rows[0] ?? null;
}

async function assertNoRelatedBusinessActivity(client, businessId) {
  const tables = await client.query(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'business_id'
       AND table_name NOT IN ('businesses', 'leads')
       AND table_name IN (
         SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       )
     ORDER BY table_name`,
  );
  for (const { table_name: tableName } of tables.rows) {
    const quotedTable = `"${String(tableName).replaceAll('"', '""')}"`;
    const activity = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM public.${quotedTable} WHERE business_id::text = $1
       ) AS found`,
      [String(businessId)],
    );
    if (activity.rows[0]?.found) {
      throw new ReviewDemoSeedError(
        "The demo business has related activity records. Nothing was changed.",
      );
    }
  }

  const deletion = await client.query(
    "SELECT EXISTS (SELECT 1 FROM account_deletions WHERE $1 = ANY(business_ids)) AS found",
    [businessId],
  );
  if (deletion.rows[0]?.found) {
    throw new ReviewDemoSeedError(
      "The demo business has an account-deletion record. Nothing was changed.",
    );
  }
}

async function getTaggedLeads(client, businessId) {
  const { rows } = await client.query(
    "SELECT id, retell_call_id FROM leads WHERE business_id = $1 FOR UPDATE",
    [businessId],
  );
  const expectedIds = expectedCallIds(businessId);
  const expectedSet = new Set(expectedIds);
  const presentIds = new Set();
  for (const lead of rows) {
    if (!expectedSet.has(lead.retell_call_id) || presentIds.has(lead.retell_call_id)) {
      throw new ReviewDemoSeedError(
        "The demo business contains an unrecognized lead. Nothing was changed.",
      );
    }
    presentIds.add(lead.retell_call_id);
  }

  const collisions = await client.query(
    "SELECT business_id, retell_call_id FROM leads WHERE retell_call_id = ANY($1::text[]) FOR UPDATE",
    [expectedIds],
  );
  if (collisions.rows.some((lead) => Number(lead.business_id) !== Number(businessId))) {
    throw new ReviewDemoSeedError(
      "A demo lead identifier is already used by another business. Nothing was changed.",
    );
  }
  return { expectedIds, presentIds };
}

async function insertMissingLeads(client, businessId, expectedIds, presentIds, now) {
  const leads = reviewDemoLeads(now);
  let createdCount = 0;
  for (const [index, lead] of leads.entries()) {
    const retellCallId = expectedIds[index];
    if (presentIds.has(retellCallId)) continue;

    await client.query(
      `INSERT INTO leads
         (business_id, caller_name, retell_call_id, phone_number, callback_number,
          issue_reason, address, urgency_level, availability, status,
          contacted_at, contacted_by, summary, created_at)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        businessId,
        lead.name,
        retellCallId,
        lead.phone,
        lead.issue,
        lead.address,
        lead.urgency,
        lead.availability,
        lead.status,
        lead.contactedAt,
        lead.contactedAt ? REVIEW_DEMO_BUSINESS_NAME : null,
        lead.summary,
        lead.createdAt,
      ],
    );
    createdCount += 1;
  }
  return createdCount;
}

export async function seedReviewDemo(client, clerkUserId, now = new Date()) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await lockDemo(client, clerkUserId);
    let business = await findConflictingBusiness(client, clerkUserId);
    let createdBusiness = false;

    if (business) {
      assertOwnedDemoBusiness(business, clerkUserId);
    } else {
      const marker = JSON.stringify({ [BUSINESS_MARKER_KEY]: REVIEW_DEMO_MARKER });
      const inserted = await client.query(
        `INSERT INTO businesses
           (business_name, business_hours, time_zone, agent_name, clerk_user_id,
            is_internal, billing_mode, chosen_plan, manual_payment_state,
            first_invoice_paid_at, owner_phone, sms_alerts_consent,
            lead_alerts_enabled, retell_phone_number, retell_agent_id,
            is_sample, provisioning_state, service_area, business_type,
            services_offered, major_issue_examples, services_not_offered,
            managed_reports_enabled, website_enrichment_sources)
         VALUES
           ($1, 'Mon-Fri 08:00-18:00', 'America/New_York', 'Aria', $2,
            false, 'manual', NULL, NULL, NULL, NULL, false,
            false, NULL, NULL, true, 'sample', 'Example City, Florida',
            'Home services', 'Fictional plumbing and HVAC demo leads only.',
            'Leaks, cooling issues, drains, and water heaters. Demo data only.',
            'No appointments or emergency dispatch are offered by this demo.',
            false, $3::jsonb)
         RETURNING id, business_name, clerk_user_id, is_sample, is_internal,
                   billing_mode, chosen_plan, manual_payment_state, first_invoice_paid_at,
                   retell_phone_number, retell_agent_id, lead_alerts_enabled,
                   provisioning_state, website_enrichment_sources`,
        [REVIEW_DEMO_BUSINESS_NAME, clerkUserId, marker],
      );
      business = inserted.rows[0];
      if (!business) throw new ReviewDemoSeedError("The demo business insert returned no row.");
      createdBusiness = true;
      assertOwnedDemoBusiness(business, clerkUserId);
    }

    await assertNoRelatedBusinessActivity(client, business.id);
    const { expectedIds, presentIds } = await getTaggedLeads(client, business.id);
    const createdLeads = await insertMissingLeads(
      client,
      business.id,
      expectedIds,
      presentIds,
      now,
    );

    await client.query("COMMIT");
    return {
      businessId: Number(business.id),
      createdBusiness,
      createdLeads,
      totalLeads: expectedIds.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function removeReviewDemo(client, clerkUserId) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await lockDemo(client, clerkUserId);
    const business = await findConflictingBusiness(client, clerkUserId);
    if (!business) {
      await client.query("COMMIT");
      return { removed: false, businessId: null, removedLeads: 0 };
    }
    assertOwnedDemoBusiness(business, clerkUserId);
    await assertNoRelatedBusinessActivity(client, business.id);
    const { expectedIds, presentIds } = await getTaggedLeads(client, business.id);
    const leadsToRemove = expectedIds.filter((id) => presentIds.has(id));

    const deletedLeads = await client.query(
      "DELETE FROM leads WHERE business_id = $1 AND retell_call_id = ANY($2::text[])",
      [business.id, leadsToRemove],
    );
    const deletedBusiness = await client.query(
      `DELETE FROM businesses
       WHERE id = $1 AND business_name = $2 AND clerk_user_id = $3
         AND is_sample = true AND is_internal = false
         AND website_enrichment_sources ->> $4 = $5
       RETURNING id`,
      [business.id, REVIEW_DEMO_BUSINESS_NAME, clerkUserId, BUSINESS_MARKER_KEY, REVIEW_DEMO_MARKER],
    );
    if (deletedBusiness.rowCount !== 1) {
      throw new ReviewDemoSeedError(
        "The marked demo business changed during removal. Nothing was committed.",
      );
    }

    await client.query("COMMIT");
    return {
      removed: true,
      businessId: Number(business.id),
      removedLeads: deletedLeads.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args);
  if (options.help) {
    console.log("Usage: pnpm run seed:review-demo -- --clerk-user-id=<id> [--remove] [--allow-production]");
    return;
  }
  const target = assertRunTarget(options, env);
  if (!env.DATABASE_URL) {
    throw new ReviewDemoSeedError("DATABASE_URL is missing. No database was opened.");
  }

  const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
  const { Client } = requireDb("pg");
  const client = new Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    if (options.remove) {
      const result = await removeReviewDemo(client, options.clerkUserId);
      if (!result.removed) {
        console.log(`No script-created ${REVIEW_DEMO_BUSINESS_NAME} was found in ${target}; nothing was removed.`);
      } else {
        console.log(
          `Removed ${REVIEW_DEMO_BUSINESS_NAME} business #${result.businessId} and ${result.removedLeads} tagged fictional leads from ${target}.`,
        );
      }
    } else {
      const result = await seedReviewDemo(client, options.clerkUserId);
      const action = result.createdBusiness ? "Created" : "Kept";
      console.log(
        `${action} ${REVIEW_DEMO_BUSINESS_NAME} business #${result.businessId}; added ${result.createdLeads} fictional leads (${result.totalLeads} total) in ${target}. No alerts, messages, calls, email, billing, or Stripe objects were triggered.`,
      );
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code
      : null;
    console.error(
      code
        ? `Review demo database operation failed (${code}); the transaction was rolled back.`
        : error instanceof ReviewDemoSeedError
          ? error.message
          : "Review demo seed failed; the transaction was rolled back. Provider details and database credentials are not logged.",
    );
    process.exitCode = 1;
  });
}

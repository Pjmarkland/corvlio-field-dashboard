import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const TARGET_EMAIL = "pjmarkland08+appreview@gmail.com";
export const DEMO_BUSINESS_NAME = "App Review Demo";
export const SEED_MARKER = "corvlio-app-review-owner-demo:v1";
export const LEAD_CALL_ID_PREFIX = "corvlio-app-review-owner-demo-v1:";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));

export class AppReviewOwnerSeedError extends Error {}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isSet(value) {
  return typeof value === "string"
    && value.length > 0
    && value !== "0"
    && value.toLowerCase() !== "false";
}

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === "production"
    || env.REPLIT_ENVIRONMENT?.toLowerCase() === "production"
    || isSet(env.REPLIT_DEPLOYMENT);
}

export function assertApplyRuntime(env = process.env) {
  if (!isProductionRuntime(env)) {
    throw new AppReviewOwnerSeedError(
      "Apply mode requires a Production runtime; no database was opened.",
    );
  }
}

export function parseArgs(args) {
  let apply = false;
  let allowProduction = false;
  let explicitDryRun = false;
  let confirmEmail = "";
  let confirmBusiness = "";
  let help = false;

  for (const arg of args[0] === "--" ? args.slice(1) : args) {
    if (arg === "--apply") {
      if (apply) throw new AppReviewOwnerSeedError("Supply --apply only once.");
      apply = true;
    } else if (arg === "--allow-production") {
      if (allowProduction) {
        throw new AppReviewOwnerSeedError("Supply --allow-production only once.");
      }
      allowProduction = true;
    } else if (arg.startsWith("--confirm-email=")) {
      if (confirmEmail) {
        throw new AppReviewOwnerSeedError("Supply --confirm-email only once.");
      }
      confirmEmail = arg.slice("--confirm-email=".length);
    } else if (arg.startsWith("--confirm-business=")) {
      if (confirmBusiness) {
        throw new AppReviewOwnerSeedError("Supply --confirm-business only once.");
      }
      confirmBusiness = arg.slice("--confirm-business=".length);
    } else if (arg === "--help") {
      help = true;
    } else if (arg === "--dry-run") {
      explicitDryRun = true;
    } else {
      throw new AppReviewOwnerSeedError("Unrecognized option. Use --help for usage.");
    }
  }

  if (apply) {
    if (explicitDryRun) {
      throw new AppReviewOwnerSeedError("Do not combine --apply with --dry-run.");
    }
    if (!allowProduction) {
      throw new AppReviewOwnerSeedError(
        "Apply mode requires --allow-production and a Production runtime.",
      );
    }
    if (normalizeEmail(confirmEmail) !== TARGET_EMAIL) {
      throw new AppReviewOwnerSeedError(
        `Apply mode requires --confirm-email=${TARGET_EMAIL}.`,
      );
    }
    if (confirmBusiness !== DEMO_BUSINESS_NAME) {
      throw new AppReviewOwnerSeedError(
        `Apply mode requires --confirm-business="${DEMO_BUSINESS_NAME}".`,
      );
    }
  }

  return { apply, allowProduction, confirmEmail, confirmBusiness, help };
}

function exactMatchingUserId(user) {
  const addresses = Array.isArray(user?.email_addresses)
    ? user.email_addresses
    : [];
  const matches = addresses.some((address) =>
    normalizeEmail(address?.email_address) === TARGET_EMAIL);
  return matches && typeof user?.id === "string" && /^user_[A-Za-z0-9_-]+$/.test(user.id)
    ? user.id
    : null;
}

export async function findClerkUserIdByExactEmail(
  secretKey,
  fetchImpl = globalThis.fetch,
) {
  if (!secretKey) {
    throw new AppReviewOwnerSeedError("CLERK_SECRET_KEY is missing; no database was opened.");
  }
  const url = new URL(CLERK_USERS_URL);
  url.searchParams.append("email_address[]", TARGET_EMAIL);
  url.searchParams.set("limit", "100");

  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new AppReviewOwnerSeedError(
      "The exact Clerk account lookup failed; no database was opened.",
    );
  }
  if (!response.ok) {
    throw new AppReviewOwnerSeedError(
      `The exact Clerk account lookup failed (HTTP ${response.status}); no database was opened.`,
    );
  }

  let users;
  try {
    users = await response.json();
  } catch {
    throw new AppReviewOwnerSeedError(
      "The Clerk account lookup returned invalid data; no database was opened.",
    );
  }
  if (!Array.isArray(users)) {
    throw new AppReviewOwnerSeedError(
      "The Clerk account lookup returned invalid data; no database was opened.",
    );
  }

  const exactMatches = users.map(exactMatchingUserId).filter(Boolean);
  if (exactMatches.length !== 1) {
    throw new AppReviewOwnerSeedError(
      `Expected exactly one Clerk user for ${TARGET_EMAIL}; found ${exactMatches.length}. No database was opened.`,
    );
  }
  return exactMatches[0];
}

export function makeDemoLeads(now = new Date()) {
  const samples = [
    {
      callerName: "Morgan Ellis",
      phoneNumber: "+12025550100",
      issueReason: "The water heater is leaking from the lower access panel.",
      address: "742 Example Maple Avenue, Example City, FL",
      urgencyLevel: "urgent",
      availability: "Home this afternoon; call before arriving.",
      status: "new",
      minutesAgo: 24,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller reported a water-heater leak and requested a callback.",
    },
    {
      callerName: "Riley Carter",
      phoneNumber: "+12025550101",
      issueReason: "The AC runs continuously but the home is not cooling.",
      address: "18 Example Harbor Lane, Example City, FL",
      urgencyLevel: "urgent",
      availability: "Available after 2 PM.",
      status: "called_back",
      minutesAgo: 78,
      contactedMinutesAgo: 31,
      summary: "Fictional sample: owner returned the call and discussed an afternoon visit window.",
    },
    {
      callerName: "Jamie Brooks",
      phoneNumber: "+12025550102",
      issueReason: "The kitchen drain is slow and backs up during use.",
      address: "905 Example Pine Street, Example City, FL",
      urgencyLevel: "normal",
      availability: "Tomorrow morning.",
      status: "booked",
      minutesAgo: 156,
      contactedMinutesAgo: 92,
      summary: "Fictional sample: demo status marked booked; no real appointment was made.",
    },
    {
      callerName: "Avery Scott",
      phoneNumber: "+12025550103",
      issueReason: "The furnace needs its seasonal inspection and filter change.",
      address: "120 Example Spruce Way, Example City, FL",
      urgencyLevel: "low",
      availability: "Flexible next week.",
      status: "new",
      minutesAgo: 284,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller requested a routine furnace tune-up.",
    },
    {
      callerName: "Casey Nguyen",
      phoneNumber: "+12025550104",
      issueReason: "Water drips near a roof vent after heavy rain.",
      address: "44 Example Cedar Court, Example City, FL",
      urgencyLevel: "urgent",
      availability: "Someone can meet the estimator Friday.",
      status: "new",
      minutesAgo: 392,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller requested a roof-leak inspection and estimate.",
    },
    {
      callerName: "Jordan Patel",
      phoneNumber: "+12025550105",
      issueReason: "They missed a callback and asked the office to try again.",
      address: "62 Example Birch Road, Example City, FL",
      urgencyLevel: "normal",
      availability: "Call between noon and 3 PM.",
      status: "called_back",
      minutesAgo: 515,
      contactedMinutesAgo: 202,
      summary: "Fictional sample: missed-call follow-up was returned; no call was placed.",
    },
    {
      callerName: "Taylor Reed",
      phoneNumber: "+12025550106",
      issueReason: "The disposal hums but the blades do not turn.",
      address: "311 Example Willow Drive, Example City, FL",
      urgencyLevel: "normal",
      availability: "Weekdays after 1 PM.",
      status: "closed",
      minutesAgo: 695,
      contactedMinutesAgo: 604,
      summary: "Fictional sample: demo lead marked closed after a callback.",
    },
    {
      callerName: "Quinn Foster",
      phoneNumber: "+12025550107",
      issueReason: "A bathroom faucet drips when fully turned off.",
      address: "7 Example Magnolia Place, Example City, FL",
      urgencyLevel: "low",
      availability: "Any weekday morning.",
      status: "new",
      minutesAgo: 904,
      contactedMinutesAgo: null,
      summary: "Fictional sample: caller requested a faucet repair callback.",
    },
    {
      callerName: "Sam Rivera",
      phoneNumber: "+12025550108",
      issueReason: "The AC needs a seasonal tune-up before summer.",
      address: "526 Example Cypress Lane, Example City, FL",
      urgencyLevel: "normal",
      availability: "Available Thursday afternoon.",
      status: "booked",
      minutesAgo: 1210,
      contactedMinutesAgo: 1124,
      summary: "Fictional sample: demo status marked booked; no real appointment was made.",
    },
  ];

  return samples.map((lead, index) => {
    const createdAt = new Date(now.getTime() - lead.minutesAgo * 60_000);
    const contactedAt = lead.contactedMinutesAgo === null
      ? null
      : new Date(now.getTime() - lead.contactedMinutesAgo * 60_000);
    return {
      ...lead,
      retellCallId: `${LEAD_CALL_ID_PREFIX}${String(index + 1).padStart(3, "0")}`,
      summary: `${SEED_MARKER} | ${lead.summary}`,
      callerId: lead.phoneNumber,
      callbackNumber: lead.phoneNumber,
      contactedAt,
      contactedBy: contactedAt ? DEMO_BUSINESS_NAME : null,
      createdAt,
    };
  });
}

function assertTargetBusiness(business) {
  if (
    business.business_name !== DEMO_BUSINESS_NAME
    || normalizeEmail(business.owner_email) !== TARGET_EMAIL
    || business.is_internal !== false
  ) {
    throw new AppReviewOwnerSeedError(
      `The account must own one non-internal business named "${DEMO_BUSINESS_NAME}" with the exact reviewer email. Nothing was changed.`,
    );
  }
}

function isExpectedSeedLead(lead, expectedIds) {
  return expectedIds.has(lead.retell_call_id)
    && typeof lead.summary === "string"
    && lead.summary.includes(SEED_MARKER);
}

export async function seedAppReviewOwnerLeads(
  client,
  clerkUserId,
  { dryRun = true, now = new Date() } = {},
) {
  const leads = makeDemoLeads(now);
  const expectedIds = new Set(leads.map((lead) => lead.retellCallId));
  const lock = !dryRun;

  await client.query(
    dryRun ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY" : "BEGIN ISOLATION LEVEL SERIALIZABLE",
  );
  try {
    if (lock) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [`${SEED_MARKER}:${clerkUserId}`],
      );
    }

    const businesses = await client.query(
      `SELECT id, business_name, clerk_user_id, owner_email, is_internal
       FROM businesses
       WHERE clerk_user_id = $1
       ${lock ? "FOR UPDATE" : ""}`,
      [clerkUserId],
    );
    if (businesses.rows.length !== 1) {
      throw new AppReviewOwnerSeedError(
        `Expected exactly one business owned by the exact Clerk user; found ${businesses.rows.length}. Nothing was changed.`,
      );
    }
    const business = businesses.rows[0];
    assertTargetBusiness(business);

    const existing = await client.query(
      `SELECT id, business_id, retell_call_id, summary
       FROM leads
       WHERE business_id = $1
       ${lock ? "FOR UPDATE" : ""}`,
      [business.id],
    );
    const foreignOrRealLeads = existing.rows.filter(
      (lead) => !isExpectedSeedLead(lead, expectedIds),
    );
    if (foreignOrRealLeads.length > 0) {
      throw new AppReviewOwnerSeedError(
        `The demo business contains ${foreignOrRealLeads.length} untagged or unrelated lead(s). Nothing was changed.`,
      );
    }

    const collisions = await client.query(
      `SELECT id, business_id, retell_call_id
       FROM leads
       WHERE retell_call_id = ANY($1::text[])
       ${lock ? "FOR UPDATE" : ""}`,
      [Array.from(expectedIds)],
    );
    if (collisions.rows.some((lead) => Number(lead.business_id) !== Number(business.id))) {
      throw new AppReviewOwnerSeedError(
        "A demo lead marker already belongs to another business. Nothing was changed.",
      );
    }

    const presentIds = new Set(existing.rows.map((lead) => lead.retell_call_id));
    const missing = leads.filter((lead) => !presentIds.has(lead.retellCallId));
    if (dryRun) {
      await client.query("ROLLBACK");
      return {
        dryRun: true,
        businessId: Number(business.id),
        leadCount: leads.length,
        leadsToInsert: missing.length,
      };
    }

    for (const lead of missing) {
      await client.query(
        `INSERT INTO leads
           (business_id, caller_name, retell_call_id, phone_number, caller_id,
            callback_number, issue_reason, address, urgency_level, availability,
            status, contacted_at, contacted_by, summary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          business.id,
          lead.callerName,
          lead.retellCallId,
          lead.phoneNumber,
          lead.callerId,
          lead.callbackNumber,
          lead.issueReason,
          lead.address,
          lead.urgencyLevel,
          lead.availability,
          lead.status,
          lead.contactedAt,
          lead.contactedBy,
          lead.summary,
          lead.createdAt,
        ],
      );
    }

    await client.query("COMMIT");
    return {
      dryRun: false,
      businessId: Number(business.id),
      leadCount: leads.length,
      leadsInserted: missing.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function main(
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      `Dry run: pnpm run seed:app-review-owner\nApply (Production only): pnpm run seed:app-review-owner -- --apply --allow-production --confirm-email="${TARGET_EMAIL}" --confirm-business="${DEMO_BUSINESS_NAME}"`,
    );
    return;
  }
  if (options.apply) assertApplyRuntime(env);
  if (!env.DATABASE_URL) {
    throw new AppReviewOwnerSeedError("DATABASE_URL is missing; no database was opened.");
  }

  const clerkUserId = await findClerkUserIdByExactEmail(env.CLERK_SECRET_KEY, fetchImpl);
  const { Client } = requireDb("pg");
  const client = new Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    const result = await seedAppReviewOwnerLeads(client, clerkUserId, {
      dryRun: !options.apply,
    });
    const outcome = options.apply
      ? `Inserted ${result.leadsInserted} fictional lead(s)`
      : `Dry run: would insert ${result.leadsToInsert} fictional lead(s)`;
    console.log(
      `${outcome} for ${TARGET_EMAIL} in "${DEMO_BUSINESS_NAME}" (business #${result.businessId}); no other records were changed.`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof AppReviewOwnerSeedError
        ? error.message
        : "App Review owner seed failed; the transaction was rolled back. Credentials and provider details are not logged.",
    );
    process.exitCode = 1;
  });
}

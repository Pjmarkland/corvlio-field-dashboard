import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const REVIEW_DEMO_BUSINESS_NAME = "App Review Demo";
export const REVIEW_DEMO_MARKER = "app-review-demo-seed:v1";
export const SEPARATE_REVIEW_DEMO_BUSINESS_NAME = "Corvlio Reviewer Demo";
export const SEPARATE_REVIEW_DEMO_MARKER = "corvlio-reviewer-demo:v1";
const BUSINESS_MARKER_KEY = "_appReviewDemoSeed";
const CALL_ID_PREFIX = "corvlio-review-demo-cli:";
const SEPARATE_BUSINESS_MARKER_KEY = "_corvlioReviewerDemo";
const SEPARATE_CALL_ID_PREFIX = "corvlio-reviewer-demo:";

export class ReviewDemoSeedError extends Error {}

export function parseArgs(args) {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
  let clerkUserId;
  let remove = false;
  let allowProduction = false;
  let reconcileExisting = false;
  let dryRun = false;
  let createSeparate = false;
  let businessName = SEPARATE_REVIEW_DEMO_BUSINESS_NAME;
  let businessNameProvided = false;

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
    } else if (arg === "--reconcile-existing") {
      if (reconcileExisting) throw new ReviewDemoSeedError("Supply --reconcile-existing only once.");
      reconcileExisting = true;
    } else if (arg === "--dry-run") {
      if (dryRun) throw new ReviewDemoSeedError("Supply --dry-run only once.");
      dryRun = true;
    } else if (arg === "--create-separate") {
      if (createSeparate) throw new ReviewDemoSeedError("Supply --create-separate only once.");
      createSeparate = true;
    } else if (arg === "--business-name") {
      if (
        businessNameProvided
        || !forwardedArgs[index + 1]
        || forwardedArgs[index + 1].startsWith("--")
      ) {
        throw new ReviewDemoSeedError("Supply one non-empty --business-name.");
      }
      businessName = forwardedArgs[index + 1];
      businessNameProvided = true;
      index += 1;
    } else if (arg.startsWith("--business-name=")) {
      if (businessNameProvided) {
        throw new ReviewDemoSeedError("Supply --business-name only once.");
      }
      businessName = arg.slice("--business-name=".length);
      businessNameProvided = true;
    } else if (arg === "--help") {
      return {
        help: true,
        clerkUserId: null,
        remove: false,
        allowProduction: false,
        reconcileExisting: false,
        dryRun: false,
        createSeparate: false,
        businessName: SEPARATE_REVIEW_DEMO_BUSINESS_NAME,
      };
    } else {
      throw new ReviewDemoSeedError("Unrecognized option. Use --help for usage.");
    }
  }

  if (typeof clerkUserId !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(clerkUserId)) {
    throw new ReviewDemoSeedError("A valid --clerk-user-id=<id> is required.");
  }
  if (remove && reconcileExisting) {
    throw new ReviewDemoSeedError("--remove and --reconcile-existing cannot be used together.");
  }
  if (createSeparate && (remove || reconcileExisting)) {
    throw new ReviewDemoSeedError("--create-separate cannot be combined with --remove or --reconcile-existing.");
  }
  if (businessNameProvided && !createSeparate) {
    throw new ReviewDemoSeedError("--business-name requires --create-separate.");
  }
  if (createSeparate) {
    const normalizedName = typeof businessName === "string" ? businessName.trim() : "";
    if (!normalizedName || normalizedName.length > 120) {
      throw new ReviewDemoSeedError("--business-name must contain 1 to 120 characters.");
    }
    if (normalizedName.toLowerCase() === REVIEW_DEMO_BUSINESS_NAME.toLowerCase()) {
      throw new ReviewDemoSeedError("--create-separate requires a name different from App Review Demo.");
    }
    businessName = normalizedName;
  }
  return {
    help: false,
    clerkUserId,
    remove,
    allowProduction,
    reconcileExisting,
    dryRun,
    createSeparate,
    businessName,
  };
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
  const sources = parseWebsiteSources(value);
  return sources !== null && sources[BUSINESS_MARKER_KEY] === REVIEW_DEMO_MARKER;
}

function parseWebsiteSources(value) {
  let sources = value;
  if (typeof sources === "string") {
    try {
      sources = JSON.parse(sources);
    } catch {
      return null;
    }
  }
  return sources !== null && typeof sources === "object" && !Array.isArray(sources)
    ? sources
    : null;
}

export const SAFE_DEMO_BUSINESS_PROFILE = Object.freeze({
  business_hours: "Mon-Fri 08:00-18:00",
  time_zone: "America/New_York",
  agent_name: "Aria",
  owner_email: null,
  chosen_plan: null,
  is_internal: false,
  billing_mode: "manual",
  startup_age_months: null,
  manual_payment_state: null,
  first_invoice_paid_at: null,
  account_status: "active",
  account_status_reason: null,
  account_status_updated_at: null,
  never_auto_suspend: false,
  billing_enforcement_suspended_at: null,
  billing_enforcement_invoice_source: null,
  billing_enforcement_invoice_id: null,
  forwarding_test_requested_at: null,
  owner_phone: null,
  sms_alerts_consent: false,
  sms_alerts_consent_at: null,
  lead_alerts_enabled: false,
  retell_phone_number: null,
  fallback_phone_number: null,
  retell_phone_normalized: null,
  retell_agent_id: null,
  is_sample: true,
  provisioning_state: "sample",
  service_area: "Example City, Florida",
  business_type: "Home services",
  services_offered: "Fictional plumbing and HVAC demo leads only.",
  major_issue_examples: "Leaks, cooling issues, drains, and water heaters. Demo data only.",
  personality_tone_description: null,
  services_not_offered: "No appointments or emergency dispatch are offered by this demo.",
  other_policies: null,
  pricing_policy: null,
  financing_policy: null,
  brands_worked_with: null,
  typical_response_time_commitment: null,
  warranty_info: null,
  maintenance_plan_offerings: null,
  credentials_certifications: null,
  owner_availability: null,
  emergency_contact_info: null,
  emergency_available: null,
  emergency_escalation_phone: null,
  ai_promise_policy: null,
  managed_reports_enabled: false,
  business_website_url: null,
  website_enrichment_attempted_at: null,
  agreements_accepted_at: null,
  agreements_accepted_version: null,
});

function inspectBusinessProfile(business, { allowMissingSeedMarker = false } = {}) {
  const findings = [];
  if (business.business_name !== REVIEW_DEMO_BUSINESS_NAME) findings.push("business_name");

  for (const [field, expected] of Object.entries(SAFE_DEMO_BUSINESS_PROFILE)) {
    if (business[field] !== expected) findings.push(field);
  }

  const sources = parseWebsiteSources(business.website_enrichment_sources);
  if (!sources) {
    findings.push("website_enrichment_sources");
  } else {
    const marker = sources[BUSINESS_MARKER_KEY];
    const otherSourceKeys = Object.keys(sources).filter((key) => key !== BUSINESS_MARKER_KEY);
    if (otherSourceKeys.length > 0) findings.push("website_enrichment_sources");
    if (marker !== REVIEW_DEMO_MARKER && !(allowMissingSeedMarker && marker === undefined)) {
      findings.push(`website_enrichment_sources.${BUSINESS_MARKER_KEY}`);
    }
  }

  return [...new Set(findings)];
}

function assertOwnedDemoBusiness(business, clerkUserId) {
  const profileFindings = inspectBusinessProfile(business);
  if (business.clerk_user_id !== clerkUserId || profileFindings.length > 0) {
    throw new ReviewDemoSeedError(
      "The existing business is not an unchanged, marked review demo. Nothing was changed.",
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

async function findConflictingBusinesses(client, clerkUserId, { forUpdate = true } = {}) {
  const { rows } = await client.query(
    `SELECT *
     FROM businesses
     WHERE business_name = $1 OR clerk_user_id = $2
     ORDER BY id${forUpdate ? " FOR UPDATE" : ""}`,
    [REVIEW_DEMO_BUSINESS_NAME, clerkUserId],
  );
  return rows;
}

async function getRelatedActivity(client, business, targetClerkUserId, callIds) {
  const businessIds = [String(business.id), business.clerk_user_id, targetClerkUserId]
    .filter((value) => typeof value === "string" && value.length > 0);
  const requiredTables = ["account_deletions", "provisioning_attempts", "retell_webhook_events"];
  const availableTables = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const availableTableNames = new Set(availableTables.rows.map(({ table_name }) => table_name));
  const scanErrors = requiredTables
    .filter((tableName) => !availableTableNames.has(tableName))
    .map((tableName) => `required safety scan table missing: ${tableName}`);
  const tables = await client.query(
    `SELECT c.table_name
     FROM information_schema.columns AS c
     JOIN information_schema.tables AS t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.column_name = 'business_id'
       AND c.table_name NOT IN ('businesses', 'leads')
     ORDER BY c.table_name`,
  );
  const businessActivity = {};
  for (const { table_name: tableName } of tables.rows) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
      throw new ReviewDemoSeedError("Could not safely inspect a related activity table.");
    }
    const activity = await client.query(
      `SELECT count(*)::int AS count
       FROM public."${tableName}"
       WHERE business_id::text = ANY($1::text[])`,
      [businessIds],
    );
    const count = Number(activity.rows[0]?.count ?? 0);
    if (count > 0) businessActivity[tableName] = count;
  }

  const namedTables = await client.query(
    `SELECT c.table_name
     FROM information_schema.columns AS c
     JOIN information_schema.tables AS t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.column_name = 'business_name'
       AND c.table_name <> 'businesses'
     ORDER BY c.table_name`,
  );
  const businessNameActivity = {};
  for (const { table_name: tableName } of namedTables.rows) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
      throw new ReviewDemoSeedError("Could not safely inspect a related business-name table.");
    }
    const activity = await client.query(
      `SELECT count(*)::int AS count
       FROM public."${tableName}"
       WHERE business_name = $1`,
      [REVIEW_DEMO_BUSINESS_NAME],
    );
    const count = Number(activity.rows[0]?.count ?? 0);
    if (count > 0) businessNameActivity[tableName] = count;
  }

  let provisioningCount = 0;
  if (availableTableNames.has("provisioning_attempts")) {
    const provisioning = await client.query(
      "SELECT count(*)::int AS count FROM provisioning_attempts WHERE clerk_user_id = ANY($1::text[])",
      [businessIds.filter((value) => value !== String(business.id))],
    );
    provisioningCount = Number(provisioning.rows[0]?.count ?? 0);
  }

  let deletionCount = 0;
  if (availableTableNames.has("account_deletions")) {
    const deletion = await client.query(
      `SELECT count(*)::int AS count
       FROM account_deletions
       WHERE clerk_user_id = ANY($1::text[]) OR $2 = ANY(business_ids)`,
      [businessIds.filter((value) => value !== String(business.id)), Number(business.id)],
    );
    deletionCount = Number(deletion.rows[0]?.count ?? 0);
  }

  let webhookCount = 0;
  if (callIds.length > 0 && availableTableNames.has("retell_webhook_events")) {
    const webhooks = await client.query(
      "SELECT count(*)::int AS count FROM retell_webhook_events WHERE call_id = ANY($1::text[])",
      [callIds],
    );
    webhookCount = Number(webhooks.rows[0]?.count ?? 0);
  }

  return { businessActivity, businessNameActivity, provisioningCount, deletionCount, webhookCount, scanErrors };
}

function inspectDemoLeads(leads, businessId, now = new Date()) {
  const expectedLeads = reviewDemoLeads(now);
  const expectedByCallId = new Map(
    expectedLeads.map((lead, index) => [callIdFor(businessId, index), lead]),
  );
  const expectedIds = [...expectedByCallId.keys()];
  const presentIds = new Set();
  const findings = [];
  let unsafeLeadCount = 0;
  const contentFields = [
    ["caller_name", "name"],
    ["phone_number", "phone"],
    ["callback_number", "phone"],
    ["issue_reason", "issue"],
    ["address", "address"],
    ["urgency_level", "urgency"],
    ["availability", "availability"],
    ["status", "status"],
    ["summary", "summary"],
  ];
  const emptyFields = [
    "caller_id",
    "spam_caller_number",
    "transcript",
    "sentiment",
    "recording_url",
    "media_retention_completed_at",
    "personal_data_retention_completed_at",
    "private_notes",
    "trade_intake_answers",
  ];

  for (const lead of leads) {
    const expected = expectedByCallId.get(lead.retell_call_id);
    if (!expected || presentIds.has(lead.retell_call_id)) {
      findings.push("unrecognized or duplicate lead");
      unsafeLeadCount += 1;
      continue;
    }
    presentIds.add(lead.retell_call_id);
    const findingsBeforeLead = findings.length;
    const index = expectedIds.indexOf(lead.retell_call_id);
    const expectedValues = { ...expected, retellCallId: lead.retell_call_id };
    for (const [dbField, sourceField] of contentFields) {
      if (lead[dbField] !== expectedValues[sourceField]) {
        findings.push(`lead ${index + 1}: ${dbField}`);
      }
    }
    if (lead.retell_call_id !== callIdFor(businessId, index)) {
      findings.push(`lead ${index + 1}: retell_call_id`);
    }
    if (lead.is_spam !== false) findings.push(`lead ${index + 1}: is_spam`);
    for (const field of emptyFields) {
      if (lead[field] != null) findings.push(`lead ${index + 1}: ${field}`);
    }
    if ((lead.contacted_at != null) !== (expected.contactedAt != null)) {
      findings.push(`lead ${index + 1}: contacted_at`);
    }
    const expectedContactedBy = expected.contactedAt ? REVIEW_DEMO_BUSINESS_NAME : null;
    if (lead.contacted_by !== expectedContactedBy) {
      findings.push(`lead ${index + 1}: contacted_by`);
    }
    if (findings.length > findingsBeforeLead) unsafeLeadCount += 1;
  }

  return {
    expectedIds,
    presentIds,
    findings: [...new Set(findings)],
    unsafeLeadCount,
  };
}

async function getTaggedLeads(client, businessId, { forUpdate = true, now = new Date() } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM leads WHERE business_id = $1 ORDER BY id${forUpdate ? " FOR UPDATE" : ""}`,
    [businessId],
  );
  const inspection = inspectDemoLeads(rows, businessId, now);

  const collisions = await client.query(
    `SELECT business_id, retell_call_id
     FROM leads
     WHERE retell_call_id = ANY($1::text[])${forUpdate ? " FOR UPDATE" : ""}`,
    [inspection.expectedIds],
  );
  if (collisions.rows.some((lead) => Number(lead.business_id) !== Number(businessId))) {
    inspection.findings.push("demo lead identifier belongs to another business");
  }
  return { ...inspection, leads: rows };
}

function summarizeBusiness(business) {
  return {
    id: Number(business.id),
    name: business.business_name,
    is_sample: business.is_sample,
    owner_clerk_id: business.clerk_user_id,
  };
}

function summarizeInspection(business, leads, leadInspection, profileFindings, activity) {
  const activityRows = activity.businessActivity;
  const businessNameActivity = activity.businessNameActivity;
  const billingRows = Object.fromEntries(
    [...Object.entries(activityRows), ...Object.entries(businessNameActivity)]
      .filter(([table]) => /billing|stripe|invoice/i.test(table)),
  );
  const callAndMessageRows = Object.fromEntries(
    [...Object.entries(activityRows), ...Object.entries(businessNameActivity)]
      .filter(([table]) => /call|sms|notification|email|message|retell|web_push/i.test(table)),
  );
  const findings = [
    ...profileFindings.map((field) => `business profile differs from the fictional seed baseline: ${field}`),
    ...leadInspection.findings,
    ...Object.entries(activityRows).map(([table, count]) => `${table}: ${count} linked record(s)`),
    ...Object.entries(businessNameActivity).map(([table, count]) => `${table}: ${count} record(s) with the demo business name`),
  ];
  if (activity.provisioningCount > 0) {
    findings.push(`provisioning_attempts: ${activity.provisioningCount} related record(s)`);
  }
  if (activity.deletionCount > 0) {
    findings.push(`account_deletions: ${activity.deletionCount} related record(s)`);
  }
  if (activity.webhookCount > 0) {
    findings.push(`retell_webhook_events: ${activity.webhookCount} related record(s)`);
  }
  findings.push(...activity.scanErrors);
  return {
    business: summarizeBusiness(business),
    lead_count: leads.length,
    tagged_demo_lead_count: leadInspection.presentIds.size,
    unrecognized_or_modified_lead_count: leadInspection.unsafeLeadCount,
    real_looking_business_fields: profileFindings,
    related_activity_rows: activityRows,
    same_name_activity_rows: businessNameActivity,
    billing_or_stripe_rows: billingRows,
    calls_or_messages_rows: callAndMessageRows,
    provisioning_attempts: activity.provisioningCount,
    account_deletion_rows: activity.deletionCount,
    retell_webhook_rows: activity.webhookCount,
    safety_scan_errors: activity.scanErrors,
    safety_findings: findings,
  };
}

function assertSafeInspection(inspection) {
  if (inspection.safety_findings.length > 0) {
    throw new ReviewDemoSeedError(
      `Safety checks found existing customer data or related activity: ${inspection.safety_findings.join("; ")}. Nothing was changed.`,
    );
  }
}

function emitReport(onReport, report) {
  onReport(JSON.stringify(report, null, 2));
}

async function inspectBusiness(client, business, targetClerkUserId, {
  forUpdate = true,
  now = new Date(),
  allowMissingSeedMarker = false,
} = {}) {
  const profileFindings = inspectBusinessProfile(business, { allowMissingSeedMarker });
  const leads = await getTaggedLeads(client, business.id, { forUpdate, now });
  const activity = await getRelatedActivity(
    client,
    business,
    targetClerkUserId,
    leads.expectedIds,
  );
  return {
    leads,
    activity,
    summary: summarizeInspection(
      business,
      leads.leads,
      leads,
      profileFindings,
      activity,
    ),
  };
}

function makeSeedPlan(business, targetClerkUserId, leadInspection, {
  reconcileExisting = false,
} = {}) {
  const leadsToAdd = leadInspection.expectedIds
    .filter((callId) => !leadInspection.presentIds.has(callId));
  if (!business) {
    return {
      operation: "create review demo business and fictional leads",
      business: {
        name: REVIEW_DEMO_BUSINESS_NAME,
        owner_clerk_id: targetClerkUserId,
        is_sample: true,
        seed_marker: REVIEW_DEMO_MARKER,
      },
      fictional_leads_to_insert: 8,
      generated_lead_ids: "Assigned after the new business receives its database ID.",
    };
  }
  const sourceMap = parseWebsiteSources(business.website_enrichment_sources) ?? {};
  return {
    operation: reconcileExisting ? "reconcile existing review demo and add missing fictional leads" : "add missing fictional leads",
    business_id: Number(business.id),
    clerk_user_id: {
      from: business.clerk_user_id,
      to: targetClerkUserId,
      update: business.clerk_user_id !== targetClerkUserId,
    },
    seed_marker: {
      key: BUSINESS_MARKER_KEY,
      value: REVIEW_DEMO_MARKER,
      add: sourceMap[BUSINESS_MARKER_KEY] !== REVIEW_DEMO_MARKER,
    },
    fictional_lead_ids_to_insert: leadsToAdd,
    fictional_leads_to_insert: leadsToAdd.length,
    business_name_change: false,
    business_delete: false,
  };
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

/**
 * Insert-only reviewer demo path. It never selects a business by name for reuse
 * and never updates or deletes any existing business or lead.
 */
export async function createSeparateReviewDemo(client, clerkUserId, {
  businessName = SEPARATE_REVIEW_DEMO_BUSINESS_NAME,
  now = new Date(),
  dryRun = false,
  onReport = console.log,
} = {}) {
  const name = typeof businessName === "string" ? businessName.trim() : "";
  if (!name || name.length > 120) {
    throw new ReviewDemoSeedError("The separate demo business name must contain 1 to 120 characters.");
  }
  if (name.toLowerCase() === REVIEW_DEMO_BUSINESS_NAME.toLowerCase()) {
    throw new ReviewDemoSeedError("The separate demo business must not use the existing App Review Demo name.");
  }
  if (typeof clerkUserId !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(clerkUserId)) {
    throw new ReviewDemoSeedError("A valid existing Clerk user ID is required.");
  }

  await client.query(
    dryRun
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
      : "BEGIN ISOLATION LEVEL SERIALIZABLE",
  );
  try {
    if (!dryRun) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${SEPARATE_REVIEW_DEMO_MARKER}:${clerkUserId}`],
      );
    }

    // This is deliberately the first data check. Any existing business for
    // this identity, sample or otherwise, makes this create-only operation stop.
    const owned = await client.query(
      `SELECT id
       FROM businesses
       WHERE clerk_user_id = $1
       LIMIT 1${dryRun ? "" : " FOR UPDATE"}`,
      [clerkUserId],
    );
    if (owned.rows.length > 0) {
      throw new ReviewDemoSeedError(
        "The demo Clerk user already owns a business. No business or lead was changed.",
      );
    }

    const leads = reviewDemoLeads(now);
    const marker = JSON.stringify({ [SEPARATE_BUSINESS_MARKER_KEY]: SEPARATE_REVIEW_DEMO_MARKER });
    if (dryRun) {
      emitReport(onReport, {
        dry_run: true,
        business: {
          name,
          owner_clerk_id: clerkUserId,
          is_sample: true,
          marker: SEPARATE_REVIEW_DEMO_MARKER,
        },
        plan: [
          "Insert one new fictional sample business; no existing business is selected or reused.",
          `Insert ${leads.length} fictional leads linked to the new business.`,
        ],
        result: "No database changes made.",
      });
      await client.query("ROLLBACK");
      return {
        dryRun: true,
        businessId: null,
        createdBusiness: true,
        createdLeads: leads.length,
        totalLeads: leads.length,
      };
    }

    const inserted = await client.query(
      `INSERT INTO businesses
         (business_name, business_hours, time_zone, agent_name, clerk_user_id, owner_email,
          is_internal, billing_mode, chosen_plan, manual_payment_state, first_invoice_paid_at,
          owner_phone, sms_alerts_consent, lead_alerts_enabled, retell_phone_number,
          retell_agent_id, is_sample, provisioning_state, service_area, business_type,
          services_offered, major_issue_examples, services_not_offered, managed_reports_enabled,
          website_enrichment_sources)
       VALUES
         ($1, 'Mon-Fri 08:00-18:00', 'America/New_York', 'Aria', $2, NULL,
          false, 'manual', NULL, NULL, NULL, NULL, false, false, NULL, NULL,
          true, 'sample', 'Example City, Florida', 'Home services',
          'Fictional plumbing and HVAC reviewer demo only.',
          'Leaks, cooling issues, drains, and water heaters. Fictional demo data only.',
          'No appointments or emergency dispatch are offered by this demo.',
          false, $3::jsonb)
       RETURNING id`,
      [name, clerkUserId, marker],
    );
    const businessId = Number(inserted.rows[0]?.id);
    if (!Number.isSafeInteger(businessId) || businessId <= 0) {
      throw new ReviewDemoSeedError("The separate demo business insert returned no valid ID.");
    }

    for (const [index, lead] of leads.entries()) {
      const callId = `${SEPARATE_CALL_ID_PREFIX}${businessId}:${String(index + 1).padStart(3, "0")}`;
      await client.query(
        `INSERT INTO leads
           (business_id, caller_name, retell_call_id, phone_number, callback_number,
            issue_reason, address, urgency_level, availability, status,
            contacted_at, contacted_by, summary, created_at)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          businessId,
          lead.name,
          callId,
          lead.phone,
          lead.issue,
          lead.address,
          lead.urgency,
          lead.availability,
          lead.status,
          lead.contactedAt,
          lead.contactedAt ? name : null,
          lead.summary ?? "Fictional reviewer demo lead. No real call was placed.",
          lead.createdAt,
        ],
      );
    }

    await client.query("COMMIT");
    return {
      dryRun: false,
      businessId,
      createdBusiness: true,
      createdLeads: leads.length,
      totalLeads: leads.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function seedReviewDemo(client, clerkUserId, {
  now = new Date(),
  reconcileExisting = false,
  dryRun = false,
  onReport = console.log,
} = {}) {
  await client.query(
    dryRun
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
      : "BEGIN ISOLATION LEVEL SERIALIZABLE",
  );
  try {
    if (!dryRun) await lockDemo(client, clerkUserId);
    const candidates = await findConflictingBusinesses(client, clerkUserId, { forUpdate: !dryRun });
    if (candidates.length > 1) {
      emitReport(onReport, {
        dry_run: dryRun,
        matching_businesses: candidates.map(summarizeBusiness),
        plan: "ABORT: more than one business matches the demo name or target Clerk ID.",
        changes: [],
      });
      throw new ReviewDemoSeedError(
        "Multiple businesses match this demo name or Clerk ID. Nothing was changed.",
      );
    }
    let business = candidates[0] ?? null;
    if (reconcileExisting && (!business || business.business_name !== REVIEW_DEMO_BUSINESS_NAME)) {
      emitReport(onReport, {
        dry_run: dryRun,
        matching_businesses: candidates.map(summarizeBusiness),
        plan: "ABORT: --reconcile-existing requires exactly one existing business with the exact demo name.",
        changes: [],
      });
      throw new ReviewDemoSeedError(
        "--reconcile-existing requires exactly one existing business named App Review Demo. Nothing was changed.",
      );
    }

    if (!business && dryRun) {
      emitReport(onReport, {
        dry_run: true,
        business: null,
        plan: makeSeedPlan(null, clerkUserId, null),
        changes: [
          `Create one sample business named ${REVIEW_DEMO_BUSINESS_NAME} for ${clerkUserId}.`,
          "Insert eight fictional leads after the new business receives an ID.",
        ],
        result: "No database changes made.",
      });
      await client.query("ROLLBACK");
      return { dryRun: true, createdBusiness: true, createdLeads: 8, businessId: null, totalLeads: 8 };
    }

    let createdBusiness = false;
    if (!business) {
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
         RETURNING *`,
        [REVIEW_DEMO_BUSINESS_NAME, clerkUserId, marker],
      );
      business = inserted.rows[0];
      if (!business) throw new ReviewDemoSeedError("The demo business insert returned no row.");
      createdBusiness = true;
    }

    const inspection = await inspectBusiness(client, business, clerkUserId, {
      forUpdate: !dryRun,
      now,
      allowMissingSeedMarker: reconcileExisting && !createdBusiness,
    });
    const summary = inspection.summary;
    if (!reconcileExisting && business.clerk_user_id !== clerkUserId) {
      summary.safety_findings.push("business is linked to a different Clerk ID");
    }

    const plan = makeSeedPlan(
      business,
      clerkUserId,
      inspection.leads,
      { reconcileExisting: reconcileExisting && !createdBusiness },
    );
    const changes = createdBusiness
      ? [
          `Create sample business #${business.id} named ${REVIEW_DEMO_BUSINESS_NAME}.`,
          `Set its Clerk owner to ${clerkUserId} and add the ${REVIEW_DEMO_MARKER} marker.`,
          `Insert ${plan.fictional_leads_to_insert} fictional leads.`,
        ]
      : [
          ...(reconcileExisting && business.clerk_user_id !== clerkUserId
            ? [`Update only businesses.clerk_user_id on row ${business.id} from ${business.clerk_user_id} to ${clerkUserId}.`]
            : []),
          ...(reconcileExisting && plan.seed_marker.add
            ? [`Add website_enrichment_sources marker ${BUSINESS_MARKER_KEY}=${REVIEW_DEMO_MARKER} on row ${business.id}.`]
            : []),
          ...(plan.fictional_leads_to_insert > 0
            ? [`Insert ${plan.fictional_leads_to_insert} missing fictional lead(s): ${plan.fictional_lead_ids_to_insert.join(", ")}.`]
            : []),
        ];
    emitReport(onReport, {
      dry_run: dryRun,
      inspection: summary,
      plan: summary.safety_findings.length === 0 ? plan : "ABORT: safety checks failed; no changes will be made.",
      changes: summary.safety_findings.length === 0 ? changes : [],
      result: dryRun ? "No database changes made." : "Pending safety validation.",
    });
    assertSafeInspection(summary);

    if (!createdBusiness && !reconcileExisting) {
      assertOwnedDemoBusiness(business, clerkUserId);
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      return {
        dryRun: true,
        businessId: Number(business.id),
        createdBusiness: false,
        createdLeads: inspection.leads.expectedIds.length - inspection.leads.presentIds.size,
        totalLeads: inspection.leads.expectedIds.length,
      };
    }

    if (reconcileExisting && (
      business.clerk_user_id !== clerkUserId
      || !markerMatches(business.website_enrichment_sources)
    )) {
      const updated = await client.query(
        `UPDATE businesses
         SET clerk_user_id = $2,
             website_enrichment_sources = COALESCE(website_enrichment_sources, '{}'::jsonb)
               || jsonb_build_object($3::text, $4::text)
         WHERE id = $1
           AND business_name = $5
           AND is_sample IS TRUE
           AND clerk_user_id IS NOT DISTINCT FROM $6
         RETURNING id`,
        [
          business.id,
          clerkUserId,
          BUSINESS_MARKER_KEY,
          REVIEW_DEMO_MARKER,
          REVIEW_DEMO_BUSINESS_NAME,
          business.clerk_user_id,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new ReviewDemoSeedError("The review demo changed during reconciliation. Nothing was committed.");
      }
    }

    const createdLeads = await insertMissingLeads(
      client,
      business.id,
      inspection.leads.expectedIds,
      inspection.leads.presentIds,
      now,
    );
    await client.query("COMMIT");
    return {
      dryRun: false,
      businessId: Number(business.id),
      createdBusiness,
      reconciledExisting: reconcileExisting && !createdBusiness,
      createdLeads,
      totalLeads: inspection.leads.expectedIds.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function removeReviewDemo(client, clerkUserId, {
  dryRun = false,
  onReport = console.log,
} = {}) {
  await client.query(
    dryRun
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
      : "BEGIN ISOLATION LEVEL SERIALIZABLE",
  );
  try {
    if (!dryRun) await lockDemo(client, clerkUserId);
    const candidates = await findConflictingBusinesses(client, clerkUserId, { forUpdate: !dryRun });
    if (candidates.length > 1) {
      emitReport(onReport, {
        dry_run: dryRun,
        matching_businesses: candidates.map(summarizeBusiness),
        plan: "ABORT: more than one business matches the demo name or target Clerk ID.",
        changes: [],
      });
      throw new ReviewDemoSeedError(
        "Multiple businesses match this demo name or Clerk ID. Nothing was changed.",
      );
    }
    const business = candidates[0] ?? null;
    if (!business) {
      emitReport(onReport, {
        dry_run: dryRun,
        business: null,
        plan: "No marked review demo matches this Clerk ID.",
        changes: [],
        result: "No database changes made.",
      });
      await client.query(dryRun ? "ROLLBACK" : "COMMIT");
      return { dryRun, removed: false, businessId: null, removedLeads: 0 };
    }

    const inspection = await inspectBusiness(client, business, clerkUserId, { forUpdate: !dryRun });
    if (business.clerk_user_id !== clerkUserId) {
      inspection.summary.safety_findings.push("business is linked to a different Clerk ID");
    }
    const leadsToRemove = inspection.leads.expectedIds
      .filter((id) => inspection.leads.presentIds.has(id));
    const changes = [
      `Delete ${leadsToRemove.length} unchanged, tagged fictional lead(s) from business #${business.id}.`,
      `Delete sample business #${business.id} named ${REVIEW_DEMO_BUSINESS_NAME}.`,
    ];
    emitReport(onReport, {
      dry_run: dryRun,
      inspection: inspection.summary,
      plan: inspection.summary.safety_findings.length === 0
        ? { operation: "remove marked review demo", business_id: Number(business.id), lead_ids_to_delete: leadsToRemove }
        : "ABORT: safety checks failed; no changes will be made.",
      changes: inspection.summary.safety_findings.length === 0 ? changes : [],
      result: dryRun ? "No database changes made." : "Pending safety validation.",
    });
    assertSafeInspection(inspection.summary);
    assertOwnedDemoBusiness(business, clerkUserId);

    if (dryRun) {
      await client.query("ROLLBACK");
      return {
        dryRun: true,
        removed: true,
        businessId: Number(business.id),
        removedLeads: leadsToRemove.length,
      };
    }

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
      dryRun: false,
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
    console.log("Usage: pnpm run seed:review-demo -- --clerk-user-id=<id> [--reconcile-existing] [--dry-run] [--remove] [--allow-production]\n       pnpm run seed:review-demo -- --create-separate --business-name=\"Corvlio Reviewer Demo\" --clerk-user-id=<id> [--dry-run] [--allow-production]");
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
    const result = options.createSeparate
      ? await createSeparateReviewDemo(client, options.clerkUserId, {
          businessName: options.businessName,
          dryRun: options.dryRun,
        })
      : options.remove
        ? await removeReviewDemo(client, options.clerkUserId, { dryRun: options.dryRun })
        : await seedReviewDemo(client, options.clerkUserId, {
          reconcileExisting: options.reconcileExisting,
          dryRun: options.dryRun,
        });
    if (options.dryRun) {
      console.log(`Dry run completed against ${target}; no database changes were made.`);
    } else if (options.createSeparate) {
      console.log(
        `Created separate fictional ${options.businessName} business #${result.businessId} with ${result.createdLeads} leads in ${target}. No calls, messages, email, billing, Stripe, or phone provisioning were triggered.`,
      );
    } else if (options.remove) {
      if (!result.removed) {
        console.log(`No script-created ${REVIEW_DEMO_BUSINESS_NAME} was found in ${target}; nothing was removed.`);
      } else {
        console.log(
          `Removed ${REVIEW_DEMO_BUSINESS_NAME} business #${result.businessId} and ${result.removedLeads} tagged fictional leads from ${target}.`,
        );
      }
    } else {
      const action = result.reconciledExisting
        ? "Reconciled existing"
        : result.createdBusiness
          ? "Created"
          : "Kept";
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

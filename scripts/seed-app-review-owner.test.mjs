import assert from "node:assert/strict";
import test from "node:test";
import {
  AppReviewOwnerSeedError,
  assertApplyRuntime,
  DEMO_BUSINESS_NAME,
  findClerkUserIdByExactEmail,
  isProductionRuntime,
  LEAD_CALL_ID_PREFIX,
  makeDemoLeads,
  parseArgs,
  SEED_MARKER,
  seedAppReviewOwnerLeads,
  TARGET_EMAIL,
} from "./seed-app-review-owner.mjs";

const TARGET_USER_ID = "user_app_review_owner";
const FIXED_NOW = new Date("2026-11-12T12:00:00.000Z");

function makeBusiness(overrides = {}) {
  return {
    id: 7301,
    business_name: DEMO_BUSINESS_NAME,
    clerk_user_id: TARGET_USER_ID,
    owner_email: TARGET_EMAIL,
    is_internal: false,
    ...overrides,
  };
}

class FakeClient {
  constructor({ businesses = [makeBusiness()], leads = [] } = {}) {
    this.businesses = businesses;
    this.leads = leads.map((lead, index) => ({ id: index + 1, ...lead }));
    this.statements = [];
    this.inserts = [];
    this.nextId = this.leads.length + 1;
  }

  async query(sql, params = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    const normalized = statement.toLowerCase();
    this.statements.push(statement);

    if (/^(begin|commit|rollback)\b/i.test(statement) || normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select id, business_name, clerk_user_id, owner_email, is_internal from businesses")) {
      const rows = this.businesses.filter((business) => business.clerk_user_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select id, business_id, retell_call_id, summary from leads where business_id")) {
      const rows = this.leads.filter((lead) => Number(lead.business_id) === Number(params[0]));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select id, business_id, retell_call_id from leads where retell_call_id = any")) {
      const ids = new Set(params[0]);
      const rows = this.leads.filter((lead) => ids.has(lead.retell_call_id));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("insert into leads")) {
      const [
        business_id,
        caller_name,
        retell_call_id,
        phone_number,
        caller_id,
        callback_number,
        issue_reason,
        address,
        urgency_level,
        availability,
        status,
        contacted_at,
        contacted_by,
        summary,
        created_at,
      ] = params;
      const inserted = {
        id: this.nextId++,
        business_id,
        caller_name,
        retell_call_id,
        phone_number,
        caller_id,
        callback_number,
        issue_reason,
        address,
        urgency_level,
        availability,
        status,
        contacted_at,
        contacted_by,
        summary,
        created_at,
      };
      this.leads.push(inserted);
      this.inserts.push(inserted);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected fake SQL: ${statement}`);
  }
}

test("looks up only the exact configured Clerk email and validates the unique user result", async () => {
  let requestedUrl;
  let authorization;
  const userId = await findClerkUserIdByExactEmail("sk_test_never_logged", async (url, init) => {
    requestedUrl = new URL(url);
    authorization = new Headers(init.headers).get("Authorization");
    return {
      ok: true,
      status: 200,
      json: async () => [{
        id: TARGET_USER_ID,
        email_addresses: [{ email_address: TARGET_EMAIL.toUpperCase() }],
      }],
    };
  });

  assert.equal(userId, TARGET_USER_ID);
  assert.equal(requestedUrl.searchParams.get("email_address[]"), TARGET_EMAIL);
  assert.equal(authorization, "Bearer sk_test_never_logged");
});

test("refuses missing, duplicate, and malformed Clerk account matches", async () => {
  const noMatch = async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: "user_other", email_addresses: [{ email_address: "other@example.test" }] }],
  });
  await assert.rejects(
    findClerkUserIdByExactEmail("sk_test_placeholder", noMatch),
    /Expected exactly one Clerk user/,
  );

  const duplicate = async () => ({
    ok: true,
    status: 200,
    json: async () => [
      { id: TARGET_USER_ID, email_addresses: [{ email_address: TARGET_EMAIL }] },
      { id: "user_second_match", email_addresses: [{ email_address: TARGET_EMAIL }] },
    ],
  });
  await assert.rejects(
    findClerkUserIdByExactEmail("sk_test_placeholder", duplicate),
    /Expected exactly one Clerk user/,
  );
});

test("demo leads use only reserved 202-555 numbers and supported mixed statuses", () => {
  const leads = makeDemoLeads(FIXED_NOW);
  assert.equal(leads.length, 9);
  assert.deepEqual(
    new Set(leads.map((lead) => lead.status)),
    new Set(["new", "called_back", "booked", "closed"]),
  );
  assert.deepEqual(
    new Set(leads.map((lead) => lead.urgencyLevel)),
    new Set(["urgent", "normal", "low"]),
  );
  assert.equal(new Set(leads.map((lead) => lead.phoneNumber)).size, leads.length);
  for (const lead of leads) {
    assert.match(lead.phoneNumber, /^\+120255501\d{2}$/);
    assert.ok(Number(lead.phoneNumber.slice(-2)) <= 8);
    assert.ok(lead.retellCallId.startsWith(LEAD_CALL_ID_PREFIX));
    assert.ok(lead.summary.includes(SEED_MARKER));
    assert.match(lead.address, /Example City, FL$/);
  }
});

test("inserts all sample leads for only the exact demo business inside one transaction", async () => {
  const client = new FakeClient();

  const result = await seedAppReviewOwnerLeads(client, TARGET_USER_ID, {
    dryRun: false,
    now: FIXED_NOW,
  });

  assert.deepEqual(result, {
    dryRun: false,
    businessId: 7301,
    leadCount: 9,
    leadsInserted: 9,
  });
  assert.equal(client.inserts.length, 9);
  assert.ok(client.inserts.every((lead) => Number(lead.business_id) === 7301));
  assert.equal(client.statements[0], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.equal(client.statements.at(-1), "COMMIT");
  assert.ok(client.statements.some((statement) => statement.startsWith("SELECT pg_advisory_xact_lock")));
  assert.ok(client.statements.every((statement) => !/^\s*(update|delete)\b/i.test(statement)));
});

test("refuses missing or ambiguous ownership and businesses without the exact demo identity", async () => {
  for (const businesses of [
    [],
    [makeBusiness(), makeBusiness({ id: 7302 })],
    [makeBusiness({ business_name: "Ordinary Plumbing" })],
    [makeBusiness({ owner_email: "owner@example.test" })],
    [makeBusiness({ is_internal: true })],
  ]) {
    const client = new FakeClient({ businesses });
    await assert.rejects(
      seedAppReviewOwnerLeads(client, TARGET_USER_ID, { dryRun: false, now: FIXED_NOW }),
      AppReviewOwnerSeedError,
    );
    assert.equal(client.inserts.length, 0);
    assert.equal(client.statements.at(-1), "ROLLBACK");
  }
});

test("refuses any existing untagged or unrelated lead without modifying it", async () => {
  const client = new FakeClient({
    leads: [{
      business_id: 7301,
      retell_call_id: "real-call-id",
      summary: "A real caller's lead.",
    }],
  });

  await assert.rejects(
    seedAppReviewOwnerLeads(client, TARGET_USER_ID, { dryRun: false, now: FIXED_NOW }),
    /untagged or unrelated lead/,
  );
  assert.equal(client.inserts.length, 0);
  assert.equal(client.leads.length, 1);
  assert.equal(client.statements.at(-1), "ROLLBACK");
});

test("refuses a seed-marker collision owned by another business", async () => {
  const [firstSeedLead] = makeDemoLeads(FIXED_NOW);
  const client = new FakeClient({
    leads: [{
      business_id: 8802,
      retell_call_id: firstSeedLead.retellCallId,
      summary: firstSeedLead.summary,
    }],
  });

  await assert.rejects(
    seedAppReviewOwnerLeads(client, TARGET_USER_ID, { dryRun: false, now: FIXED_NOW }),
    /already belongs to another business/,
  );
  assert.equal(client.inserts.length, 0);
  assert.equal(client.leads.length, 1);
  assert.equal(client.statements.at(-1), "ROLLBACK");
});

test("fills only missing tagged leads when a prior safe run inserted a subset", async () => {
  const [firstSeedLead] = makeDemoLeads(FIXED_NOW);
  const client = new FakeClient({
    leads: [{
      business_id: 7301,
      retell_call_id: firstSeedLead.retellCallId,
      summary: firstSeedLead.summary,
    }],
  });

  const result = await seedAppReviewOwnerLeads(client, TARGET_USER_ID, {
    dryRun: false,
    now: FIXED_NOW,
  });

  assert.equal(result.leadsInserted, 8);
  assert.equal(client.leads.length, 9);
  assert.equal(new Set(client.leads.map((lead) => lead.retell_call_id)).size, 9);
});

test("reruns insert only missing tagged leads and never duplicate existing ones", async () => {
  const client = new FakeClient();
  await seedAppReviewOwnerLeads(client, TARGET_USER_ID, { dryRun: false, now: FIXED_NOW });
  const afterFirstRun = client.inserts.length;

  const second = await seedAppReviewOwnerLeads(client, TARGET_USER_ID, {
    dryRun: false,
    now: FIXED_NOW,
  });

  assert.equal(afterFirstRun, 9);
  assert.equal(second.leadsInserted, 0);
  assert.equal(client.inserts.length, 9);
  assert.equal(client.leads.length, 9);
});

test("dry run uses a read-only transaction and inserts nothing", async () => {
  const client = new FakeClient();

  const result = await seedAppReviewOwnerLeads(client, TARGET_USER_ID, {
    dryRun: true,
    now: FIXED_NOW,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.leadsToInsert, 9);
  assert.equal(client.statements[0], "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
  assert.equal(client.statements.at(-1), "ROLLBACK");
  assert.equal(client.inserts.length, 0);
});

test("apply requires Production runtime approval and exact owner/business confirmations", () => {
  assert.throws(() => parseArgs(["--apply"]), /--allow-production/);
  assert.throws(
    () => parseArgs(["--apply", "--allow-production", `--confirm-email=${TARGET_EMAIL}`]),
    /--confirm-business/,
  );
  assert.throws(
    () => parseArgs(["--apply", "--allow-production", "--confirm-email=other@example.test", `--confirm-business=${DEMO_BUSINESS_NAME}`]),
    /--confirm-email/,
  );
  assert.throws(
    () => parseArgs(["--apply", "--dry-run", "--allow-production", `--confirm-email=${TARGET_EMAIL}`, `--confirm-business=${DEMO_BUSINESS_NAME}`]),
    /Do not combine/,
  );
  assert.equal(isProductionRuntime({ REPLIT_ENVIRONMENT: "production" }), true);
  assert.equal(isProductionRuntime({ REPLIT_DEV_DOMAIN: "example.replit.dev" }), false);
  assert.throws(
    () => assertApplyRuntime({ REPLIT_DEV_DOMAIN: "example.replit.dev" }),
    /Production runtime/,
  );
  assert.doesNotThrow(() => assertApplyRuntime({ REPLIT_ENVIRONMENT: "production" }));
  assert.equal(parseArgs([
    "--apply",
    "--allow-production",
    `--confirm-email=${TARGET_EMAIL}`,
    `--confirm-business=${DEMO_BUSINESS_NAME}`,
  ]).apply, true);
  assert.deepEqual(parseArgs(["--dry-run"]), {
    apply: false,
    allowProduction: false,
    confirmEmail: "",
    confirmBusiness: "",
    help: false,
  });
});

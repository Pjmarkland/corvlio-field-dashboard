import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRunTarget,
  parseArgs,
  REVIEW_DEMO_BUSINESS_NAME,
  REVIEW_DEMO_MARKER,
  reviewDemoLeads,
  SAFE_DEMO_BUSINESS_PROFILE,
  ReviewDemoSeedError,
  seedReviewDemo,
  removeReviewDemo,
} from "./seed-review-demo.mjs";

const TARGET_USER = "user_review_demo_target";
const OLD_USER = "user_review_demo_old";
const MARKER_KEY = "_appReviewDemoSeed";
const FIXED_NOW = new Date("2026-11-07T12:00:00.000Z");

function makeBusiness({ owner = OLD_USER, isSample = true, marker = false, ...overrides } = {}) {
  return {
    id: 7001,
    business_name: REVIEW_DEMO_BUSINESS_NAME,
    clerk_user_id: owner,
    ...SAFE_DEMO_BUSINESS_PROFILE,
    is_sample: isSample,
    website_enrichment_sources: marker ? { [MARKER_KEY]: REVIEW_DEMO_MARKER } : {},
    ...overrides,
  };
}

class FakeClient {
  constructor({
    business = makeBusiness(),
    activityTables = [],
    activityCounts = {},
    deletionCount = 0,
    webhookCount = 0,
    provisioningCount = 0,
    requiredTables = ["account_deletions", "provisioning_attempts", "retell_webhook_events"],
  } = {}) {
    this.business = business;
    this.extraBusinesses = [];
    this.leads = [];
    this.activityTables = activityTables;
    this.activityCounts = activityCounts;
    this.deletionCount = deletionCount;
    this.webhookCount = webhookCount;
    this.provisioningCount = provisioningCount;
    this.requiredTables = requiredTables;
    this.mutations = [];
    this.statements = [];
    this.nextLeadId = 1;
  }

  async query(sql, params = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    const lower = statement.toLowerCase();
    this.statements.push(statement);
    if (/^(begin|commit|rollback)\b/i.test(statement) || lower.includes("pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 0 };
    }
    if (lower.startsWith("select * from businesses")) {
      const [name, userId] = params;
      const rows = [this.business, ...this.extraBusinesses]
        .filter((row) => row && (row.business_name === name || row.clerk_user_id === userId));
      return { rows, rowCount: rows.length };
    }
    if (lower.startsWith("select * from leads")) {
      const rows = this.leads
        .filter((lead) => Number(lead.business_id) === Number(params[0]))
        .sort((a, b) => a.id - b.id);
      return { rows, rowCount: rows.length };
    }
    if (lower.startsWith("select business_id, retell_call_id from leads")) {
      const ids = params[0];
      const rows = this.leads
        .filter((lead) => ids.includes(lead.retell_call_id))
        .map(({ business_id, retell_call_id }) => ({ business_id, retell_call_id }));
      return { rows, rowCount: rows.length };
    }
    if (lower.includes("from information_schema.columns")) {
      return {
        rows: this.activityTables.map((table_name) => ({ table_name })),
        rowCount: this.activityTables.length,
      };
    }
    if (lower.includes("from information_schema.tables")) {
      const rows = this.requiredTables.map((table_name) => ({ table_name }));
      return { rows, rowCount: rows.length };
    }
    if (lower.includes("from public.\"")) {
      const table = statement.match(/from public\."([^"]+)"/i)?.[1];
      return { rows: [{ count: this.activityCounts[table] ?? 0 }], rowCount: 1 };
    }
    if (lower.includes("from account_deletions")) {
      return { rows: [{ count: this.deletionCount }], rowCount: 1 };
    }
    if (lower.includes("from provisioning_attempts")) {
      return { rows: [{ count: this.provisioningCount }], rowCount: 1 };
    }
    if (lower.includes("from retell_webhook_events")) {
      return { rows: [{ count: this.webhookCount }], rowCount: 1 };
    }
    if (lower.startsWith("update businesses")) {
      this.mutations.push(statement);
      const [id, clerkUserId, markerKey, markerValue, name, previousOwner] = params;
      if (
        this.business
        && Number(this.business.id) === Number(id)
        && this.business.business_name === name
        && this.business.is_sample === true
        && this.business.clerk_user_id === previousOwner
      ) {
        this.business.clerk_user_id = clerkUserId;
        this.business.website_enrichment_sources = {
          ...this.business.website_enrichment_sources,
          [markerKey]: markerValue,
        };
        return { rows: [{ id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (lower.startsWith("insert into leads")) {
      this.mutations.push(statement);
      const [
        business_id, caller_name, retell_call_id, phone_number, issue_reason,
        address, urgency_level, availability, status, contacted_at, contacted_by,
        summary, created_at,
      ] = params;
      this.leads.push({
        id: this.nextLeadId++,
        business_id,
        caller_name,
        retell_call_id,
        phone_number,
        callback_number: phone_number,
        caller_id: null,
        is_spam: false,
        spam_caller_number: null,
        transcript: null,
        summary,
        sentiment: null,
        recording_url: null,
        media_retention_completed_at: null,
        personal_data_retention_completed_at: null,
        private_notes: null,
        issue_reason,
        address,
        urgency_level,
        availability,
        trade_intake_answers: null,
        status,
        contacted_at,
        contacted_by,
        created_at,
      });
      return { rows: [], rowCount: 1 };
    }
    if (lower.startsWith("delete from leads")) {
      this.mutations.push(statement);
      const [businessId, ids] = params;
      const before = this.leads.length;
      this.leads = this.leads.filter(
        (lead) => Number(lead.business_id) !== Number(businessId) || !ids.includes(lead.retell_call_id),
      );
      return { rows: [], rowCount: before - this.leads.length };
    }
    if (lower.startsWith("delete from businesses")) {
      this.mutations.push(statement);
      const [id, name, owner, markerKey, marker] = params;
      if (
        this.business
        && Number(this.business.id) === Number(id)
        && this.business.business_name === name
        && this.business.clerk_user_id === owner
        && this.business.is_sample === true
        && this.business.website_enrichment_sources?.[markerKey] === marker
      ) {
        this.business = null;
        return { rows: [{ id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    assert.fail(`Unexpected SQL in fake database client: ${statement}`);
  }
}

test("refuses to run without exactly one valid Clerk user ID", () => {
  assert.throws(() => parseArgs([]), ReviewDemoSeedError);
  assert.throws(() => parseArgs(["--remove"]), /clerk-user-id/);
  assert.throws(() => parseArgs(["--clerk-user-id="]), /clerk-user-id/);
  assert.throws(
    () => parseArgs(["--clerk-user-id=user_one", "--clerk-user-id=user_two"]),
    /only once/,
  );
});

test("parses seed, remove, and explicit production modes", () => {
  assert.deepEqual(
    parseArgs(["--", "--clerk-user-id=user_review_demo_test"]),
    {
      help: false,
      clerkUserId: "user_review_demo_test",
      remove: false,
      allowProduction: false,
      reconcileExisting: false,
      dryRun: false,
    },
  );
  assert.deepEqual(
    parseArgs([
      "--clerk-user-id",
      "user_review_demo_test",
      "--remove",
      "--dry-run",
      "--allow-production",
    ]),
    {
      help: false,
      clerkUserId: "user_review_demo_test",
      remove: true,
      allowProduction: true,
      reconcileExisting: false,
      dryRun: true,
    },
  );
  assert.deepEqual(
    parseArgs([
      "--clerk-user-id=user_review_demo_test",
      "--reconcile-existing",
      "--dry-run",
      "--allow-production",
    ]),
    {
      help: false,
      clerkUserId: "user_review_demo_test",
      remove: false,
      allowProduction: true,
      reconcileExisting: true,
      dryRun: true,
    },
  );
  assert.throws(
    () => parseArgs(["--clerk-user-id=user_review_demo_test", "--remove", "--reconcile-existing"]),
    /cannot be used together/,
  );
  assert.throws(
    () => parseArgs(["--clerk-user-id=user_review_demo_test", "--dry-run", "--dry-run"]),
    /only once/,
  );
});

test("defaults to Development and requires explicit permission in a Production runtime", () => {
  assert.equal(assertRunTarget(
    { allowProduction: false },
    { REPLIT_DEV_DOMAIN: "dev.example.test", NODE_ENV: "development" },
  ), "development");
  assert.throws(
    () => assertRunTarget({ allowProduction: false }, { NODE_ENV: "production" }),
    /Refusing to run in Production unless --allow-production is passed/,
  );
  assert.throws(
    () => assertRunTarget({ allowProduction: false }, { REPLIT_DEV_DOMAIN: "", NODE_ENV: "development" }),
    /Refusing to seed outside Replit Development/,
  );
  assert.equal(assertRunTarget(
    { allowProduction: true },
    { NODE_ENV: "production", REPLIT_DEPLOYMENT: "1" },
  ), "production");
  assert.equal(assertRunTarget(
    { allowProduction: true },
    { REPLIT_DEV_DOMAIN: "dev.example.test", NODE_ENV: "development" },
  ), "development");
});

test("builds eight recent fictional leads with 555 numbers, mixed urgency and status, and summaries", () => {
  const now = new Date("2026-11-07T12:00:00.000Z");
  const leads = reviewDemoLeads(now);

  assert.equal(leads.length, 8);
  assert.deepEqual(
    leads.map((lead) => lead.phone),
    Array.from({ length: 8 }, (_, index) => `+123955501${String(index + 1).padStart(2, "0")}`),
  );
  assert.equal(new Set(leads.map((lead) => lead.urgency)).size, 4);
  assert.equal(leads.filter((lead) => lead.status === "contacted").length, 3);
  assert.equal(leads.filter((lead) => lead.status === "pending").length, 5);
  assert.equal(leads.filter((lead) => lead.summary !== null).length, 3);
  for (const lead of leads) {
    assert.ok(lead.createdAt <= now);
    assert.ok(lead.createdAt >= new Date(now.getTime() - 24 * 60 * 60_000));
    if (lead.contactedAt) {
      assert.ok(lead.contactedAt >= lead.createdAt);
      assert.ok(lead.contactedAt <= now);
    }
    assert.match(lead.address, /Example City/);
    assert.match(lead.summary ?? "No summary", /Fictional|No summary/);
  }
});

test("reconcile dry-run prints the existing row and exact plan without writing", async () => {
  const client = new FakeClient();
  const reports = [];
  const result = await seedReviewDemo(client, TARGET_USER, {
    now: FIXED_NOW,
    reconcileExisting: true,
    dryRun: true,
    onReport: (report) => reports.push(JSON.parse(report)),
  });

  assert.equal(result.dryRun, true);
  assert.equal(client.mutations.length, 0);
  assert.ok(client.statements.includes("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"));
  assert.ok(client.statements.includes("ROLLBACK"));
  const report = reports[0];
  assert.equal(report.inspection.business.id, 7001);
  assert.equal(report.inspection.business.name, REVIEW_DEMO_BUSINESS_NAME);
  assert.equal(report.inspection.business.is_sample, true);
  assert.equal(report.inspection.business.owner_clerk_id, OLD_USER);
  assert.equal(report.inspection.lead_count, 0);
  assert.deepEqual(report.inspection.real_looking_business_fields, []);
  assert.equal(report.plan.clerk_user_id.from, OLD_USER);
  assert.equal(report.plan.clerk_user_id.to, TARGET_USER);
  assert.equal(report.plan.seed_marker.add, true);
  assert.equal(report.plan.fictional_leads_to_insert, 8);
  assert.match(report.result, /No database changes/);
});

test("reconcile changes only the existing owner's Clerk ID and seed marker, then inserts eight fictional leads idempotently", async () => {
  const client = new FakeClient();
  const reports = [];
  const first = await seedReviewDemo(client, TARGET_USER, {
    now: FIXED_NOW,
    reconcileExisting: true,
    onReport: (report) => reports.push(JSON.parse(report)),
  });
  assert.equal(first.businessId, 7001);
  assert.equal(first.reconciledExisting, true);
  assert.equal(first.createdLeads, 8);
  assert.equal(client.business.clerk_user_id, TARGET_USER);
  assert.deepEqual(client.business.website_enrichment_sources, {
    [MARKER_KEY]: REVIEW_DEMO_MARKER,
  });
  assert.equal(client.leads.length, 8);
  assert.equal(client.mutations.filter((sql) => sql.startsWith("UPDATE businesses")).length, 1);
  const update = client.mutations.find((sql) => sql.startsWith("UPDATE businesses"));
  assert.match(update, /SET clerk_user_id = \$2/);
  assert.match(update, /website_enrichment_sources =/);
  assert.doesNotMatch(update.split(" WHERE ")[0], /business_name\s*=/);
  assert.equal(client.mutations.some((sql) => sql.startsWith("DELETE")), false);
  assert.equal(reports[0].inspection.lead_count, 0);

  const second = await seedReviewDemo(client, TARGET_USER, {
    now: FIXED_NOW,
    reconcileExisting: true,
    onReport: (report) => reports.push(JSON.parse(report)),
  });
  assert.equal(second.createdLeads, 0);
  assert.equal(client.leads.length, 8);
  assert.equal(client.mutations.filter((sql) => sql.startsWith("UPDATE businesses")).length, 1);
});

test("reconcile aborts before writes when profile data, real leads, or related activity exist", async () => {
  const businessDataClient = new FakeClient({
    business: makeBusiness({ owner_email: "customer@example.test" }),
  });
  await assert.rejects(
    seedReviewDemo(businessDataClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /owner_email/,
  );
  assert.equal(businessDataClient.mutations.length, 0);

  const linkedActivityClient = new FakeClient({
    activityTables: ["owner_sms_messages"],
    activityCounts: { owner_sms_messages: 1 },
  });
  await assert.rejects(
    seedReviewDemo(linkedActivityClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /owner_sms_messages: 1 linked record/,
  );
  assert.equal(linkedActivityClient.mutations.length, 0);

  const stripeActivityClient = new FakeClient({
    activityTables: ["billing_accounts"],
    activityCounts: { billing_accounts: 1 },
  });
  await assert.rejects(
    seedReviewDemo(stripeActivityClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /billing_accounts: 1 linked record/,
  );
  assert.equal(stripeActivityClient.mutations.length, 0);

  const provisioningClient = new FakeClient({ provisioningCount: 1 });
  await assert.rejects(
    seedReviewDemo(provisioningClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /provisioning_attempts: 1 related record/,
  );
  assert.equal(provisioningClient.mutations.length, 0);

  const incompleteScannerClient = new FakeClient({
    requiredTables: ["account_deletions", "provisioning_attempts"],
  });
  await assert.rejects(
    seedReviewDemo(incompleteScannerClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /required safety scan table missing: retell_webhook_events/,
  );
  assert.equal(incompleteScannerClient.mutations.length, 0);

  const realLeadClient = new FakeClient();
  realLeadClient.leads.push({
    id: 8,
    business_id: 7001,
    retell_call_id: "real-call-id",
    caller_name: "Real Caller",
    phone_number: "+15551234567",
  });
  await assert.rejects(
    seedReviewDemo(realLeadClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /unrecognized or duplicate lead/,
  );
  assert.equal(realLeadClient.mutations.length, 0);
});

test("reconcile requires one existing sample business with the exact demo name", async () => {
  const nonSampleClient = new FakeClient({ business: makeBusiness({ isSample: false }) });
  await assert.rejects(
    seedReviewDemo(nonSampleClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /is_sample/,
  );
  assert.equal(nonSampleClient.mutations.length, 0);

  const missingClient = new FakeClient({ business: null });
  await assert.rejects(
    seedReviewDemo(missingClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /requires exactly one existing business/,
  );
  assert.equal(missingClient.mutations.length, 0);

  const duplicateClient = new FakeClient({
    business: makeBusiness(),
  });
  const second = makeBusiness({ owner: TARGET_USER });
  second.id = 7002;
  duplicateClient.extraBusinesses = [second];
  await assert.rejects(
    seedReviewDemo(duplicateClient, TARGET_USER, {
      reconcileExisting: true,
      onReport: () => {},
    }),
    /Multiple businesses match/,
  );
  assert.equal(duplicateClient.mutations.length, 0);
});

test("remove dry-run is read-only and remove deletes only the marked fictional fixture", async () => {
  const client = new FakeClient();
  await seedReviewDemo(client, TARGET_USER, {
    now: FIXED_NOW,
    reconcileExisting: true,
    onReport: () => {},
  });
  const before = client.mutations.length;
  const reports = [];
  const dryRun = await removeReviewDemo(client, TARGET_USER, {
    dryRun: true,
    onReport: (report) => reports.push(JSON.parse(report)),
  });
  assert.equal(dryRun.dryRun, true);
  assert.equal(client.mutations.length, before);
  assert.equal(reports[0].plan.lead_ids_to_delete.length, 8);

  const removed = await removeReviewDemo(client, TARGET_USER, { onReport: () => {} });
  assert.equal(removed.removed, true);
  assert.equal(removed.removedLeads, 8);
  assert.equal(client.leads.length, 0);
  assert.equal(client.business, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRunTarget,
  parseArgs,
  reviewDemoLeads,
  ReviewDemoSeedError,
} from "./seed-review-demo.mjs";

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
    { help: false, clerkUserId: "user_review_demo_test", remove: false, allowProduction: false },
  );
  assert.deepEqual(
    parseArgs(["--clerk-user-id", "user_review_demo_test", "--remove", "--allow-production"]),
    { help: false, clerkUserId: "user_review_demo_test", remove: true, allowProduction: true },
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

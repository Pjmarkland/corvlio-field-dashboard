import { describe, expect, it } from "vitest";
import { DEMO_MARKER, findReviewerUser, normalizeReviewerEmail, reviewerLeads, seedReviewerDemo } from "../../../../scripts/lib/app-reviewer-demo.mjs";

function fixture() {
  let business: any = null;
  let leads: any[] = [];
  let unsafe = false, failInsert = false, inserts = 0, snapshot: any;
  const queries: Array<{ sql: string; args: any[] }> = [];
  const client = { query: async (sql: string, args: any[] = []) => {
    queries.push({ sql, args });
    if (sql.startsWith("BEGIN")) { snapshot = { business: structuredClone(business), leads: structuredClone(leads) }; }
    if (sql === "ROLLBACK") { business = snapshot.business; leads = snapshot.leads; }
    if (sql.startsWith("SELECT * FROM businesses")) return { rows: business ? [business] : [] };
    if (sql.includes("AS unsafe")) return { rows: [{ unsafe }] };
    if (sql.includes("INSERT INTO businesses")) {
      business = { id: 7, clerk_user_id: args[1], owner_email: args[2], is_sample: true,
        website_enrichment_sources: JSON.parse(args[3]), retell_phone_number: null, retell_agent_id: null };
      return { rows: [business] };
    }
    if (sql.startsWith("DELETE FROM leads")) leads = [];
    if (sql.includes("INSERT INTO leads")) {
      if (failInsert && ++inserts === 3) throw new Error("Simulated insert failure");
      leads.push(args);
    }
    return { rows: [] };
  } };
  return { client, queries, getBusiness: () => business, getLeads: () => leads,
    existing: (changes: any) => { business = { id: 7, clerk_user_id: "user_reviewer", is_sample: true,
      website_enrichment_sources: { _appReviewerDemo: DEMO_MARKER }, ...changes }; },
    unsafe: () => { unsafe = true; }, fail: () => { failInsert = true; } };
}
const now = new Date("2026-10-12T12:00:00Z");
describe("manual App Store reviewer seed safety", () => {
  it("creates a sample business with exactly eight leads and replaces them without duplication", async () => {
    const f = fixture();
    await seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now);
    expect(f.getBusiness().is_sample).toBe(true);
    expect(f.getLeads()).toHaveLength(8);
    await seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now);
    expect(f.getLeads()).toHaveLength(8);
    expect(f.queries.filter(q => q.sql.includes("INSERT INTO businesses"))).toHaveLength(1);
    expect(f.queries.filter(q => q.sql.startsWith("DELETE FROM leads"))).toHaveLength(1);
    expect(f.queries.at(-1)?.sql).toBe("COMMIT");
  });
  it.each([
    { is_sample: false }, { website_enrichment_sources: {} },
    { retell_phone_number: "+15555550100" }, { retell_agent_id: "agent_real" },
    { clerk_user_id: "user_other" },
  ])("refuses ownership/provisioning/non-demo conflicts before deleting anything: %j", async changes => {
    const f = fixture(); f.existing(changes);
    await expect(seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now)).rejects.toThrow();
    expect(f.queries.some(q => /^\s*(DELETE|UPDATE|INSERT)\b/.test(q.sql))).toBe(false);
    expect(f.queries.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("refuses real or unrecognized call history and checks both call tables and lead provenance", async () => {
    const f = fixture(); f.existing({}); f.unsafe();
    await expect(seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now)).rejects.toThrow("Real or unrecognized");
    const guard = f.queries.find(q => q.sql.includes("AS unsafe"))!;
    expect(guard.sql).toContain("retell_call_records");
    expect(guard.sql).toContain("retell_pending_calls");
    expect(guard.sql).toContain("owner_demo_calls");
    expect(guard.sql).toContain("retell_call_id NOT LIKE");
    expect(guard.sql).toContain("recording_url IS NOT NULL");
    expect(f.queries.some(q => q.sql.startsWith("DELETE"))).toBe(false);
  });
  it("rolls back a partial seed if any lead insert fails", async () => {
    const f = fixture(); f.fail();
    await expect(seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now)).rejects.toThrow("Simulated");
    expect(f.getBusiness()).toBeNull(); expect(f.getLeads()).toEqual([]);
    expect(f.queries.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("restores the previous demo leads if replacement fails midway", async () => {
    const f = fixture();
    await seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now);
    const previous = structuredClone(f.getLeads());
    f.fail();
    await expect(seedReviewerDemo(f.client, "reviewer@example.test", "user_reviewer", now)).rejects.toThrow("Simulated");
    expect(f.getLeads()).toEqual(previous);
  });
  it("uses only fictional numbers, mixed urgency, two contacted leads, and recent timestamps", () => {
    const leads = reviewerLeads(now);
    expect(leads.filter(lead => lead.urgency === "Emergency")).toHaveLength(2);
    expect(leads.filter(lead => lead.status === "contacted")).toHaveLength(2);
    for (const lead of leads) {
      expect(lead.phone).toMatch(/^\+123955501\d{2}$/);
      expect(lead.address).toContain("Fort Myers");
      expect(lead.createdAt.getTime()).toBeLessThan(now.getTime());
      expect(lead.createdAt.getTime()).toBeGreaterThan(now.getTime() - 5 * 86400000);
    }
  });
  it("looks up an existing verified Clerk user without creating one", async () => {
    const user = { id: "user_reviewer", emailAddresses: [{ emailAddress: "reviewer@example.test", verification: { status: "verified" } }] };
    expect(await findReviewerUser("reviewer@example.test", async () => ({ data: [user], totalCount: 1 }))).toBe("user_reviewer");
    await expect(findReviewerUser("reviewer@example.test", async () => ({ data: [], totalCount: 0 }))).rejects.toThrow("existing Clerk");
    await expect(findReviewerUser("reviewer@example.test", async () => ({ data: [user, user], totalCount: 2 }))).rejects.toThrow("exactly one");
    user.emailAddresses[0].verification.status = "unverified";
    await expect(findReviewerUser("reviewer@example.test", async () => ({ data: [user], totalCount: 1 }))).rejects.toThrow("verified");
    expect(normalizeReviewerEmail(" Reviewer@Example.test ")).toBe("reviewer@example.test");
    expect(() => normalizeReviewerEmail("bad")).toThrow();
  });
});

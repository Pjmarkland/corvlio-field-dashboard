import { describe, expect, it, vi } from "vitest";
import { createAppReviewOwnerDemoSeed, type ReviewSeedClient } from "../../src/lib/appReviewOwnerDemoCore";
import { LEAD_CALL_ID_PREFIX, makeDemoLeads, SEED_MARKER, TARGET_EMAIL } from "../../src/lib/appReviewOwnerDemoData.mjs";

const now = new Date("2026-11-12T04:00:00Z");
const userId = "user_review";
const business = { id: 31, clerkUserId: userId, isInternal: false };

function fixture() {
  const state = {
    owned: [{ id: business.id, clerk_user_id: userId, is_internal: false }] as Record<string, unknown>[],
    leads: [] as Record<string, unknown>[],
    collisions: false,
    failAt: "",
    discard: false,
    committed: false,
    values: [] as unknown[],
    statements: [] as string[],
    pending: [] as Record<string, unknown>[],
    released: false,
  };
  const client: ReviewSeedClient = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      state.statements.push(normalized);
      if (state.failAt && normalized.startsWith(state.failAt)) throw new Error("secret provider/db detail");
      if (normalized.startsWith("SELECT id, clerk_user_id")) return { rows: state.owned };
      if (normalized.startsWith("SELECT id FROM leads WHERE business_id")) return { rows: state.leads.slice(0, 1) };
      if (normalized.startsWith("SELECT id FROM leads WHERE retell_call_id")) {
        return { rows: state.collisions ? [{ id: 99 }] : [] };
      }
      if (normalized.startsWith("INSERT INTO leads")) {
        state.values = values;
        state.pending = Array.from({ length: values.length / 15 }, (_, i) => ({
          id: i + 1, business_id: values[i * 15], retell_call_id: values[i * 15 + 2],
        }));
        return { rows: state.pending };
      }
      if (normalized === "COMMIT") {
        state.leads.push(...state.pending);
        state.pending = [];
        state.committed = true;
      }
      if (normalized === "ROLLBACK") state.pending = [];
      return { rows: [] };
    },
    release(discard) {
      state.released = true;
      state.discard = discard ?? false;
    },
  };
  const getUser = vi.fn(async () => ({
    id: userId,
    emailAddresses: [{ emailAddress: TARGET_EMAIL.toUpperCase(), verification: { status: "verified" } }],
  }));
  const connect = vi.fn(async () => client);
  const log = vi.fn();
  const seed = createAppReviewOwnerDemoSeed({ getUser, connect, log, now: () => now, identityTimeoutMs: 10 });
  return { state, client, getUser, connect, log, seed };
}

describe("deployed App Review owner demo initialization", () => {
  it("reuses the CLI fixtures, reserved numbers, statuses, and tags", () => {
    const leads = makeDemoLeads(now);
    expect(leads).toHaveLength(9);
    expect(leads.map((lead) => lead.status)).toEqual([
      "new", "called_back", "booked", "new", "new", "called_back", "closed", "new", "booked",
    ]);
    for (const lead of leads) {
      expect(lead.phoneNumber).toMatch(/^\+120255501\d{2}$/);
      expect(lead.retellCallId).toMatch(new RegExp(`^${LEAD_CALL_ID_PREFIX}`));
      expect(lead.summary).toContain(SEED_MARKER);
    }
  });

  it("seeds exactly nine leads for the authenticated owner's empty business regardless of its name/email", async () => {
    const f = fixture();
    // No business name or business contact email is used as an identity substitute.
    expect(await f.seed(userId, business)).toBe("inserted");
    expect(f.state.leads).toHaveLength(9);
    expect(f.state.leads.every((lead) => lead.business_id === business.id)).toBe(true);
    expect(f.state.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(f.state.statements.at(-1)).toBe("COMMIT");
    expect(f.state.statements).toContain("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))");
    expect(f.state.statements.find((sql) => sql.startsWith("SELECT id, clerk_user_id"))).toContain("FOR UPDATE");
    expect(f.state.statements.some((sql) => /^(UPDATE|DELETE|ALTER|CREATE)\b/.test(sql))).toBe(false);
    expect(f.state.values.filter((_, index) => index % 15 === 3)).toEqual(
      makeDemoLeads(now).map((lead) => lead.phoneNumber),
    );
    expect(f.log).toHaveBeenCalledExactlyOnceWith("inserted");
    expect(f.state.released).toBe(true);
  });

  it.each([
    ["other address", "somebody@example.test", "verified", userId],
    ["alias address", "pjmarkland08@gmail.com", "verified", userId],
    ["suffix address", `${TARGET_EMAIL}.attacker.test`, "verified", userId],
    ["unverified address", TARGET_EMAIL, "unverified", userId],
    ["mismatched Clerk result", TARGET_EMAIL, "verified", "user_other"],
  ])("does not touch the database for %s", async (_, emailAddress, status, id) => {
    const f = fixture();
    f.getUser.mockResolvedValue({ id, emailAddresses: [{ emailAddress, verification: { status } }] });
    expect(await f.seed(userId, business)).toBe("skipped");
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.log).not.toHaveBeenCalled();
  });

  it("skips unauthenticated, absent, internal, or differently owned businesses before Clerk lookup", async () => {
    const f = fixture();
    for (const candidate of [null, { ...business, isInternal: true }, { ...business, clerkUserId: "user_other" }]) {
      expect(await f.seed(userId, candidate)).toBe("skipped");
    }
    expect(await f.seed("", business)).toBe("skipped");
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["multiple", [{ id: 31, clerk_user_id: userId, is_internal: false }, { id: 32, clerk_user_id: userId, is_internal: false }]],
    ["internal", [{ id: 31, clerk_user_id: userId, is_internal: true }]],
    ["changed ownership", [{ id: 31, clerk_user_id: "user_other", is_internal: false }]],
    ["different business", [{ id: 32, clerk_user_id: userId, is_internal: false }]],
  ])("rechecks and refuses %s ownership inside the transaction", async (_, rows) => {
    const f = fixture();
    f.state.owned = rows;
    expect(await f.seed(userId, business)).toBe("skipped");
    expect(f.state.statements.at(-1)).toBe("ROLLBACK");
    expect(f.state.values).toHaveLength(0);
  });

  it.each(["untagged real lead", "partial tagged seed", "complete tagged seed"])("never touches a business with %s", async (kind) => {
    const f = fixture();
    f.state.leads = [{
      id: 1, retell_call_id: kind === "untagged real lead" ? "real-call" : `${LEAD_CALL_ID_PREFIX}001`,
    }];
    expect(await f.seed(userId, business)).toBe("skipped");
    expect(f.state.values).toHaveLength(0);
    expect(f.state.statements.at(-1)).toBe("ROLLBACK");
  });

  it("skips global seed-ID collisions without touching another business", async () => {
    const f = fixture();
    f.state.collisions = true;
    expect(await f.seed(userId, business)).toBe("skipped");
    expect(f.state.values).toHaveLength(0);
    expect(f.state.statements.at(-1)).toBe("ROLLBACK");
  });

  it("is idempotent on repeated dashboard requests and logs only once", async () => {
    const f = fixture();
    expect(await f.seed(userId, business)).toBe("inserted");
    expect(await f.seed(userId, business)).toBe("skipped");
    expect(f.state.leads).toHaveLength(9);
    expect(f.state.statements.filter((sql) => sql.startsWith("INSERT INTO leads"))).toHaveLength(1);
    expect(f.log).toHaveBeenCalledTimes(1);
  });

  it("serializes simultaneous requests through the shared transaction lock", async () => {
    const f = fixture();
    let tail = Promise.resolve();
    const concurrentSeed = createAppReviewOwnerDemoSeed({
      getUser: f.getUser,
      now: () => now,
      log: f.log,
      connect: async () => {
        let unlock: (() => void) | undefined;
        return {
          async query(sql, values) {
            if (sql.includes("pg_advisory_xact_lock")) {
              const previous = tail;
              tail = new Promise<void>((resolve) => { unlock = resolve; });
              await previous;
            }
            const result = await f.client.query(sql, values);
            if (sql === "COMMIT" || sql === "ROLLBACK") unlock?.();
            return result;
          },
          release() { unlock?.(); },
        };
      },
    });
    const outcomes = await Promise.all([
      concurrentSeed(userId, business),
      concurrentSeed(userId, business),
    ]);
    expect(outcomes.sort()).toEqual(["inserted", "skipped"]);
    expect(f.state.leads).toHaveLength(9);
    expect(f.state.statements.filter((sql) => sql.startsWith("INSERT INTO leads"))).toHaveLength(1);
  });

  it("rechecks emptiness after waiting for the business lock, including newly committed real leads", async () => {
    const f = fixture();
    const originalQuery = f.client.query.bind(f.client);
    f.client.query = async (sql, values) => {
      const result = await originalQuery(sql, values);
      if (sql.includes("FOR UPDATE")) f.state.leads.push({ id: 99, retell_call_id: "new-real-lead" });
      return result;
    };
    expect(await f.seed(userId, business)).toBe("skipped");
    expect(f.state.values).toHaveLength(0);
    expect(f.state.leads).toHaveLength(1);
  });

  it.each(["SELECT id, clerk_user_id", "SELECT id FROM leads WHERE business_id", "INSERT INTO leads", "COMMIT"])(
    "rolls back on %s failure and reports only a sanitized outcome",
    async (failAt) => {
      const f = fixture();
      f.state.failAt = failAt;
      expect(await f.seed(userId, business)).toBe("failed");
      expect(f.state.leads).toHaveLength(0);
      expect(f.state.pending).toHaveLength(0);
      expect(f.state.statements.at(-1)).toBe("ROLLBACK");
      expect(f.log).toHaveBeenCalledExactlyOnceWith("failed");
      expect(f.state.released).toBe(true);
    },
  );

  it("fails closed on Clerk/network errors or timeouts without opening a database connection", async () => {
    const f = fixture();
    f.getUser.mockRejectedValueOnce(new Error("private credential/provider information"));
    expect(await f.seed(userId, business)).toBe("failed");
    f.getUser.mockReturnValueOnce(new Promise(() => {}));
    expect(await f.seed(userId, business)).toBe("failed");
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledExactlyOnceWith("failed");
  });

  it("fails closed on connection errors and does not leak error information", async () => {
    const f = fixture();
    f.connect.mockRejectedValueOnce(new Error("private connection string"));
    expect(await f.seed(userId, business)).toBe("failed");
    expect(f.log).toHaveBeenCalledExactlyOnceWith("failed");
  });

  it("discards the connection if rollback fails instead of returning an open transaction to the pool", async () => {
    const f = fixture();
    f.state.failAt = "INSERT INTO leads";
    const originalQuery = f.client.query.bind(f.client);
    f.client.query = async (sql, values) => {
      if (sql === "ROLLBACK") throw new Error("connection lost");
      return originalQuery(sql, values);
    };
    expect(await f.seed(userId, business)).toBe("failed");
    expect(f.state.discard).toBe(true);
  });

  it("does not let a logging failure break a successfully committed seed", async () => {
    const f = fixture();
    f.log.mockImplementation(() => { throw new Error("logger unavailable"); });
    expect(await f.seed(userId, business)).toBe("inserted");
    expect(f.state.leads).toHaveLength(9);
  });

  it("caches non-review identities briefly without allowing them to seed", async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({ id: userId, emailAddresses: [] });
    await f.seed(userId, business);
    await f.seed(userId, business);
    expect(f.getUser).toHaveBeenCalledTimes(1);
    expect(f.connect).not.toHaveBeenCalled();
  });
});

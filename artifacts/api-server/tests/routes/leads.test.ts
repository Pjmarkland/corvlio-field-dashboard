import express from "express";
import { createServer, type Server } from "node:http";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: [] as any[],
  aggregate: {
    totalLeads: "5",
    contactedLeads: "2",
    thisWeekLeads: "4",
    averageReplyMinutes: "12.6",
  },
  selectCount: 0,
  limit: 0,
  offset: 0,
  pageWhereSql: "",
  aggregateWhereSql: "",
  isSample: false,
  fail: false,
  error: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.get("x-test-user") ?? null }),
}));
vi.mock("../../src/lib/businessDirectory", () => ({
  findBusinessByClerkUserId: async (userId: string) => userId === "owner"
    ? {
        id: 11,
        businessName: "Northside Plumbing",
        retellPhoneNumber: "+15550000000",
        timeZone: "America/Chicago",
        isSample: fixture.isSample,
        provisioningState: fixture.isSample ? "sample" : "ready",
      }
    : undefined,
}));
vi.mock("@workspace/db", async () => {
  const { leadsTable } = await import("../../../../lib/db/src/schema/leads");
  const dialect = new PgDialect();
  const db = {
    select: () => {
      const selectIndex = fixture.selectCount++;
      if (selectIndex > 0) {
        return {
          from: () => ({
            where: async (condition: any) => {
              fixture.aggregateWhereSql = dialect.sqlToQuery(condition).sql;
              if (fixture.fail) throw new Error("private database failure");
              return [fixture.aggregate];
            },
          }),
        };
      }

      const pageQuery = {
        showSpam: false,
        orderBy: () => pageQuery,
        limit: (limit: number) => {
          fixture.limit = limit;
          return pageQuery;
        },
        offset: async (offset: number) => {
          fixture.offset = offset;
          if (fixture.fail) throw new Error("private database failure");
          return fixture.rows.filter((row) => Boolean(row.isSpam) === pageQuery.showSpam)
            .slice(offset, offset + fixture.limit);
        },
      };
      return {
        from: () => ({
          where: (condition: any) => {
            const query = dialect.sqlToQuery(condition);
            fixture.pageWhereSql = query.sql;
            pageQuery.showSpam = query.params.includes(true);
            return pageQuery;
          },
        }),
      };
    },
  };
  return { db, leadsTable };
});
import leadsRouter from "../../src/routes/leads";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.log = { error: fixture.error, warn: vi.fn() } as unknown as typeof req.log;
    next();
  });
  app.use(leadsRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  fixture.selectCount = 0;
  fixture.limit = 0;
  fixture.offset = 0;
  fixture.pageWhereSql = "";
  fixture.aggregateWhereSql = "";
  fixture.isSample = false;
  fixture.fail = false;
  fixture.rows = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    callerName: `Caller ${index + 1}`,
    phoneNumber: "+15551112222",
    issueReason: "Leaking kitchen faucet",
    address: "10 Main Street",
    urgencyLevel: "normal",
    status: index < 2 ? "contacted" : "new",
    createdAt: new Date(`2026-10-${String(20 - index).padStart(2, "0")}T12:00:00.000Z`),
    contactedAt: index < 2 ? new Date(`2026-10-${String(20 - index).padStart(2, "0")}T12:12:36.000Z`) : null,
    callerId: null,
    callbackNumber: null,
    availability: null,
    tradeIntakeAnswers: null,
    isSpam: false,
    transcript: "private transcript",
    summary: "private summary",
  }));
});

async function request(path: string, user?: string) {
  const response = await fetch(`${base}${path}`, {
    headers: user ? { "x-test-user": user } : {},
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe("paginated owner lead list", () => {
  it("returns a bounded page and global metrics without transcripts or summaries", async () => {
    const response = await request("/leads?page=1&pageSize=2", "owner");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.body).toMatchObject({
      configured: true,
      page: 1,
      pageSize: 2,
      hasMore: true,
      summary: {
        totalLeads: 5,
        pendingLeads: 3,
        contactedLeads: 2,
        thisWeekLeads: 4,
        averageReplyMinutes: 13,
      },
    });
    expect(response.body.leads).toHaveLength(2);
    expect(response.body.leads[0]).not.toHaveProperty("transcript");
    expect(response.body.leads[0]).not.toHaveProperty("summary");
    expect(fixture.limit).toBe(3);
    expect(fixture.offset).toBe(0);
  });

  it("treats a linked sample business as configured so its leads can load without onboarding", async () => {
    fixture.isSample = true;
    const response = await request("/leads", "owner");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      configured: true,
      isSample: true,
      provisioningState: "sample",
      businessName: "Northside Plumbing",
      leads: expect.arrayContaining([
        expect.objectContaining({ id: "1", name: "Caller 1" }),
      ]),
    });
  });

  it("loads the next page and marks the final page", async () => {
    const second = await request("/leads?page=2&pageSize=2", "owner");
    expect(second.body.leads.map((lead: { id: string }) => lead.id)).toEqual(["3", "4"]);
    expect(second.body.hasMore).toBe(true);
    expect(fixture.offset).toBe(2);

    fixture.selectCount = 0;
    const third = await request("/leads?page=3&pageSize=2", "owner");
    expect(third.body.leads.map((lead: { id: string }) => lead.id)).toEqual(["5"]);
    expect(third.body.hasMore).toBe(false);
    expect(fixture.offset).toBe(4);
  });

  it("hides spam leads and excludes them from normal summary counts", async () => {
    fixture.rows[0].isSpam = true;
    fixture.aggregate.totalLeads = "4";
    fixture.aggregate.contactedLeads = "1";
    const response = await request("/leads", "owner");
    expect(response.body.leads.map((lead: { id: string }) => lead.id)).not.toContain("1");
    expect(response.body.summary).toMatchObject({ totalLeads: 4, contactedLeads: 1 });
    expect(fixture.pageWhereSql).toContain('"is_spam"');
    expect(fixture.aggregateWhereSql).toContain('"is_spam"');
  });

  it("loads spam leads only when the owner opens the spam view", async () => {
    fixture.rows[0].isSpam = true;
    fixture.aggregate.totalLeads = "1";
    fixture.aggregate.contactedLeads = "1";
    const response = await request("/leads?showSpam=true", "owner");
    expect(response.body.leads.map((lead: { id: string }) => lead.id)).toEqual(["1"]);
    expect(response.body.summary.totalLeads).toBe(1);
  });

  it.each(["0", "-1", "1.5", "nope", "101"])("rejects invalid pagination value %s", async (value) => {
    const response = await request(`/leads?pageSize=${value}`, "owner");
    expect(response.status).toBe(400);
    expect(fixture.selectCount).toBe(0);
  });

  it("returns an empty unconfigured workspace with pagination metadata", async () => {
    const response = await request("/leads?page=2&pageSize=10", "new-owner");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      configured: false,
      page: 2,
      pageSize: 10,
      hasMore: false,
      summary: { totalLeads: 0, pendingLeads: 0, contactedLeads: 0 },
      leads: [],
    });
    expect(fixture.selectCount).toBe(0);
  });

  it("does not expose database details on failure", async () => {
    fixture.fail = true;
    const response = await request("/leads", "owner");
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "Unable to load leads" });
  });
});

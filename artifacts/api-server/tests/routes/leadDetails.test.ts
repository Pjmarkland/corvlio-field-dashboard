import express from "express";
import { createServer, type Server } from "node:http";
import { PgDialect } from "drizzle-orm/pg-core";

const fixture = vi.hoisted(() => ({
  rows: [] as any[], records: [] as any[], flags: [] as any[], notifications: [] as any[],
  fail: false, removeCall: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.get("x-test-user") ?? null }),
}));
vi.mock("../../src/lib/businessDirectory", () => ({
  findBusinessByClerkUserId: async (user: string) =>
    user === "owner-a" ? { id: 1 } : user === "owner-b" ? { id: 2 } : undefined,
}));
vi.mock("@workspace/db", async () => {
  const { leadsTable } = await import("../../../../lib/db/src/schema/leads");
  const { retellCallRecordsTable } = await import("../../../../lib/db/src/schema/retellCallRecords");
  const { leadInfoFlagsTable } = await import("../../../../lib/db/src/schema/leadInfoFlags");
  const { notificationEventsTable } = await import("../../../../lib/db/src/schema/notifications");
  const dialect = new PgDialect();
  function selected(condition: any) {
    const query = dialect.sqlToQuery(condition);
    // Evaluate the real Drizzle WHERE clause. Missing the business predicate
    // exposes another tenant's row and fails the cross-owner route tests.
    return fixture.rows.filter(row => row.id === query.params[0]
      && (!query.sql.includes('"business_id"') || row.businessId === query.params[1]));
  }
  const db: any = {
    select: () => ({ from: (table: any) => ({ where: (condition: any) => ({
      limit: async () => {
        if (fixture.fail) throw new Error("Database error");
        if (table === leadsTable) return selected(condition);
        const q = dialect.sqlToQuery(condition);
        const scoped = q.sql.includes('"business_id"');
        const reference = q.params[scoped ? 1 : 0];
        return fixture.records.filter(row => (!scoped || row.businessId === q.params[0])
          && (q.sql.includes('"retell_call_id"') ? row.retellCallId === reference : row.leadId === reference));
      },
    }) }) }),
    update: () => ({ set: (updates: any) => ({ where: (condition: any) => ({
      returning: async () => {
        if (fixture.fail) throw new Error("Database error");
        const rows = selected(condition);
        rows.forEach(row => Object.assign(row, updates));
        return rows;
      },
    }) }) }),
    insert: () => ({ values: (value: any) => ({ onConflictDoNothing: async () => { fixture.flags.push(value); } }) }),
    delete: (table: any) => ({ where: async (condition: any) => {
      if (fixture.fail) throw new Error("Database error");
      if (table === leadsTable) {
        const removed = selected(condition);
        fixture.rows = fixture.rows.filter(row => !removed.includes(row));
        return removed;
      }
      const query = dialect.sqlToQuery(condition);
      if (table === notificationEventsTable) {
        const [businessId, leadId] = query.params;
        fixture.notifications = fixture.notifications.filter(row =>
          row.businessId !== businessId || row.leadId !== leadId);
      } else if (table === retellCallRecordsTable) {
        const [businessId, leadId, callId] = query.params;
        fixture.records = fixture.records.filter(row =>
          row.businessId !== businessId || (row.leadId !== leadId && row.retellCallId !== callId));
      }
      return [];
    } }),
  };
  db.transaction = (callback: (tx: any) => Promise<unknown>) => callback(db);
  return { leadsTable, retellCallRecordsTable, leadInfoFlagsTable, notificationEventsTable, db };
});
vi.mock("../../src/lib/retellCallDeletion", () => ({ deleteRetellCall: fixture.removeCall }));
import detailsRouter from "../../src/routes/leadDetails";
import leadsRouter from "../../src/routes/leads";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: vi.fn(), warn: vi.fn() }; next(); });
  app.use(leadsRouter, detailsRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.removeCall.mockResolvedValue(undefined);
  fixture.fail = false;
  fixture.flags = [];
  fixture.notifications = [];
  fixture.rows = [1, 2].map(businessId => ({
    id: businessId * 100 + 1, businessId, callerName: null, retellCallId: `call-${businessId}`,
    phoneNumber: null, callbackNumber: null, callerId: null, issueReason: null,
    address: null, urgencyLevel: null, availability: null, transcript: null,
    summary: null, tradeIntakeAnswers: null, recordingUrl: null, privateNotes: null,
    contactedBy: null, contactedAt: null, status: "new", createdAt: new Date("2026-10-10T00:00:00Z"),
  }));
  fixture.rows[1].callerName = "Other tenant secret";
  fixture.rows[1].privateNotes = "Owner B private notes";
  fixture.records = [{ businessId: 1, leadId: 101, retellCallId: "call-1",
    durationMs: 42000, callStartedAt: new Date("2026-10-09T23:59:00Z") }];
});
async function request(path: string, user?: string, method = "GET", data?: any) {
  const response = await fetch(base + path, {
    method, headers: { ...(user ? { "x-test-user": user } : {}), "content-type": "application/json" },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
}

it("returns the owner's almost-empty lead plus existing linked call metadata", async () => {
  const response = await request("/leads/101", "owner-a");
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ id: "101", name: "", status: "pending",
    durationMs: 42000, callStartedAt: "2026-10-09T23:59:00.000Z", recordingUrl: null,
    privateNotes: null, contactedBy: null, capturedUrgency: null });
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("user A cannot fetch user B's lead by ID; user B can", async () => {
  expect(await request("/leads/201", "owner-a")).toMatchObject({
    status: 404, body: { error: "Lead not found" },
  });
  expect(await request("/leads/201", "owner-b")).toMatchObject({
    status: 200, body: { name: "Other tenant secret", privateNotes: "Owner B private notes" },
  });
});
it("user A cannot modify user B's private notes", async () => {
  expect(await request("/leads/201/notes", "owner-a", "PATCH", { privateNotes: "overwrite" }))
    .toMatchObject({ status: 404 });
  expect(fixture.rows[1].privateNotes).toBe("Owner B private notes");
});
it("never joins call metadata from another business, even with a matching call ID", async () => {
  fixture.records = [{ businessId: 2, leadId: 101, retellCallId: "call-1",
    durationMs: 99000, callStartedAt: new Date() }];
  expect((await request("/leads/101", "owner-a")).body)
    .toMatchObject({ durationMs: null, callStartedAt: null });
});
it("persists and clears plain-text private notes without changing intake or status", async () => {
  const value = '<img src=x onerror=alert(1)> private note';
  expect(await request("/leads/101/notes", "owner-a", "PATCH", { privateNotes: value }))
    .toMatchObject({ status: 200, body: { privateNotes: value, status: "pending" } });
  expect((await request("/leads/101", "owner-a")).body.privateNotes).toBe(value);
  expect((await request("/leads/101/notes", "owner-a", "PATCH", { privateNotes: "" })).body.privateNotes).toBeNull();
});
it("flags only an owned lead and stores no caller data in the flag", async () => {
  expect(await request("/leads/101/flag", "owner-a", "POST", { reason: "Incorrect service area" }))
    .toMatchObject({ status: 200, body: { flagged: true } });
  expect(fixture.flags).toEqual([{ businessId: 1, leadId: 101, reason: "Incorrect service area" }]);
  expect((await request("/leads/201/flag", "owner-a", "POST", {})).status).toBe(404);
  expect(fixture.flags).toHaveLength(1);
});
it("deletes an owned lead, linked Retell metadata, and notifications after provider deletion", async () => {
  fixture.notifications = [
    { businessId: "1", leadId: "101" },
    { businessId: "2", leadId: "201" },
  ];
  expect(await request("/leads/101", "owner-a", "DELETE")).toMatchObject({ status: 204, body: null });
  expect(fixture.removeCall).toHaveBeenCalledWith("call-1");
  expect(fixture.rows.map(row => row.id)).toEqual([201]);
  expect(fixture.records).toEqual([]);
  expect(fixture.notifications).toEqual([{ businessId: "2", leadId: "201" }]);
});
it("keeps the lead available when Retell deletion fails", async () => {
  fixture.removeCall.mockRejectedValue(new Error("provider error"));
  expect(await request("/leads/101", "owner-a", "DELETE")).toMatchObject({ status: 502 });
  expect(fixture.rows.map(row => row.id)).toEqual([101, 201]);
});
it("requires authentication for detail and notes", async () => {
  expect((await request("/leads/101")).status).toBe(401);
  expect((await request("/leads/101/notes", undefined, "PATCH", { privateNotes: "" })).status).toBe(401);
});
it.each(["0", "-1", "101abc", "9007199254740992", "999"])("returns a safe 404 for invalid or absent lead %s", async id => {
  expect((await request(`/leads/${id}`, "owner-a")).status).toBe(404);
});
it("does not grant an admin identity a bypass on the owner endpoint", async () => {
  expect((await request("/leads/201", "admin")).status).toBe(404);
});
it("rejects oversized or forged notes fields", async () => {
  for (const data of [{ privateNotes: "a".repeat(10001) }, { privateNotes: "", businessId: 2 }, { privateNotes: null }]) {
    expect((await request("/leads/101/notes", "owner-a", "PATCH", data)).status).toBe(400);
  }
});
it("records contacted actor on the server and clears it when reopened", async () => {
  expect((await request("/leads/101/status", "owner-a", "PATCH", { status: "contacted" })).status).toBe(200);
  expect(fixture.rows[0].contactedBy).toBe("owner-a");
  expect((await request("/leads/101", "owner-a")).body).toMatchObject({ status: "contacted", contactedBy: "owner-a" });
  await request("/leads/101/status", "owner-a", "PATCH", { status: "pending" });
  expect(fixture.rows[0]).toMatchObject({ contactedBy: null, contactedAt: null });
});
it("returns a safe error without leaking notes when storage is unavailable", async () => {
  fixture.fail = true;
  expect(await request("/leads/101", "owner-a")).toMatchObject({ status: 502, body: { error: "Unable to load lead detail" } });
  expect((await request("/leads/101/notes", "owner-a", "PATCH", { privateNotes: "" })).status).toBe(502);
});

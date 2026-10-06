import { createServer, type Server } from "node:http";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), demo: vi.fn(), select: vi.fn(), update: vi.fn(), where: vi.fn(), values: {} as Record<string, unknown> }));
vi.mock("@clerk/express", () => ({ getAuth: (req: express.Request) => ({ userId: req.get("x-test-user") || null }) }));
vi.mock("../../src/lib/businessDirectory", () => ({ findBusinessByClerkUserId: m.find }));
vi.mock("../../src/lib/ownerDemoCall", () => ({
  placeOwnerDemoCall: m.demo, DemoCallError: class extends Error { status = 400; },
}));
vi.mock("@workspace/db", () => ({
  db: { select: m.select, update: m.update },
  notificationEventsTable: { id: "event_id", businessId: "business_id", readAt: "read_at" },
}));
import demoRouter from "../../src/routes/ownerDemo";
import alertsRouter from "../../src/routes/leadAlerts";
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.log = { error: vi.fn() } as unknown as typeof req.log; next(); });
  app.use(demoRouter); app.use(alertsRouter);
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development");
  m.find.mockImplementation(async user => user === "owner" ? { id: 7, leadAlertsEnabled: true } : { id: 8, leadAlertsEnabled: false });
  m.demo.mockResolvedValue({ callId: "demo", message: "TEST call requested" });
  m.update.mockReturnValue({ set: (values: Record<string, unknown>) => { m.values = values; return { where: m.where }; } });
  m.where.mockResolvedValue([]);
  m.select.mockImplementation(values => ({ from: () => ({ where: () => values ? Promise.resolve([{ total: 1 }]) : ({
    orderBy: () => ({ limit: async () => [{ id: 9, title: "New lead from Sam", body: "Pipe · Callback: +15551230001", deepLink: "/leads/1", createdAt: new Date() }] }),
  }) }) }));
});
function request(path: string, method = "GET", body?: unknown, user = "owner") {
  return fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
describe("owner-only demo and unread alerts API", () => {
  beforeEach(() => { vi.stubEnv("ENABLE_PRODUCTION_OWNER_DEMO_CALLS", ""); });
  it("requires authentication for the no-store capability endpoint without looking up a business", async () => {
    expect((await request("/businesses/me/demo-call-capability", "GET", undefined, "")).status).toBe(401);
    expect(m.find).not.toHaveBeenCalled();
  });
  it.each(["", "false", "true"])("reports and enforces the production opt-in (%s)", async flag => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_PRODUCTION_OWNER_DEMO_CALLS", flag);
    const capability = await request("/businesses/me/demo-call-capability");
    expect(capability.headers.get("cache-control")).toBe("private, no-store");
    expect(await capability.json()).toEqual({ enabled: flag === "true", production: true });
    expect(m.find).not.toHaveBeenCalled();
    const result = await request("/businesses/me/demo-call", "POST", { confirmed: true, confirmedNumber: "+15551230001" });
    expect(result.status).toBe(flag === "true" ? 200 : 404);
    if (flag === "true") expect(m.demo).toHaveBeenCalledWith({ id: 7, leadAlertsEnabled: true }, "+15551230001", true, undefined);
    else expect(m.demo).not.toHaveBeenCalled();
  });
  it("rejects signed-out callers before business lookup", async () => {
    expect((await request("/businesses/me/demo-call", "POST", { confirmed: true, confirmedNumber: "+15551230001" }, "")).status).toBe(401);
    expect((await request("/notifications/inbox", "GET", undefined, "")).status).toBe(401);
    expect(m.find).not.toHaveBeenCalled(); expect(m.demo).not.toHaveBeenCalled();
  });
  it("hides demo dialing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await request("/businesses/me/demo-call", "POST", { confirmed: true, confirmedNumber: "+15551230001" })).status).toBe(404);
    expect(m.demo).not.toHaveBeenCalled();
  });
  it("rejects attempts to select another business or an arbitrary destination field", async () => {
    expect((await request("/businesses/me/demo-call", "POST", {
      confirmed: true, confirmedNumber: "+15551230001", businessId: 8, to_number: "+15559990000",
    })).status).toBe(400);
    expect(m.demo).not.toHaveBeenCalled();
  });
  it("derives ownership from Clerk, not submitted data", async () => {
    const r = await request("/businesses/me/demo-call", "POST", { confirmed: true, confirmedNumber: "+15551230001" });
    expect(r.status).toBe(200); expect(m.find).toHaveBeenCalledWith("owner");
    expect(m.demo).toHaveBeenCalledWith({ id: 7, leadAlertsEnabled: true }, "+15551230001", true, undefined);
  });
  it("returns full unread alert copy with callback and an independent count", async () => {
    const r = await request("/notifications/inbox");
    expect(await r.json()).toMatchObject({ unreadCount: 1, enabled: true, alerts: [{ body: "Pipe · Callback: +15551230001" }] });
  });
  it("hides alerts for a business with its toggle off", async () => {
    const r = await request("/notifications/inbox", "GET", undefined, "other");
    expect(await r.json()).toEqual({ enabled: false, unreadCount: 0, alerts: [] });
    expect(m.select).not.toHaveBeenCalled();
  });
  it("scopes read receipts to the owner's business and observed ID", async () => {
    expect((await request("/notifications/inbox", "POST", { throughId: 9 })).status).toBe(204);
    const query = new PgDialect().sqlToQuery(m.where.mock.calls[0][0]);
    expect(query.params).toContain("7"); expect(query.params).toContain(9);
    expect(m.values.readAt).toBeInstanceOf(Date);
  });
  it("rejects fractional IDs and additional ownership fields in read receipts", async () => {
    expect((await request("/notifications/inbox", "POST", { throughId: 9.5 })).status).toBe(400);
    expect((await request("/notifications/inbox", "POST", { throughId: 9, businessId: 8 })).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
});
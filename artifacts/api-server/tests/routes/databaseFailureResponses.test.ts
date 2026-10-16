import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), find: vi.fn(), error: vi.fn(), warn: vi.fn(),
}));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "test-owner" }) }));
vi.mock("@workspace/db", () => ({
  pool: { query: mocks.query }, db: {},
  leadsTable: {}, notificationEventsTable: {},
}));
vi.mock("../../src/lib/businessDirectory", () => ({ findBusinessByClerkUserId: mocks.find }));
import { accountDeletionGuard } from "../../src/middlewares/accountDeletionGuard";
import leadsRouter from "../../src/routes/leads";
import inboxRouter from "../../src/routes/leadAlerts";

let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.log = { error: mocks.error, warn: mocks.warn } as unknown as typeof req.log;
    next();
  });
  app.use(accountDeletionGuard);
  app.use(leadsRouter);
  app.use(inboxRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.resetAllMocks(); });

describe("signed-in database failure diagnostics", () => {
  it.each(["/leads", "/notifications/inbox"])("logs the driver cause from %s without exposing it to the client", async path => {
    mocks.query.mockResolvedValue({ rows: [] });
    const cause = Object.assign(new Error("The endpoint has been disabled"), { code: "XX000" });
    mocks.find.mockRejectedValue(new Error("Failed query: secret SQL params: secret", { cause }));
    const response = await fetch(base + path);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret|disabled|XX000/);
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      databaseError: expect.objectContaining({ code: "XX000", message: "The endpoint has been disabled" }),
    }), expect.any(String));
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("secret");
  });
  it.each(["/leads", "/notifications/inbox"])("keeps %s blocked and logs connection failure at the guard", async path => {
    mocks.query.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const response = await fetch(base + path);
    expect(response.status).toBe(503);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      databaseError: expect.objectContaining({ code: "ECONNREFUSED" }),
    }), "Account deletion status lookup failed");
  });
});

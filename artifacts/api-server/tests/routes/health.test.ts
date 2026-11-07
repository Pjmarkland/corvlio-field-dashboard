import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  guardStatus: vi.fn(() => ({ status: 'present', missing: [] })),
}));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("../../src/lib/deletedAccountGuardCheck", () => ({
  getDeletedAccountGuardStatus: mocks.guardStatus,
}));
import healthRouter from "../../src/routes/health";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(healthRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => vi.resetAllMocks());

describe("database-backed health check", () => {
  it("returns healthy only after a successful database query", async () => {
    mocks.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      details: { deletedAccountGuards: { status: "present", missing: [] } },
    });
    expect(mocks.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("reports missing guards without making the health route unavailable", async () => {
    mocks.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    mocks.guardStatus.mockReturnValue({
      status: "missing",
      missing: ["public.notification_devices.guard_deleted_account_notification_devices"],
    });
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      details: {
        deletedAccountGuards: {
          status: "missing",
          missing: ["public.notification_devices.guard_deleted_account_notification_devices"],
        },
      },
    });
  });

  it("returns a generic 503 without database error details", async () => {
    mocks.query.mockRejectedValue(new Error("private database hostname unavailable"));
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      details: { deletedAccountGuards: { status: "present", missing: [] } },
    });
  });
});

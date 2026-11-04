import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
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
    expect(await response.json()).toEqual({ status: "ok" });
    expect(mocks.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns a generic 503 without database error details", async () => {
    mocks.query.mockRejectedValue(new Error("private database hostname unavailable"));
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});

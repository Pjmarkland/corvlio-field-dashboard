import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: false, query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: m.query } }));
vi.mock("../../src/middlewares/requireAdmin", () => ({
  requireAdmin: (_req: any, res: any, next: any) => m.admin ? next() : res.sendStatus(404),
}));
import router from "../../src/routes/pendingReleases";
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(router);
  server = createServer(app); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>(done => server.close(() => done())));
beforeEach(() => { vi.clearAllMocks(); m.admin = false; m.query.mockResolvedValue({ rows: [] }); });
it("conceals release data and mutations from non-admins", async () => {
  expect((await fetch(`${base}/admin/pending-releases`)).status).toBe(404);
  expect((await fetch(`${base}/admin/pending-releases/1/complete`, { method: "POST" })).status).toBe(404);
  expect(m.query).not.toHaveBeenCalled();
});
it("only exposes minimal release fields to the admin", async () => {
  m.admin = true;
  m.query.mockResolvedValue({ rows: [{ id: 1, business_id: 7, business_name: "Fictional company", phone_number: "+12395550101",
    agent_id: "shared_fixture", provisioning_status: "ready", created_at: new Date("2026-10-12T00:00:00Z"), clerk_user_id: "must_not_return" }] });
  const response = await fetch(`${base}/admin/pending-releases`);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data[0].businessName).toBe("Fictional company");
  expect(data[0]).not.toHaveProperty("clerk_user_id");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("validates origin and confirmation, clears resource details only after manual completion", async () => {
  m.admin = true;
  const post = (body: unknown, bearer = true) => fetch(`${base}/admin/pending-releases/1/complete`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer test-only" } : {}) }, body: JSON.stringify(body),
  });
  expect((await post({ confirmation: "MANUALLY RELEASED" }, false)).status).toBe(403);
  expect((await post({ confirmation: "wrong" })).status).toBe(400);
  expect(m.query).not.toHaveBeenCalled();
  m.query.mockResolvedValue({ rows: [{ id: 1 }] });
  expect((await post({ confirmation: "MANUALLY RELEASED" })).status).toBe(204);
  expect(m.query.mock.calls[0][0]).toContain("phone_number = NULL");
  expect(m.query.mock.calls[0][1]).toEqual([1]);
});

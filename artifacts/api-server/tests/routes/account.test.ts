import express from "express";
import { createServer, type Server } from "node:http";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), deletion: vi.fn() }));
vi.mock("@clerk/express", () => ({ getAuth: m.auth }));
vi.mock("../../src/lib/accountDeletion", () => ({
  deleteAccount: m.deletion,
  AccountDeletionError: class extends Error { constructor(message: string, public status = 409) { super(message); } },
}));
import router from "../../src/routes/account";
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { (req as any).log = { error: vi.fn() }; next(); }); app.use(router);
  server = createServer(app); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>(done => server.close(() => done())));
beforeEach(() => { vi.clearAllMocks(); m.auth.mockReturnValue({ userId: "user_fixture_owner" }); m.deletion.mockResolvedValue("completed"); });
const request = (data: unknown, bearer = true, origin?: string) => fetch(`${base}/account/me?userId=user_other`, {
  method: "DELETE", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer mock-test-only" } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(data),
});
it("requires authentication", async () => { m.auth.mockReturnValue({ userId: null }); expect((await request({ confirmation: "DELETE" })).status).toBe(401); expect(m.deletion).not.toHaveBeenCalled(); });
it("rejects missing/incorrect confirmation and body identity injection", async () => {
  for (const body of [{}, { confirmation: "delete" }, { confirmation: "DELETE", userId: "user_other" }]) expect((await request(body)).status).toBe(400);
  expect(m.deletion).not.toHaveBeenCalled();
});
it("uses only authenticated identity, never query-string identity", async () => {
  expect((await request({ confirmation: "DELETE" })).status).toBe(200);
  expect(m.deletion).toHaveBeenCalledWith("user_fixture_owner");
});
it("accepts native bearer auth and returns 202 for queued identity deletion", async () => {
  m.deletion.mockResolvedValue("pending");
  const response = await request({ confirmation: "DELETE" }, true, "capacitor://localhost");
  expect(response.status).toBe(202); expect((await response.json()).status).toBe("pending");
});
it("rejects cookie-auth cross-origin requests, accepts same-origin", async () => {
  expect((await request({ confirmation: "DELETE" }, false, "https://evil.example")).status).toBe(403);
  expect(m.deletion).not.toHaveBeenCalled();
  expect((await request({ confirmation: "DELETE" }, false, base)).status).toBe(200);
});

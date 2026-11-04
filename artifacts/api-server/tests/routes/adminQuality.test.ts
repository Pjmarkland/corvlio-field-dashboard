import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ quality: vi.fn() }));
vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.get("x-test-user") }),
  clerkClient: { users: { getUser: async (id: string) => ({
    primaryEmailAddressId: "primary",
    emailAddresses: [{
      id: "primary",
      emailAddress: id === "admin" ? "admin@example.test" : "other@example.test",
      verification: { status: "verified" },
    }],
  }) } },
}));
vi.mock("../../src/lib/adminData", () => ({ getAdminActivity: vi.fn(), getAdminBusiness: vi.fn(), getAdminOverview: vi.fn() }));
vi.mock("../../src/lib/callQuality", () => ({ getAdminCallQuality: m.quality }));
import router from "../../src/routes/admin";
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(router); server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/admin/call-quality`;
});
afterAll(async () => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ADMIN_EMAILS", "admin@example.test");
  m.quality.mockResolvedValue({ totalCalls: 0, calls: [], completePercent: null, completeCalls: 0 });
});
describe("read-only call scorecard authorization", () => {
  it.each(["", "owner"])("hides the endpoint from %s with the existing 404 policy", async user => {
    expect((await fetch(base, { headers: user ? { "x-test-user": user } : {} })).status).toBe(404);
    expect(m.quality).not.toHaveBeenCalled();
  });
  it("allows a verified allowlisted admin to read only", async () => {
    const r = await fetch(base, { headers: { "x-test-user": "admin" } });
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toMatchObject({ calls: [] });
    expect((await fetch(base, { method: "POST", headers: { "x-test-user": "admin" } })).status).toBe(404);
    expect(m.quality).toHaveBeenCalledOnce();
  });
});
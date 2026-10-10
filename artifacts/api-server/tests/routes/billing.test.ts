import express from "express";
import { createServer, type Server } from "node:http";
import Stripe from "stripe";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  enabled: true, signature: vi.fn(), process: vi.fn(), snapshot: vi.fn(), cancel: vi.fn(),
  resume: vi.fn(), checkout: vi.fn(), upgrade: vi.fn(), portal: vi.fn(), eligibility: vi.fn(), businesses: vi.fn(),
}));
vi.mock("../../src/billing/stripeClient", () => ({
  billingEnabled: () => m.enabled, getBillingStripe: () => ({ webhooks: { constructEvent: m.signature } }),
}));
vi.mock("../../src/billing/runtime", () => ({ billingService: {
  webhook: m.process, snapshot: m.snapshot, cancel: m.cancel, resume: m.resume,
  checkout: m.checkout, upgrade: m.upgrade, portal: m.portal, startupEligibility: m.eligibility,
} }));
vi.mock("../../src/billing/store", () => ({ billingStore: { businesses: m.businesses } }));
vi.mock("@clerk/express", () => ({ getAuth: (req: express.Request) => ({ userId: req.get("x-test-owner") ?? null }) }));
vi.mock("../../src/lib/businessDirectory", () => ({
  findBusinessByClerkUserId: async (user: string) => user === "owner-a" ? { id: 1 } : user === "owner-b" ? { id: 2 } : null,
}));
vi.mock("../../src/middlewares/requireAdmin", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => req.get("x-test-admin") === "yes" ? next() : res.sendStatus(404),
}));
import billingRouter from "../../src/routes/billing";
import { billingWebhook } from "../../src/billing/webhook";
const signing = new Stripe("sk_test_offline_local_signing_only");
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), billingWebhook);
  app.use(express.json()); app.use("/api", billingRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP server did not start");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  vi.clearAllMocks(); m.enabled = true;
  m.snapshot.mockImplementation(async id => ({ businessId: id }));
  m.cancel.mockResolvedValue({ cancelAt: "2026-11-09T10:00:00Z" });
  m.process.mockResolvedValue({ processed: true });
  m.businesses.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  m.signature.mockImplementation((...args: Parameters<typeof signing.webhooks.constructEvent>) => signing.webhooks.constructEvent(...args));
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_offline_local");
});
afterAll(() => vi.unstubAllEnvs());
const ownerHeaders = { "x-test-owner": "owner-a", "content-type": "application/json" };
describe("billing authorization and feature flag", () => {
  it("flag off exposes only availability, no billing data or SDK calls", async () => {
    m.enabled = false;
    expect(await (await fetch(`${base}/billing/availability`)).json()).toEqual({ enabled: false });
    for (const path of ["/billing", "/admin/billing"]) expect((await fetch(base + path, { headers: ownerHeaders })).status).toBe(404);
    expect((await fetch(`${base}/billing/cancel`, { method: "POST", headers: ownerHeaders })).status).toBe(404);
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled(); expect(m.signature).not.toHaveBeenCalled();
  });
  it("owner A cannot read B through query-string selectors", async () => {
    const response = await fetch(`${base}/billing?businessId=2`, { headers: ownerHeaders });
    expect(await response.json()).toEqual({ businessId: 1 }); expect(m.snapshot).toHaveBeenCalledWith(1);
  });
  it.each(["cancel", "resume", "portal"])("rejects forged tenant IDs for %s", async action => {
    expect((await fetch(`${base}/billing/${action}`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ businessId: 2 }) })).status).toBe(400);
    expect(m.cancel).not.toHaveBeenCalled(); expect(m.resume).not.toHaveBeenCalled(); expect(m.portal).not.toHaveBeenCalled();
  });
  it("takes actor and business from verified identity, not the request", async () => {
    expect((await fetch(`${base}/billing/cancel`, { method: "POST", headers: ownerHeaders, body: "{}" })).status).toBe(200);
    expect(m.cancel).toHaveBeenCalledWith(1, "owner-a");
  });
  it("denies signed-out owner data", async () => {
    expect((await fetch(`${base}/billing`)).status).toBe(401); expect(m.snapshot).not.toHaveBeenCalled();
  });
  it("uses the existing admin gate for all-business data and eligibility writes", async () => {
    expect((await fetch(`${base}/admin/billing`, { headers: ownerHeaders })).status).toBe(404);
    expect((await fetch(`${base}/admin/billing/2/startup`, { method: "PATCH", headers: ownerHeaders, body: '{"eligible":true}' })).status).toBe(404);
    expect(m.eligibility).not.toHaveBeenCalled();
    const headers = { ...ownerHeaders, "x-test-admin": "yes" };
    expect((await fetch(`${base}/admin/billing`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/admin/billing/2/startup`, { method: "PATCH", headers, body: '{"eligible":true}' })).status).toBe(200);
    expect(m.eligibility).toHaveBeenCalledWith(2, true, "owner-a");
  });
  it("rejects extra keys instead of accepting owner-supplied eligibility", async () => {
    expect((await fetch(`${base}/billing/checkout`, { method: "POST", headers: ownerHeaders, body: '{"plan":"startup","eligible":true}' })).status).toBe(400);
    expect(m.checkout).not.toHaveBeenCalled();
  });
});
describe("raw-body signed webhook (local HMAC only, no Stripe network)", () => {
  const payload = JSON.stringify({ id: "evt_local", type: "invoice.paid", livemode: false, created: 1791626400, data: { object: { id: "in_local" } } });
  function send(body = payload, signature?: string) {
    return fetch(`${base}/billing/webhook`, { method: "POST", headers: {
      "content-type": "application/json", ...(signature ? { "stripe-signature": signature } : {}),
    }, body });
  }
  const sign = (body = payload) => signing.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_offline_local" });
  it("accepts valid signatures over the original Buffer", async () => {
    expect((await send(payload, sign())).status).toBe(200);
    expect(Buffer.isBuffer(m.signature.mock.calls[0]![0])).toBe(true); expect(m.process).toHaveBeenCalledTimes(1);
  });
  it("returns 401 for missing or invalid signatures", async () => {
    expect((await send()).status).toBe(401); expect((await send(payload, "invalid")).status).toBe(401);
    expect(m.process).not.toHaveBeenCalled();
  });
  it("returns 401 when signed bytes are changed", async () => {
    expect((await send(payload + " ", sign())).status).toBe(401); expect(m.process).not.toHaveBeenCalled();
  });
  it("refuses even correctly signed live events", async () => {
    const live = payload.replace('"livemode":false', '"livemode":true');
    expect((await send(live, sign(live))).status).toBe(401); expect(m.process).not.toHaveBeenCalled();
  });
  it("returns retryable 503 when persistence fails", async () => {
    m.process.mockRejectedValueOnce(new Error("offline mocked DB failure"));
    expect((await send(payload, sign())).status).toBe(503);
  });
  it("flag off does not verify signatures or process events", async () => {
    m.enabled = false; expect((await send(payload, sign())).status).toBe(404);
    expect(m.signature).not.toHaveBeenCalled(); expect(m.process).not.toHaveBeenCalled();
  });
});

import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
  getSettings: vi.fn(),
  setMode: vi.fn(),
  override: vi.fn(),
  reinstate: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@clerk/express", () => ({ getAuth: m.user }));
vi.mock("../../src/middlewares/requireAdmin", () => ({ requireAdmin: m.admin }));
vi.mock("../../src/billing/enforcement", () => ({
  getBillingEnforcementSettings: m.getSettings,
  setBillingEnforcementMode: m.setMode,
  setNeverAutoSuspend: m.override,
  reinstateBillingSuspension: m.reinstate,
  confirmManualInvoiceOverdue: m.confirm,
}));

import router from "../../src/routes/adminBillingEnforcement";

let server: Server;
let url: string;
const settings = () => ({
  mode: "off" as const,
  updatedAt: null,
  updatedBy: null,
  businesses: [{
    businessId: 12,
    businessName: "Example business",
    billingMode: "stripe",
    accountStatus: "suspended",
    neverAutoSuspend: false,
    suspension: { suspendedAt: "2026-10-20T00:00:00.000Z", source: "stripe" as const, invoiceId: "in_exact" },
  }],
  manualInvoices: [],
  dryRunCandidates: [],
  auditLog: [],
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: vi.fn() }; next(); });
  app.use(router);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockReturnValue({ userId: "verified_admin" });
  m.admin.mockImplementation((_req, _res, next) => next());
  m.getSettings.mockResolvedValue(settings());
  m.setMode.mockImplementation(async (mode: string) => ({ mode, changed: true }));
  m.override.mockImplementation(async (_id: number, value: boolean) => ({ neverAutoSuspend: value, changed: true }));
  m.reinstate.mockResolvedValue(true);
  m.confirm.mockResolvedValue({ confirmed: true, confirmedAt: "2026-10-20T00:00:00.000Z", changed: true });
});

const request = (path: string, method = "GET", data?: unknown) => fetch(url + path, {
  method,
  ...(data === undefined ? {} : {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }),
});

describe("admin billing enforcement routes", () => {
  it("returns private settings for the audit, candidates, and account controls", async () => {
    const response = await request("/admin/billing-enforcement");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ mode: "off", businesses: [{ businessId: 12 }] });
  });

  it("uses verified admin identity when changing the global mode", async () => {
    const response = await request("/admin/billing-enforcement/mode", "PATCH", { mode: "enforce" });
    expect(response.status).toBe(200);
    expect(m.setMode).toHaveBeenCalledWith("enforce", "verified_admin");
  });

  it("rejects unexpected fields in global mode updates", async () => {
    const response = await request("/admin/billing-enforcement/mode", "PATCH", { mode: "enforce", enabled: true });
    expect(response.status).toBe(400);
    expect(m.setMode).not.toHaveBeenCalled();
  });

  it("sets a per-account never-auto-suspend override", async () => {
    const response = await request("/admin/billing-enforcement/businesses/12/override", "PATCH", { neverAutoSuspend: true });
    expect(response.status).toBe(200);
    expect(m.override).toHaveBeenCalledWith(12, true, "verified_admin");
  });

  it("reinstates only the recorded enforcement invoice for that account", async () => {
    const response = await request("/admin/billing-enforcement/businesses/12/reinstate", "POST");
    expect(response.status).toBe(200);
    expect(m.reinstate).toHaveBeenCalledWith({
      businessId: 12,
      source: "stripe",
      invoiceId: "in_exact",
      actor: "verified_admin",
      reason: "Admin verified_admin manually reinstated the account.",
    });
  });

  it("confirms manual overdue status using the verified admin", async () => {
    const response = await request("/admin/billing-enforcement/manual-invoices/24/confirm-overdue", "POST");
    expect(response.status).toBe(200);
    expect(m.confirm).toHaveBeenCalledWith(24, "verified_admin");
  });

  it("keeps all endpoints protected by admin authorization", async () => {
    m.admin.mockImplementation((_req, res) => res.sendStatus(404));
    expect((await request("/admin/billing-enforcement")).status).toBe(404);
    expect((await request("/admin/billing-enforcement/mode", "PATCH", { mode: "off" })).status).toBe(404);
    expect(m.setMode).not.toHaveBeenCalled();
  });
});

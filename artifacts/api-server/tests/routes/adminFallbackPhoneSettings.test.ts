import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getDefault: vi.fn(),
  saveDefault: vi.fn(),
  returning: vi.fn(),
  dbUpdate: vi.fn(),
  dbTransaction: vi.fn(),
  txExecute: vi.fn(),
  txInsert: vi.fn(),
  txInsertValues: vi.fn(),
  getSystemAlerts: vi.fn(),
  getHealthCheck: vi.fn(),
  resolveSystemAlert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  businessesTable: {
    id: "businesses.id",
    fallbackPhoneNumber: "businesses.fallback_phone_number",
    retellPhoneNumber: "businesses.retell_phone_number",
    retellPhoneNormalized: "businesses.retell_phone_normalized",
  },
  businessAdminEventsTable: {},
  db: { update: m.dbUpdate, transaction: m.dbTransaction },
  leadInfoFlagsTable: {},
  leadsTable: {},
  pool: { query: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }),
}));
vi.mock("../../src/lib/adminData", () => ({
  getAdminActivity: vi.fn(),
  getAdminBusiness: vi.fn(),
  getAdminOverview: vi.fn(),
}));
vi.mock("../../src/lib/callQuality", () => ({ getAdminCallQuality: vi.fn() }));
vi.mock("../../src/lib/internalBusinesses", () => ({
  createInternalBusiness: vi.fn(),
  internalBusinessDirectory: vi.fn(),
  internalBusinessRecord: vi.fn(),
  InternalBusinessError: class extends Error {},
}));
vi.mock("../../src/lib/appReviewDemo", () => ({
  AppReviewDemoError: class extends Error {},
  getAppReviewDemoStatus: vi.fn(),
  linkAppReviewDemoEmail: vi.fn(),
  resetAppReviewDemo: vi.fn(),
}));
vi.mock("../../src/lib/retellWebhookUrls", () => ({ getAdminRetellWebhookUrls: vi.fn() }));
vi.mock("../../src/lib/fallbackPhoneSettings", () => ({
  DEFAULT_FALLBACK_PHONE_NUMBER: "+18634463029",
  getDefaultFallbackPhoneNumber: m.getDefault,
  saveDefaultFallbackPhoneNumber: m.saveDefault,
}));
vi.mock("../../src/lib/retellSystemAlerts", () => ({
  getAdminRetellSystemAlerts: m.getSystemAlerts,
  getAdminRetellHealthCheck: m.getHealthCheck,
  resolveRetellSystemAlert: m.resolveSystemAlert,
}));
vi.mock("../../src/lib/usPhoneNumber", () => ({
  normalizeUsPhoneNumber: (value: string) => {
    const digits = value.replace(/\D/g, "");
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
  },
}));
vi.mock("../../src/middlewares/requireAdmin", () => ({
  requireAdmin: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.adminUserId = "verified-admin";
    next();
  },
}));

import router from "../../src/routes/admin";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { log: Record<string, unknown> }).log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    next();
  });
  app.use(router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  m.dbTransaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback({
    execute: m.txExecute,
    insert: m.txInsert,
  }));
  m.txExecute.mockResolvedValue({ rows: [] });
  m.txInsert.mockImplementation(() => ({ values: m.txInsertValues }));
  m.txInsertValues.mockResolvedValue(undefined);
  m.getDefault.mockResolvedValue("+18634463029");
  m.saveDefault.mockImplementation(async (phoneNumber: string) => phoneNumber);
  m.dbUpdate.mockImplementation(() => ({
    set: () => ({
      where: () => ({ returning: m.returning }),
    }),
  }));
  m.returning.mockResolvedValue([{ fallbackPhoneNumber: "+16505550123" }]);
  m.getSystemAlerts.mockResolvedValue({ alerts: [], openCount: 0 });
  m.getHealthCheck.mockResolvedValue({
    lastPreCallSuccessfulAt: null,
    lastPostCallSuccessfulAt: null,
    lastSuccessfulLeadEmailAt: null,
    openAlertCount: 0,
    openAlerts: [],
  });
  m.resolveSystemAlert.mockResolvedValue(true);
});

describe("admin fallback phone settings routes", () => {
  it("rejects non-E.164 Retell numbers before touching the database", async () => {
    const response = await fetch(`${baseUrl}/admin/businesses/44/retell-phone-number`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retellPhoneNumber: "+1 (435) 324-5513" }),
    });
    expect(response.status).toBe(400);
    expect(m.dbTransaction).not.toHaveBeenCalled();
  });

  it("updates an assigned number only after the UI confirmation and records before/after values", async () => {
    m.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 44, retellPhoneNumber: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await fetch(`${baseUrl}/admin/businesses/44/retell-phone-number`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retellPhoneNumber: "+14353245513" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      businessId: 44,
      retellPhoneNumber: "+14353245513",
      changed: true,
    });
    expect(m.txInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 44,
      actorUserId: "verified-admin",
      action: "retell_phone_number_changed",
      previousValue: null,
      newValue: "+14353245513",
    }));
  });

  it("refuses a number already assigned to another business without writing an audit event", async () => {
    m.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 44, retellPhoneNumber: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const response = await fetch(`${baseUrl}/admin/businesses/44/retell-phone-number`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retellPhoneNumber: "+14353245513" }),
    });
    expect(response.status).toBe(409);
    expect(m.txExecute).toHaveBeenCalledTimes(3);
    expect(m.txInsertValues).not.toHaveBeenCalled();
  });

  it("returns a conflict if the database unique index catches a concurrent assignment", async () => {
    m.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 44, retellPhoneNumber: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error("unique constraint"), { code: "23505" }));
    const response = await fetch(`${baseUrl}/admin/businesses/44/retell-phone-number`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retellPhoneNumber: "+14353245513" }),
    });
    expect(response.status).toBe(409);
    expect(m.txInsertValues).not.toHaveBeenCalled();
  });

  it("serves the prefilled global default", async () => {
    const response = await fetch(`${baseUrl}/admin/fallback-phone-settings`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ defaultFallbackPhoneNumber: "+18634463029" });
  });

  it("normalizes and stores the global fallback as E.164", async () => {
    const response = await fetch(`${baseUrl}/admin/fallback-phone-settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultFallbackPhoneNumber: "(650) 555-0123" }),
    });
    expect(response.status).toBe(200);
    expect(m.saveDefault).toHaveBeenCalledExactlyOnceWith("+16505550123");
    expect(await response.json()).toEqual({ defaultFallbackPhoneNumber: "+16505550123" });
  });

  it("rejects non-US default numbers", async () => {
    const response = await fetch(`${baseUrl}/admin/fallback-phone-settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultFallbackPhoneNumber: "+44 20 7946 0958" }),
    });
    expect(response.status).toBe(400);
    expect(m.saveDefault).not.toHaveBeenCalled();
  });

  it("normalizes a business-specific override and resolves it over the global default", async () => {
    const response = await fetch(`${baseUrl}/admin/businesses/44/fallback-phone`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackPhoneNumber: "+1 (650) 555-0123" }),
    });
    expect(response.status).toBe(200);
    expect(m.dbUpdate.mock.results[0]?.value).toBeDefined();
    expect(await response.json()).toEqual({
      overridePhoneNumber: "+16505550123",
      resolvedPhoneNumber: "+16505550123",
      defaultPhoneNumber: "+18634463029",
    });
  });

  it("clears the business override and returns the global default", async () => {
    m.returning.mockResolvedValueOnce([{ fallbackPhoneNumber: null }]);
    const response = await fetch(`${baseUrl}/admin/businesses/44/fallback-phone`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackPhoneNumber: null }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      overridePhoneNumber: null,
      resolvedPhoneNumber: "+18634463029",
      defaultPhoneNumber: "+18634463029",
    });
  });

  it("serves private Retell system-alert and health-check data", async () => {
    const alert = {
      id: 7,
      endpoint: "post-call",
      category: "post_call_processing_error",
      summary: "Post-call webhook processing failed",
      details: "Database unavailable",
      businessId: null,
      businessName: null,
      firstSeenAt: "2026-11-03T12:00:00.000Z",
      lastSeenAt: "2026-11-03T12:00:00.000Z",
      occurrenceCount: 1,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
    };
    m.getSystemAlerts.mockResolvedValue({ alerts: [alert], openCount: 1 });
    m.getHealthCheck.mockResolvedValue({
      lastPreCallSuccessfulAt: "2026-11-03T11:00:00.000Z",
      lastPostCallSuccessfulAt: null,
      lastSuccessfulLeadEmailAt: "2026-11-03T10:45:00.000Z",
      openAlertCount: 1,
      openAlerts: [alert],
    });

    const alerts = await fetch(`${baseUrl}/admin/system-alerts`);
    expect(alerts.status).toBe(200);
    expect(await alerts.json()).toEqual({ alerts: [alert], openCount: 1 });
    expect(alerts.headers.get("cache-control")).toContain("no-store");

    const health = await fetch(`${baseUrl}/admin/health-check`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      lastPreCallSuccessfulAt: "2026-11-03T11:00:00.000Z",
      lastPostCallSuccessfulAt: null,
      lastSuccessfulLeadEmailAt: "2026-11-03T10:45:00.000Z",
      openAlertCount: 1,
      openAlerts: [alert],
    });
  });

  it("validates and resolves open system alerts", async () => {
    const invalid = await fetch(`${baseUrl}/admin/system-alerts/nope/resolve`, { method: "PATCH" });
    expect(invalid.status).toBe(400);
    expect(m.resolveSystemAlert).not.toHaveBeenCalled();

    m.resolveSystemAlert.mockResolvedValueOnce(false);
    const missing = await fetch(`${baseUrl}/admin/system-alerts/12/resolve`, { method: "PATCH" });
    expect(missing.status).toBe(404);

    const resolved = await fetch(`${baseUrl}/admin/system-alerts/12/resolve`, { method: "PATCH" });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({ resolved: true });
    expect(m.resolveSystemAlert).toHaveBeenLastCalledWith(12, "admin");
  });
});

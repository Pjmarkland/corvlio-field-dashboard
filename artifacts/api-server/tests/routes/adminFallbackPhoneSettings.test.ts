import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getDefault: vi.fn(),
  saveDefault: vi.fn(),
  returning: vi.fn(),
  dbUpdate: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  businessesTable: { id: "businesses.id", fallbackPhoneNumber: "businesses.fallback_phone_number" },
  db: { update: m.dbUpdate },
  leadInfoFlagsTable: {},
  leadsTable: {},
  pool: { query: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
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
vi.mock("../../src/lib/usPhoneNumber", () => ({
  normalizeUsPhoneNumber: (value: string) => {
    const digits = value.replace(/\D/g, "");
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
  },
}));
vi.mock("../../src/middlewares/requireAdmin", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
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
  m.getDefault.mockResolvedValue("+18634463029");
  m.saveDefault.mockImplementation(async (phoneNumber: string) => phoneNumber);
  m.dbUpdate.mockImplementation(() => ({
    set: () => ({
      where: () => ({ returning: m.returning }),
    }),
  }));
  m.returning.mockResolvedValue([{ fallbackPhoneNumber: "+16505550123" }]);
});

describe("admin fallback phone settings routes", () => {
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
});

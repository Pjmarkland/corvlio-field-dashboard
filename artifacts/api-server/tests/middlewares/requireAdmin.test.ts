import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const clerkMocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUser: vi.fn(),
  audit: vi.fn(),
  consume: vi.fn(),
  identity: "signed-out" as "signed-out" | "owner" | "lookalike" | "admin",
}));

vi.mock("@clerk/express", () => ({
  getAuth: clerkMocks.getAuth,
  clerkClient: { users: { getUser: clerkMocks.getUser } },
}));

import {
  createRequireAdmin,
  getPrimaryVerifiedAdminEmail,
  hasVerifiedAdminEmail,
  parseAdminEmails,
} from "../../src/middlewares/requireAdmin";
import type { RateLimitResult } from "../../src/middlewares/requestRateLimit";

const resetAt = () => new Date(Date.now() + 60_000);
const testEmail = {
  id: "email-primary",
  emailAddress: "founder@example.test",
  verification: { status: "verified" },
};

function testGuard() {
  return createRequireAdmin({
    consume: clerkMocks.consume,
    getUser: clerkMocks.getUser,
    audit: clerkMocks.audit,
  });
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  const guard = testGuard();
  const knownRoutes = new Set([
    "/api/admin",
    "/api/admin/overview",
    "/api/admin/activity",
    "/api/admin/system-alerts",
    "/api/admin/system-alerts/1/resolve",
    "/api/admin/health-check",
    "/api/admin/retell-webhook-urls",
    "/api/admin/internal-businesses",
    "/api/admin/internal-businesses/1",
    "/api/admin/app-review-demo",
    "/api/admin/app-review-demo/reset",
    "/api/admin/app-review-demo/link",
    "/api/admin/businesses/1",
    "/api/admin/businesses/1/fallback-phone",
    "/api/admin/businesses/1/managed-reports",
    "/api/admin/flagged-leads",
    "/api/admin/lead-information-flags/1/resolve",
    "/api/admin/call-quality",
    "/api/admin/email-health",
    "/api/admin/email-health/test",
    "/api/admin/email-health/retry",
    "/api/admin/sms/messages",
    "/api/admin/sms/test",
    "/api/admin/pending-releases",
    "/api/admin/pending-releases/1/complete",
    "/api/admin/invoicing",
    "/api/admin/invoicing/settings",
    "/api/admin/invoicing/1/approve-startup",
    "/api/admin/invoicing/1/plan",
    "/api/admin/invoicing/1/activate",
    "/api/admin/invoicing/invoices/1/paid",
    "/api/admin/billing",
    "/api/admin/billing/readiness-check",
    "/api/admin/billing/1/startup",
  ]);

  app.use("/api/admin", guard, (req, res) => {
    if (knownRoutes.has(req.originalUrl.split("?")[0])) {
      res.status(200).json({ ok: true });
      return;
    }
    res.status(404).json({ error: "Not found" });
  });
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
  vi.stubEnv("ADMIN_EMAILS", "Founder@Example.Test");
  clerkMocks.identity = "signed-out";
  clerkMocks.getAuth.mockImplementation(() => ({
    userId: clerkMocks.identity === "signed-out" ? null : `user-${clerkMocks.identity}`,
  }));
  clerkMocks.getUser.mockImplementation(async () => {
    if (clerkMocks.identity === "admin") {
      return { primaryEmailAddressId: "email-primary", emailAddresses: [testEmail] };
    }
    if (clerkMocks.identity === "lookalike") {
      return {
        primaryEmailAddressId: "email-primary",
        emailAddresses: [{ ...testEmail, emailAddress: "founder+attacker@example.test" }],
      };
    }
    return {
      primaryEmailAddressId: "owner-primary",
      emailAddresses: [
        { ...testEmail, id: "owner-primary", emailAddress: "owner@example.test" },
        testEmail,
      ],
    };
  });
  clerkMocks.audit.mockResolvedValue(undefined);
  clerkMocks.consume.mockImplementation(async (): Promise<RateLimitResult> => ({
    count: 1,
    resetAt: resetAt(),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("central admin authorization", () => {
  it("normalizes allowlist casing and requires the verified primary email to match exactly", () => {
    const allowed = parseAdminEmails(" Founder@Example.Test, , ops@example.test ");
    expect([...allowed]).toEqual(["founder@example.test", "ops@example.test"]);
    expect(getPrimaryVerifiedAdminEmail("email-primary", [testEmail], allowed))
      .toBe("founder@example.test");
    expect(getPrimaryVerifiedAdminEmail("other-id", [testEmail], allowed)).toBeNull();
    expect(getPrimaryVerifiedAdminEmail("email-primary", [
      { ...testEmail, verification: { status: "unverified" } },
    ], allowed)).toBeNull();
    expect(getPrimaryVerifiedAdminEmail("email-primary", [
      { ...testEmail, emailAddress: "founder+attacker@example.test" },
    ], allowed)).toBeNull();
    expect(hasVerifiedAdminEmail([testEmail], allowed)).toBe(true);
  });

  it.each(["signed-out", "owner", "lookalike"] as const)(
    "%s receives the same generic 404 on every admin route and an unknown path",
    async (identity) => {
      clerkMocks.identity = identity;
      const paths = [
        "/api/admin",
        "/api/admin/overview",
        "/api/admin/activity",
        "/api/admin/system-alerts",
        "/api/admin/system-alerts/1/resolve",
        "/api/admin/health-check",
        "/api/admin/retell-webhook-urls",
        "/api/admin/internal-businesses",
        "/api/admin/internal-businesses/1",
        "/api/admin/app-review-demo",
        "/api/admin/app-review-demo/reset",
        "/api/admin/app-review-demo/link",
        "/api/admin/businesses/1",
        "/api/admin/businesses/1/fallback-phone",
        "/api/admin/businesses/1/managed-reports",
        "/api/admin/flagged-leads",
        "/api/admin/lead-information-flags/1/resolve",
        "/api/admin/call-quality",
        "/api/admin/email-health",
        "/api/admin/email-health/test",
        "/api/admin/email-health/retry",
        "/api/admin/sms/messages",
        "/api/admin/sms/test",
        "/api/admin/pending-releases",
        "/api/admin/pending-releases/1/complete",
        "/api/admin/invoicing",
        "/api/admin/invoicing/settings",
        "/api/admin/invoicing/1/approve-startup",
        "/api/admin/invoicing/1/plan",
        "/api/admin/invoicing/1/activate",
        "/api/admin/invoicing/invoices/1/paid",
        "/api/admin/billing",
        "/api/admin/billing/readiness-check",
        "/api/admin/billing/1/startup",
      ];
      const unknown = await fetch(`${baseUrl}/api/admin/does-not-exist`);
      const expectedBody = await unknown.json();
      expect(unknown.status).toBe(404);
      expect(expectedBody).toEqual({ error: "Not found" });

      for (const path of paths) {
        const method = /\/(reset|link|resolve|test|complete|approve-startup|activate|paid|readiness-check)$/.test(path)
          || /\/(plan|startup|fallback-phone|managed-reports)$/.test(path)
          ? "POST"
          : "GET";
        const response = await fetch(`${baseUrl}${path}`, { method });
        expect(response.status, `${identity} ${method} ${path}`).toBe(404);
        expect(await response.json(), `${identity} ${method} ${path}`).toEqual(expectedBody);
      }
      expect(clerkMocks.audit).toHaveBeenCalled();
    },
  );

  it("allows the verified primary admin and audits access and writes without storing email", async () => {
    clerkMocks.identity = "admin";
    const read = await fetch(`${baseUrl}/api/admin/overview`);
    expect(read.status).toBe(200);

    const write = await fetch(`${baseUrl}/api/admin/businesses/42/managed-reports`, { method: "PATCH" });
    expect(write.status).toBe(200);
    expect(clerkMocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user-admin",
      action: "access",
      route: "/api/admin/overview",
    }));
    expect(clerkMocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user-admin",
      action: "write",
      route: "/api/admin/businesses/42/managed-reports",
      businessId: 42,
    }));
    expect(JSON.stringify(clerkMocks.audit.mock.calls)).not.toContain("founder@example.test");
  });

  it("returns 429 when either the user or IP bucket exceeds its limit", async () => {
    clerkMocks.identity = "admin";
    clerkMocks.consume.mockImplementation(async (key: string): Promise<RateLimitResult> => ({
      count: key.includes(":user:") ? 61 : 1,
      resetAt: resetAt(),
    }));
    const response = await fetch(`${baseUrl}/api/admin/overview`);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(await response.json()).toEqual({ error: "Too many requests" });
    expect(clerkMocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "rate_limited" }));
  });
});


import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  link: vi.fn(),
  getStatus: vi.fn(),
  reset: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: { get: (name: string) => string | undefined }) => ({
    userId: req.get("x-test-user") ?? null,
  }),
  clerkClient: { users: { getUser: m.getUser } },
}));
vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
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
  AppReviewDemoError: class extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.status = status;
    }
  },
  getAppReviewDemoStatus: m.getStatus,
  linkAppReviewDemoEmail: m.link,
  resetAppReviewDemo: m.reset,
}));

import router from "../../src/routes/admin";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { log: Record<string, unknown> }).log = {
      info: m.info,
      error: vi.fn(),
      warn: vi.fn(),
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
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_EMAILS", "admin@example.test");
  m.getUser.mockImplementation(async (userId: string) => ({
    primaryEmailAddressId: "primary",
    emailAddresses: [{
      id: "primary",
      emailAddress: userId === "admin-user" ? " ADMIN@example.test " : "outsider@example.test",
      verification: { status: "verified" },
    }],
  }));
  m.link.mockResolvedValue({
    exists: true,
    businessId: 52,
    businessName: "App Review Demo",
    ownerEmail: "reviewer@example.test",
    linked: true,
    leadCount: 8,
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function postLink(userId: string, body: unknown) {
  return fetch(`${baseUrl}/admin/app-review-demo/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user": userId,
    },
    body: JSON.stringify(body),
  });
}

describe("App Review Demo admin link route", () => {
  it("does not allow a non-admin to use the override", async () => {
    const response = await postLink("outsider-user", {
      email: "reviewer@example.test",
      allowUnverifiedEmail: true,
    });

    expect(response.status).toBe(404);
    expect(m.link).not.toHaveBeenCalled();
    expect(m.info).not.toHaveBeenCalled();
  });

  it("passes the explicit override and writes one structured audit line", async () => {
    const response = await postLink("admin-user", {
      email: " Reviewer@Example.test ",
      allowUnverifiedEmail: true,
    });

    expect(response.status).toBe(200);
    expect(m.link).toHaveBeenCalledExactlyOnceWith("Reviewer@Example.test", true);
    expect(m.info).toHaveBeenCalledExactlyOnceWith({
      adminEmail: "admin@example.test",
      targetEmail: "reviewer@example.test",
      result: "linked",
    }, "App Review Demo unverified email override used");
  });

  it("defaults omitted override input to verified-only and does not audit it", async () => {
    const response = await postLink("admin-user", { email: "reviewer@example.test" });

    expect(response.status).toBe(200);
    expect(m.link).toHaveBeenCalledExactlyOnceWith("reviewer@example.test", false);
    expect(m.info).not.toHaveBeenCalled();
  });

  it("audits a failed override attempt exactly once", async () => {
    m.link.mockRejectedValue(new Error("service unavailable"));
    const response = await postLink("admin-user", {
      email: "reviewer@example.test",
      allowUnverifiedEmail: true,
    });

    expect(response.status).toBe(503);
    expect(m.info).toHaveBeenCalledExactlyOnceWith({
      adminEmail: "admin@example.test",
      targetEmail: "reviewer@example.test",
      result: "error",
    }, "App Review Demo unverified email override used");
  });
});

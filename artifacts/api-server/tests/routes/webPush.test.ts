import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findBusiness: vi.fn(),
  getConfig: vi.fn(),
  register: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.get("x-test-user") || null }),
}));
vi.mock("../../src/lib/businessDirectory", () => ({
  findBusinessByClerkUserId: mocks.findBusiness,
}));
vi.mock("../../src/lib/webPushService", () => ({
  getWebPushPublicConfig: mocks.getConfig,
  registerWebPushSubscription: mocks.register,
  revokeWebPushSubscription: mocks.revoke,
  WebPushConfigurationError: class WebPushConfigurationError extends Error {},
}));

import webPushRouter from "../../src/routes/webPush";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() } as unknown as typeof req.log;
    next();
  });
  app.use(webPushRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findBusiness.mockResolvedValue({ id: 7, leadAlertsEnabled: true });
  mocks.getConfig.mockReturnValue({ available: true, publicKey: "public-test-key" });
  mocks.register.mockResolvedValue(true);
  mocks.revoke.mockResolvedValue(undefined);
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  user = "owner-a",
) {
  return fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/example",
  keys: { p256dh: "browser-public-key", auth: "browser-auth-key" },
  expirationTime: null,
};

describe("Web Push subscription routes", () => {
  it("requires a signed-in owner and returns no-store configuration", async () => {
    expect((await request("/web-push/config", "GET", undefined, "")).status).toBe(401);
    expect(mocks.findBusiness).not.toHaveBeenCalled();

    const response = await request("/web-push/config");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ available: true, publicKey: "public-test-key" });
    expect(mocks.findBusiness).toHaveBeenCalledWith("owner-a");
  });

  it("derives Clerk ownership and business ID instead of accepting client ownership", async () => {
    const response = await request("/web-push-subscriptions", "POST", subscription);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registered: true });
    expect(mocks.register).toHaveBeenCalledWith({
      clerkUserId: "owner-a",
      businessId: 7,
      subscription,
    });

    const rejected = await request("/web-push-subscriptions", "POST", {
      ...subscription,
      businessId: 8,
    });
    expect(rejected.status).toBe(400);
    expect(mocks.register).toHaveBeenCalledOnce();
  });

  it("rejects non-provider endpoints and reports endpoint ownership conflicts", async () => {
    expect((await request("/web-push-subscriptions", "POST", {
      ...subscription,
      endpoint: "https://example.com/private-resource",
    })).status).toBe(400);

    mocks.register.mockResolvedValue(false);
    expect((await request("/web-push-subscriptions", "POST", subscription)).status).toBe(409);
  });

  it("revokes only the signed-in owner's subscription for the resolved business", async () => {
    const response = await request("/web-push-subscriptions", "DELETE", { endpoint: subscription.endpoint });
    expect(response.status).toBe(204);
    expect(mocks.revoke).toHaveBeenCalledWith({
      clerkUserId: "owner-a",
      businessId: 7,
      endpoint: subscription.endpoint,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification,
  },
}));

import {
  enqueueWebPushDeliveries,
  getWebPushPublicConfig,
  getWebPushReadiness,
  processWebPushOutbox,
  registerWebPushSubscription,
} from "../../src/lib/webPushService";

const delivery = {
  delivery_id: 11,
  attempts: 1,
  event_id: 22,
  title: "New lead from Alex",
  body: "Leaking pipe · Callback: +15550000001",
  deep_link: "/leads/33",
  endpoint: "https://fcm.googleapis.com/fcm/send/test-subscription",
  p256dh: "public-browser-key",
  auth: "browser-auth-secret",
  expiration_at: null,
  lead_alerts_enabled: true,
  is_sample: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.sendNotification.mockResolvedValue({ statusCode: 201 });
});

afterEach(() => vi.unstubAllEnvs());

describe("business-scoped Web Push", () => {
  it("requires both VAPID keys and a valid subject before reporting readiness", () => {
    expect(getWebPushPublicConfig()).toEqual({ available: false, publicKey: null });
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-test-key");
    expect(() => getWebPushPublicConfig()).toThrow(/Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/);
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-test-key");
    expect(() => getWebPushPublicConfig()).toThrow(/VAPID_SUBJECT/);
    expect(getWebPushReadiness()).toEqual({
      configured: false,
      publicKeyPresent: true,
      privateKeyPresent: true,
      subjectPresent: false,
      subjectValid: false,
    });
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test");
    expect(getWebPushPublicConfig()).toEqual({ available: true, publicKey: "public-test-key" });
    expect(getWebPushReadiness().configured).toBe(true);
    expect(getWebPushReadiness()).not.toHaveProperty("publicKey");
    expect(getWebPushReadiness()).not.toHaveProperty("privateKey");
  });

  it("queues a new event only for subscriptions attached to its business", async () => {
    const tx = { execute: vi.fn().mockResolvedValue(undefined) };
    await enqueueWebPushDeliveries(tx, 22, 7);
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0][0]);
    expect(query.sql).toContain("FROM web_push_subscriptions s");
    expect(query.sql).toContain("s.business_id::text");
    expect(query.params).toEqual([22, "7"]);
    expect(query.sql).toContain("ON CONFLICT (event_id, subscription_id) DO NOTHING");
  });

  it("registers an endpoint only for the same existing user and business", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-test-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-test-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test");
    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });
    const registered = await registerWebPushSubscription({
      clerkUserId: "owner-a",
      businessId: 7,
      subscription: {
        endpoint: delivery.endpoint,
        keys: { p256dh: "browser-key", auth: "browser-auth" },
        expirationTime: null,
      },
    });
    expect(registered).toBe(true);
    expect(mocks.query.mock.calls[0][0]).toContain(
      "WHERE web_push_subscriptions.clerk_user_id = EXCLUDED.clerk_user_id",
    );
    expect(mocks.query.mock.calls[0][1]).toEqual([
      "owner-a", 7, delivery.endpoint, "browser-key", "browser-auth", null,
    ]);

    mocks.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await registerWebPushSubscription({
      clerkUserId: "owner-b",
      businessId: 8,
      subscription: { endpoint: delivery.endpoint, keys: { p256dh: "k", auth: "a" } },
    })).toBe(false);
  });

  it("delivers the event payload to a matching business subscription", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-test-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-test-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test");
    mocks.query.mockImplementation(async (query: string) => query.includes("WITH due AS")
      ? { rowCount: 1, rows: [delivery] }
      : { rowCount: 1, rows: [] });

    await processWebPushOutbox();

    expect(mocks.setVapidDetails).toHaveBeenCalledOnce();
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
      JSON.stringify({ title: delivery.title, body: delivery.body, deepLink: delivery.deep_link }),
      { TTL: 60, urgency: "high" },
    );
    expect(mocks.query.mock.calls.some(([query, params]) =>
      String(query).includes("SET status = $2, delivered_at = now()")
      && (params as unknown[])[1] === "delivered",
    )).toBe(true);
  });

  it("prunes provider-expired subscriptions and retries temporary failures", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-test-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-test-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test");
    mocks.query.mockImplementation(async (query: string) => query.includes("WITH due AS")
      ? { rowCount: 1, rows: [delivery] }
      : { rowCount: 1, rows: [] });

    mocks.sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    await processWebPushOutbox();
    expect(mocks.query.mock.calls.some(([query, params]) =>
      String(query).includes("DELETE FROM web_push_subscriptions WHERE endpoint = $1")
      && (params as unknown[])[0] === delivery.endpoint,
    )).toBe(true);

    vi.clearAllMocks();
    mocks.query.mockImplementation(async (query: string) => query.includes("WITH due AS")
      ? { rowCount: 1, rows: [delivery] }
      : { rowCount: 1, rows: [] });
    mocks.sendNotification.mockRejectedValueOnce(Object.assign(new Error("temporarily unavailable"), { statusCode: 503 }));
    await processWebPushOutbox();
    expect(mocks.query.mock.calls.some(([query, params]) =>
      String(query).includes("SET status = $2, next_attempt_at")
      && (params as unknown[])[1] === "queued"
      && (params as unknown[])[2] === 60_000,
    )).toBe(true);
  });

  it("marks a business-mismatched event as ineligible for delivery", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-test-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-test-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test");
    const mismatched = { ...delivery, lead_alerts_enabled: false };
    mocks.query.mockImplementation(async (query: string) => query.includes("WITH due AS")
      ? { rowCount: 1, rows: [mismatched] }
      : { rowCount: 1, rows: [] });
    await processWebPushOutbox();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([query, params]) =>
      String(query).includes("SET status = $2, claim_until = NULL")
      && (params as unknown[])[1] === "skipped",
    )).toBe(true);
  });
});

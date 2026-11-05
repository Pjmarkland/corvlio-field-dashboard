import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const alertTable = {
    issueKey: { name: "issue_key" },
    occurrenceCount: { name: "occurrence_count" },
    lastNotifiedAt: { name: "last_notified_at" },
    endpoint: { name: "endpoint" },
    lastSeenAt: { name: "last_seen_at" },
    id: { name: "id" },
    resolvedAt: { name: "resolved_at" },
  };
  const healthTable = {
    endpoint: { name: "endpoint" },
    lastSuccessfulAt: { name: "last_successful_at" },
    updatedAt: { name: "updated_at" },
  };
  const notificationTable = {
    emailStatus: { name: "email_status" },
    emailDeliveredAt: { name: "email_delivered_at" },
  };
  const builder = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  builder.values.mockReturnThis();
  builder.onConflictDoUpdate.mockReturnThis();
  return {
    alertTable,
    healthTable,
    notificationTable,
    builder,
    dbInsert: vi.fn(() => builder),
    dbSelect: vi.fn(),
    healthRows: [] as Array<{ endpoint: string; lastSuccessfulAt: Date | null }>,
    openAlerts: [] as Array<Record<string, unknown>>,
    openCount: 0,
    emailDeliveredAt: null as Date | null,
    returningAt: null as Date | null,
    returningNotify: true,
    recordOperationalFailure: vi.fn(),
    queueFounderPushNotification: vi.fn(),
    getWebPushReadiness: vi.fn(),
    runNotificationOutboxNow: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: { insert: mocks.dbInsert, select: mocks.dbSelect },
  retellSystemAlertsTable: mocks.alertTable,
  retellWebhookHealthTable: mocks.healthTable,
  notificationEventsTable: mocks.notificationTable,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }),
}));

vi.mock("../../src/lib/operationalFailures", () => ({
  recordOperationalFailure: mocks.recordOperationalFailure,
  queueFounderPushNotification: mocks.queueFounderPushNotification,
}));

vi.mock("../../src/lib/webPushService", () => ({
  getWebPushReadiness: mocks.getWebPushReadiness,
}));

vi.mock("../../src/lib/notificationService", () => ({
  runNotificationOutboxNow: mocks.runNotificationOutboxNow,
}));

vi.mock("../../src/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
}));

import { getAdminRetellHealthCheck, recordRetellSystemAlert } from "../../src/lib/retellSystemAlerts";

const alertInput = {
  issueKey: "retell:pre-call:business-lookup-timeout",
  endpoint: "pre-call" as const,
  category: "pre_call_timeout",
  summary: "Pre-call lookup timed out",
  details: "Database lookup exceeded the deadline",
  source: "pre_call_fallback" as const,
};

async function flushDelivery() {
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

describe("Retell system alert notification throttling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returningAt = null;
    mocks.returningNotify = true;
    mocks.healthRows = [];
    mocks.openAlerts = [];
    mocks.openCount = 0;
    mocks.emailDeliveredAt = null;
    mocks.dbSelect.mockImplementation((projection?: unknown) => ({
      from: (table: unknown) => {
        if (table === mocks.healthTable) return Promise.resolve(mocks.healthRows);
        if (table === mocks.notificationTable) {
          return { where: async () => [{ emailDeliveredAt: mocks.emailDeliveredAt }] };
        }
        if (projection) return { where: async () => [{ count: mocks.openCount }] };
        return {
          where: () => ({
            orderBy: () => ({ limit: async () => mocks.openAlerts }),
          }),
        };
      },
    }));
    mocks.builder.returning.mockImplementation(async () => [{
      lastNotifiedAt: mocks.returningAt ?? new Date(),
      shouldNotify: mocks.returningNotify,
    }]);
    mocks.recordOperationalFailure.mockResolvedValue(true);
    mocks.queueFounderPushNotification.mockResolvedValue(true);
    mocks.getWebPushReadiness.mockReturnValue({ configured: true });
    mocks.runNotificationOutboxNow.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores allowlisted alert text without phone numbers or email addresses", async () => {
    await recordRetellSystemAlert({
      ...alertInput,
      summary: "Caller +1 (415) 555-0199 asked for a reply at caller@example.test",
      details: "Database lookup failed for +1 (415) 555-0199; caller@example.test",
    });
    const firstNotificationTime = new Date();
    await flushDelivery();

    expect(mocks.builder.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      target: mocks.alertTable.issueKey,
    }));
    const stored = mocks.builder.values.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      category: "pre_call_timeout",
      summary: "Retell pre-call lookup timed out; fallback response used",
      details: "The pre-call lookup exceeded its response window and used a generic fallback.",
    });
    expect(JSON.stringify(stored)).not.toMatch(/\+1 \(415\) 555-0199|caller@example\.test/);
    expect(mocks.recordOperationalFailure).toHaveBeenCalledTimes(1);
    expect(mocks.queueFounderPushNotification).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.recordOperationalFailure.mock.calls)).not.toMatch(/\+1 \(415\) 555-0199|caller@example\.test/);
    expect(JSON.stringify(mocks.queueFounderPushNotification.mock.calls)).not.toMatch(/\+1 \(415\) 555-0199|caller@example\.test/);

    mocks.returningAt = firstNotificationTime;
    mocks.returningNotify = false;
    await recordRetellSystemAlert({ ...alertInput, details: "Repeated lookup failure" });
    await flushDelivery();

    expect(mocks.builder.values).toHaveBeenCalledTimes(2);
    expect(mocks.recordOperationalFailure).toHaveBeenCalledTimes(1);
    expect(mocks.queueFounderPushNotification).toHaveBeenCalledTimes(1);

    mocks.returningAt = new Date(firstNotificationTime.getTime() + 15 * 60_000);
    mocks.returningNotify = true;
    await recordRetellSystemAlert({ ...alertInput, details: "Lookup failure after cooldown" });
    await flushDelivery();

    expect(mocks.recordOperationalFailure).toHaveBeenCalledTimes(2);
    expect(mocks.queueFounderPushNotification).toHaveBeenCalledTimes(2);
    const eventKeys = mocks.recordOperationalFailure.mock.calls.map(([input]) => input.eventKey);
    expect(eventKeys[0]).not.toBe(eventKeys[1]);
  });

  it("still records alerts when browser push is not configured and skips the push queue", async () => {
    mocks.getWebPushReadiness.mockReturnValue({ configured: false });
    await recordRetellSystemAlert(alertInput);
    await flushDelivery();

    expect(mocks.recordOperationalFailure).toHaveBeenCalledOnce();
    expect(mocks.queueFounderPushNotification).not.toHaveBeenCalled();
    expect(mocks.runNotificationOutboxNow).toHaveBeenCalledOnce();
  });

  it("uses the same 15-minute dedupe window and admin email path for Stripe webhook errors", async () => {
    const stripeInput = {
      issueKey: "stripe:webhook:processing:invoice.paid",
      endpoint: "stripe" as const,
      category: "stripe_processing_error",
      summary: "ignored caller-provided summary",
      details: "ignored caller-provided details",
      source: "stripe_webhook" as const,
    };
    await recordRetellSystemAlert(stripeInput);
    const firstNotificationTime = new Date();
    await flushDelivery();

    const stored = mocks.builder.values.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      endpoint: "stripe",
      category: "stripe_processing_error",
      summary: "Stripe webhook processing failed",
      details: "A verified Stripe event could not be processed. Stripe received a retryable error response.",
    });
    expect(mocks.recordOperationalFailure).toHaveBeenCalledWith(expect.objectContaining({
      source: "stripe_webhook",
      summary: "Stripe webhook processing failed",
    }));
    expect(mocks.runNotificationOutboxNow).toHaveBeenCalledOnce();

    mocks.returningAt = firstNotificationTime;
    mocks.returningNotify = false;
    await recordRetellSystemAlert(stripeInput);
    await flushDelivery();
    expect(mocks.recordOperationalFailure).toHaveBeenCalledOnce();

    mocks.returningAt = new Date(firstNotificationTime.getTime() + 15 * 60_000);
    mocks.returningNotify = true;
    await recordRetellSystemAlert(stripeInput);
    await flushDelivery();
    expect(mocks.recordOperationalFailure).toHaveBeenCalledTimes(2);
  });

  it("returns the last successful lead-email delivery time for the admin health check", async () => {
    const preCallAt = new Date("2026-11-03T11:00:00.000Z");
    const leadEmailAt = new Date("2026-11-03T11:15:00.000Z");
    mocks.healthRows = [{ endpoint: "pre-call", lastSuccessfulAt: preCallAt }];
    mocks.emailDeliveredAt = leadEmailAt;
    mocks.openCount = 0;

    await expect(getAdminRetellHealthCheck()).resolves.toMatchObject({
      lastPreCallSuccessfulAt: preCallAt.toISOString(),
      lastPostCallSuccessfulAt: null,
      lastSuccessfulLeadEmailAt: leadEmailAt.toISOString(),
      openAlertCount: 0,
      openAlerts: [],
    });
  });
});

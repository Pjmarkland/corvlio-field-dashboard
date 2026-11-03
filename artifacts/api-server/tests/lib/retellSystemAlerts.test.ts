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
    builder,
    dbInsert: vi.fn(() => builder),
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
  db: { insert: mocks.dbInsert },
  retellSystemAlertsTable: mocks.alertTable,
  retellWebhookHealthTable: mocks.healthTable,
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

import { recordRetellSystemAlert } from "../../src/lib/retellSystemAlerts";

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

  it("stores a single aggregated issue and only queues one notification inside 15 minutes", async () => {
    await recordRetellSystemAlert({ ...alertInput, details: "Database lookup failed\nBearer secret-value" });
    const firstNotificationTime = new Date();
    await flushDelivery();

    expect(mocks.builder.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      target: mocks.alertTable.issueKey,
    }));
    expect(mocks.builder.values.mock.calls[0]?.[0]?.details).toBe("Database lookup failed Bearer [redacted]");
    expect(mocks.recordOperationalFailure).toHaveBeenCalledTimes(1);
    expect(mocks.queueFounderPushNotification).toHaveBeenCalledTimes(1);

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
});

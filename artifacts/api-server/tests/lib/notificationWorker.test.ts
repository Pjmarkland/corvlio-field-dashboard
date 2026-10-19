import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn(),
  connect: vi.fn(), send: vi.fn(), email: vi.fn(), admin: vi.fn(),
}));
vi.mock("@workspace/db", async () => ({
  ...await import("../../../../lib/db/src/schema/notifications"),
  ...await import("../../../../lib/db/src/schema/businesses"),
  db: mocks,
  advisoryLockPool: { connect: mocks.connect },
}));
vi.mock("../../src/lib/apnsAdapter", () => ({
  isApnsConfigured: () => true, sendApnsNotification: mocks.send,
}));
vi.mock("../../src/lib/leadAlertEmail", () => ({ deliverLeadAlertEmails: mocks.email }));
vi.mock("../../src/lib/operationalFailures", () => ({ deliverOperationalFailureAlerts: mocks.admin }));
vi.mock("../../src/lib/googleSheets", () => ({ readGoogleSheetLeads: vi.fn() }));
vi.mock("../../src/lib/logger", () => ({ logger: {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} }));

import { businessesTable, notificationDevicesTable } from "@workspace/db";
import {
  runNotificationPollCycle, runNotificationOutboxNow,
  startLeadNotificationPoller, stopLeadNotificationPoller,
} from "../../src/lib/notificationService";

let inTransaction = false;
let event: any;
let devices: any[];
let lockClient: EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
let writes: any[];
let timeline: string[];
let internalBusiness = false;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  inTransaction = false;
  internalBusiness = false;
  event = {
    id: 1, businessId: "7", status: "queued", nextAttemptAt: new Date(0),
    attempts: 0, title: "New lead", body: "Repair", deepLink: "/leads/3",
  };
  devices = [{ id: 2, token: "test-device-token" }];
  writes = [];
  timeline = [];
  lockClient = Object.assign(new EventEmitter(), {
    query: vi.fn(async (query: string) => {
      timeline.push(query.includes("unlock") ? "unlock" : "lock");
      return { rows: [{ locked: true }] };
    }),
    release: vi.fn(),
  });
  mocks.connect.mockResolvedValue(lockClient);
  mocks.execute.mockResolvedValue({ rows: [{ due: false }] });
  mocks.email.mockResolvedValue(undefined);
  mocks.admin.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = table === businessesTable
          ? [{ id: 7, leadAlertsEnabled: true, isSample: false, isInternal: internalBusiness }]
          : table === notificationDevicesTable ? devices
          : event ? [event] : [];
        return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
      },
    }),
  }));
  mocks.insert.mockImplementation(() => ({
    values: (values: any) => {
      writes.push(values);
      return {
        onConflictDoUpdate: () => ({
          returning: async () => [{ ownerId: values.ownerId }],
        }),
      };
    },
  }));
  mocks.update.mockImplementation(() => ({
    set: (values: any) => ({ where: async () => { writes.push(values); } }),
  }));
  mocks.transaction.mockImplementation(async work => {
    expect(inTransaction).toBe(false);
    inTransaction = true;
    timeline.push("begin");
    try { return await work(mocks); }
    finally { inTransaction = false; timeline.push("commit"); }
  });
  mocks.send.mockImplementation(async () => {
    expect(inTransaction).toBe(false);
    timeline.push("send");
    return { outcome: "delivered", apnsId: "test-id" };
  });
});

afterEach(async () => {
  await stopLeadNotificationPoller();
  vi.useRealTimers();
});

describe("notification retry cost controls", () => {
  it("delivers push for a non-billed internal business through the normal channel", async () => {
    internalBusiness = true;
    await runNotificationOutboxNow();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(writes.some(w => w.status === "delivered")).toBe(true);
  });

  it("uses a single read and no lease writes or channel calls when idle", async () => {
    await runNotificationPollCycle();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("backs off database failures 5/10/15/15 minutes and resets after success", async () => {
    mocks.execute.mockRejectedValue(new Error("database unavailable"));
    startLeadNotificationPoller();
    startLeadNotificationPoller(); // idempotent
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    for (const [delay, count] of [[300_000, 2], [600_000, 3], [900_000, 4], [900_000, 5]]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(mocks.execute).toHaveBeenCalledTimes(count - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.execute).toHaveBeenCalledTimes(count);
    }
    mocks.execute.mockResolvedValue({ rows: [{ due: false }] });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(mocks.execute).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.execute).toHaveBeenCalledTimes(7);
    await stopLeadNotificationPoller();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(mocks.execute).toHaveBeenCalledTimes(7);
  });

  it("observes email database errors for backoff but still attempts push", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ due: true }] });
    mocks.email.mockRejectedValue(new Error("database unavailable"));
    await expect(runNotificationPollCycle()).rejects.toThrow("database unavailable");
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalled(); // lease released even on failure
  });

  it("delivers a new lead immediately even while the scheduled sweep is backing off", async () => {
    mocks.execute.mockRejectedValue(new Error("database unavailable"));
    startLeadNotificationPoller();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    await runNotificationOutboxNow();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.email).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("commits before APNs, saves atomically afterward, unlocks last, and bypasses sweep for new leads", async () => {
    await runNotificationOutboxNow();
    expect(mocks.execute).not.toHaveBeenCalled(); // no scheduled preflight/lease/backoff
    expect(timeline).toEqual(["lock", "begin", "commit", "send", "begin", "commit", "unlock"]);
    expect(writes).toContainEqual(expect.objectContaining({ status: "delivered", attempts: 1 }));
    expect(lockClient.release).toHaveBeenCalledWith(false);
    expect(mocks.email).toHaveBeenCalledOnce();
  });

  it("does not send when another process holds the advisory lock", async () => {
    lockClient.query.mockResolvedValue({ rows: [{ locked: false }] });
    await runNotificationOutboxNow();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it("rechecks an event under the lock and does not resend an already delivered event", async () => {
    event.status = "delivered"; // stale outer list, but fresh read is delivered
    await runNotificationOutboxNow();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(lockClient.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock(542317, $1)", [1]);
  });

  it("preserves retry outcomes and invalidates expired tokens", async () => {
    mocks.send.mockResolvedValue({ outcome: "invalid_token" });
    await runNotificationOutboxNow();
    expect(writes).toContainEqual(expect.objectContaining({ enabled: false }));
    expect(writes).toContainEqual(expect.objectContaining({ attempts: 1, nextAttemptAt: expect.any(Date) }));
    expect(lockClient.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock(542317, $1)", [1]);
  });

  it("destroys the connection rather than returning a session with a leaked lock", async () => {
    lockClient.query.mockImplementation(async (query: string) => {
      if (query.includes("unlock")) throw new Error("connection lost");
      return { rows: [{ locked: true }] };
    });
    await runNotificationOutboxNow();
    expect(lockClient.release).toHaveBeenCalledWith(true);
  });

  it("releases the lock and reports database failure if saving the APNs outcome fails", async () => {
    mocks.transaction.mockImplementationOnce(async work => work(mocks))
      .mockRejectedValueOnce(new Error("database unavailable"));
    mocks.execute.mockResolvedValue({ rows: [{ due: true }] });
    await expect(runNotificationPollCycle()).rejects.toThrow("database unavailable");
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(lockClient.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock(542317, $1)", [1]);
    expect(lockClient.release).toHaveBeenCalledWith(false);
  });
});

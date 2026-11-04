import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  fallback: vi.fn(),
  notify: vi.fn(),
  sms: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@workspace/db", async () => ({
  ...await import("../../../../lib/db/src/schema/retellPendingCalls"),
  db: { select: mocks.select },
}));
vi.mock("../../src/lib/retellPersistence", () => ({
  persistPendingCallFallback: mocks.fallback,
}));
vi.mock("../../src/lib/notificationService", () => ({
  runNotificationOutboxNow: mocks.notify,
}));
vi.mock("../../src/lib/ownerSms", () => ({
  sendOwnerLeadSms: mocks.sms,
}));
vi.mock("../../src/lib/logger", () => ({
  logger: { error: mocks.error, warn: mocks.warn },
}));

import { runRetellPendingCallSweep } from "../../src/lib/retellPendingCallWorker";

let dueCalls: Array<{ callId: string }>;
beforeEach(() => {
  vi.clearAllMocks();
  dueCalls = [{ callId: "call-1" }, { callId: "call-2" }, { callId: "call-3" }];
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => dueCalls }),
      }),
    }),
  }));
  mocks.fallback.mockResolvedValue(null);
  mocks.notify.mockResolvedValue(undefined);
  mocks.sms.mockResolvedValue(undefined);
});

describe("Retell pending-call sweep", () => {
  it("creates overdue fallback leads once and dispatches owner alerts through the existing channels", async () => {
    const now = new Date("2026-11-04T12:00:00.000Z");
    mocks.fallback
      .mockResolvedValueOnce({ leadId: 101, businessId: 7, notify: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ leadId: 103, businessId: 9, notify: false });

    await expect(runRetellPendingCallSweep(now)).resolves.toEqual({ dueCalls: 3, leadsCreated: 2 });
    expect(mocks.fallback).toHaveBeenNthCalledWith(1, "call-1", now);
    expect(mocks.fallback).toHaveBeenNthCalledWith(2, "call-2", now);
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.sms).toHaveBeenCalledOnce();
    expect(mocks.sms).toHaveBeenCalledWith(7, 101);
  });

  it("continues the sweep after one call fails to persist", async () => {
    mocks.fallback
      .mockRejectedValueOnce(new Error("temporary database error"))
      .mockResolvedValueOnce({ leadId: 102, businessId: 7, notify: false })
      .mockResolvedValueOnce(null);

    await expect(runRetellPendingCallSweep()).resolves.toEqual({ dueCalls: 3, leadsCreated: 1 });
    expect(mocks.fallback).toHaveBeenCalledTimes(3);
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ callId: "call-1" }), expect.any(String));
  });
});

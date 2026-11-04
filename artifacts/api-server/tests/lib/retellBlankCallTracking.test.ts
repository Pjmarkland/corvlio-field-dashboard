import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  recent: [] as Array<{ retellCallId: string; outcome: string | null }>,
  inserted: true,
}));

vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction },
  leadsTable: {},
  notificationEventsTable: {},
  retellCallRecordsTable: {
    businessId: "business_id",
    retellCallId: "retell_call_id",
    callStartedAt: "call_started_at",
    durationMs: "duration_ms",
    outcome: "outcome",
    analysisComplete: "analysis_complete",
    recordedAt: "recorded_at",
  },
  retellPendingCallsTable: {
    retellCallId: "retell_call_id",
    status: "status",
  },
}));

import { persistBlankCall } from "../../src/lib/retellPersistence";

describe("blank Retell call persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserted = true;
    mocks.recent = [];
    mocks.execute.mockResolvedValue(undefined);
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => mocks.recent }),
        }),
      }),
    }));
    mocks.update.mockImplementation(() => ({
      set: () => ({ where: async () => undefined }),
    }));
    mocks.insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => mocks.inserted ? [{ retellCallId: "new-call" }] : [],
        }),
      }),
    }));
    mocks.transaction.mockImplementation((work) => work({
      execute: mocks.execute,
      select: mocks.select,
      insert: mocks.insert,
      update: mocks.update,
    }));
  });

  it("triggers once when the third most recent call is also blank", async () => {
    mocks.recent = [
      { retellCallId: "new-call", outcome: "blank_or_failed" },
      { retellCallId: "blank-2", outcome: "blank_or_failed" },
      { retellCallId: "blank-1", outcome: "blank_or_failed" },
    ];

    await expect(persistBlankCall("new-call", {
      businessId: 9, callStartedAt: null, durationMs: 0,
    })).resolves.toEqual({
      inserted: true,
      triggerStreakAlert: true,
      streakStartCallId: "blank-1",
    });
  });

  it("does not repeat the alert for a fourth consecutive blank call", async () => {
    mocks.recent = [
      { retellCallId: "new-call", outcome: "blank_or_failed" },
      { retellCallId: "blank-3", outcome: "blank_or_failed" },
      { retellCallId: "blank-2", outcome: "blank_or_failed" },
      { retellCallId: "blank-1", outcome: "blank_or_failed" },
    ];

    await expect(persistBlankCall("new-call", {
      businessId: 9, callStartedAt: null, durationMs: 3000,
    })).resolves.toMatchObject({ inserted: true, triggerStreakAlert: false, streakStartCallId: null });
  });

  it("does not re-record duplicate call IDs", async () => {
    mocks.inserted = false;
    await expect(persistBlankCall("new-call", {
      businessId: 9, callStartedAt: null, durationMs: null,
    })).resolves.toEqual({ inserted: false, triggerStreakAlert: false, streakStartCallId: null });
    expect(mocks.select).not.toHaveBeenCalled();
  });
});

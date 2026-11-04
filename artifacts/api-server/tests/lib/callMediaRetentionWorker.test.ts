import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock("../../src/lib/logger", () => ({ logger: log }));

import {
  CALL_MEDIA_RETENTION_MONTHS,
  runCallMediaRetentionNow,
} from "../../src/lib/callMediaRetentionWorker";

describe("call media retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses one 12-month cutoff, deletes provider media, and clears local transcript and recording", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT r.id, r.retell_call_id AS call_id")) {
        return { rows: [{ id: 9, call_id: "call-9", business_id: 44, lead_id: 109 }], rowCount: 1 };
      }
      if (sql.includes("FROM leads l")) {
        return { rows: [{ id: 110, call_id: null, business_id: 44 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const removeCall = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-11-02T12:00:00.000Z");

    const result = await runCallMediaRetentionNow({
      query,
      removeCall,
      now: () => now,
    } as never);

    expect(CALL_MEDIA_RETENTION_MONTHS).toBe(12);
    expect(query.mock.calls[0][1]).toEqual([new Date("2025-11-02T12:00:00.000Z"), 50]);
    expect(removeCall).toHaveBeenCalledOnce();
    expect(removeCall).toHaveBeenCalledWith("call-9");
    expect(query.mock.calls.some(([sql]) => sql.includes("SET transcript = NULL, recording_url = NULL"))).toBe(true);
    expect(result).toEqual({ deletedCount: 4, failedCount: 0 });
    expect(query.mock.calls.some(([sql]) => sql.includes("personal_data_retention_completed_at"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE retell_pending_calls"))).toBe(true);
  });

  it("leaves local media intact when Retell deletion fails and logs only the lead ID", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT r.id, r.retell_call_id AS call_id")) {
        return { rows: [{ id: 9, call_id: "call-9", business_id: 44, lead_id: 109 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const removeCall = vi.fn().mockRejectedValue(new Error("provider response with sensitive body"));

    const result = await runCallMediaRetentionNow({
      query,
      removeCall,
      now: () => new Date("2026-11-02T12:00:00.000Z"),
    } as never);

    expect(result).toEqual({ deletedCount: 0, failedCount: 1 });
    expect(query.mock.calls.some(([sql]) => sql.includes("SET transcript = NULL"))).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ leadId: 109 }, "Call media retention deletion deferred");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("sensitive body");
  });
});

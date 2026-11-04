import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  transaction: vi.fn(), update: vi.fn(), select: vi.fn(), insert: vi.fn(),
  inserted: [] as Array<{ table: unknown; values: unknown }>,
  suppressedLeads: [] as Array<{ businessId: number; isSpam: boolean; spamCallerNumber: string }>,
  pendingCalls: [] as Array<Record<string, any>>,
  records: [] as Array<Record<string, any>>,
  business: { id: 2, leadAlertsEnabled: false, isSample: false },
}));
vi.mock("@workspace/db", async () => ({
  ...await import("../../../../lib/db/src/schema/businesses"),
  ...await import("../../../../lib/db/src/schema/leads"),
  ...await import("../../../../lib/db/src/schema/retellCallRecords"),
  ...await import("../../../../lib/db/src/schema/retellPendingCalls"),
  ...await import("../../../../lib/db/src/schema/notifications"),
  db: { transaction: mock.transaction },
}));
import { businessesTable, leadsTable, notificationEventsTable, retellCallRecordsTable, retellPendingCallsTable } from "@workspace/db";
import { NO_AI_SUMMARY_NOTE, persistAnalyzedCall, persistPendingCallFallback, persistPendingRetellCall } from "../../src/lib/retellPersistence";
const dialect = new PgDialect();
let lead: Record<string, any>;
beforeEach(() => {
  vi.clearAllMocks();
  mock.inserted = [];
  mock.suppressedLeads = [];
  mock.pendingCalls = [];
  mock.records = [];
  mock.business = { id: 2, leadAlertsEnabled: false, isSample: false };
  lead = { id: 1, businessId: 2, retellCallId: "test-call", callerName: "Sam", callerId: "+15550000001",
    callbackNumber: "+15550000002", phoneNumber: "+15550000002", issueReason: "Analyzed issue",
    address: "12 Test St", summary: "Analyzed summary", status: "contacted", contactedAt: new Date(),
    isSpam: false, spamCallerNumber: null };
  mock.select.mockImplementation(() => ({ from: (table: unknown) => ({
    where: (condition: unknown) => {
      const query = dialect.sqlToQuery(condition as any);
      if (table === leadsTable && query.sql.includes('"spam_caller_number"')) {
        const result = mock.suppressedLeads.filter(row =>
          row.businessId === query.params[0]
          && row.isSpam
          && row.spamCallerNumber === query.params[query.params.length - 1]);
        return Object.assign(Promise.resolve(result), { limit: async () => result.slice(0, 1) });
      }
      if (table === retellPendingCallsTable) {
        const result = mock.pendingCalls.filter(row => row.retellCallId === query.params[0]);
        return Object.assign(Promise.resolve(result), { limit: async (size: number) => result.slice(0, size) });
      }
      if (table === retellCallRecordsTable) {
        const result = mock.records.filter(row => row.retellCallId === query.params[0]);
        if (result.length) return Promise.resolve(result);
        return Promise.resolve(query.params[0] === "test-call" ? [{ businessId: 2, leadId: 1 }] : []);
      }
      if (table === businessesTable) return Promise.resolve([mock.business]);
      if (table === leadsTable && query.sql.includes('"retell_call_id"')) {
        const result = lead.retellCallId === query.params[0] ? [lead] : [];
        return Object.assign(Promise.resolve(result), { limit: async (size: number) => result.slice(0, size) });
      }
      const result = table === leadsTable ? [lead]
        : query.params[0] === "test-call" ? [{ businessId: 2, leadId: 1 }] : [];
      return Object.assign(Promise.resolve(result), { limit: async (size: number) => result.slice(0, size) });
    },
  }) }));
  mock.update.mockImplementation((table: unknown) => ({ set: (changes: Record<string, unknown>) => ({ where: async (condition: unknown) => {
    if (table === retellPendingCallsTable) {
      const query = dialect.sqlToQuery(condition as any);
      const pending = mock.pendingCalls.find(row => row.retellCallId === query.params[0]);
      if (pending) Object.assign(pending, changes);
    } else {
      lead = { ...lead, ...changes };
    }
  } }) }));
  mock.insert.mockImplementation((table: unknown) => ({ values: (values: unknown) => {
    mock.inserted.push({ table, values });
    return {
    returning: async () => {
      if (table === retellPendingCallsTable) {
        const pending = values as Record<string, unknown>;
        if (mock.pendingCalls.some(row => row.retellCallId === pending.retellCallId)) return [];
        mock.pendingCalls.push({ ...pending, id: 1, status: "pending" });
        return [{ id: 1 }];
      }
      if (table !== leadsTable) return [];
      lead = { ...(values as Record<string, unknown>), id: 2 };
      return [lead];
    },
    onConflictDoUpdate: async (config: { set?: Record<string, unknown> }) => {
      if (table !== retellCallRecordsTable) return;
      const value = values as Record<string, unknown>;
      const existing = mock.records.find(row => row.retellCallId === value.retellCallId);
      if (existing) Object.assign(existing, { ...value, ...config.set });
      else mock.records.push({ ...value });
    },
    onConflictDoNothing: () => ({ returning: async () => {
      if (table !== retellPendingCallsTable) return [];
      const pending = values as Record<string, unknown>;
      if (mock.pendingCalls.some(row => row.retellCallId === pending.retellCallId)) return [];
      mock.pendingCalls.push({ ...pending, id: 1, status: "pending" });
      return [{ id: 1 }];
    } }),
    };
  } }));
  mock.transaction.mockImplementation(async (work) => work({
    execute: async () => {}, select: mock.select, update: mock.update, insert: mock.insert,
  }));
});
describe("ended/analyzed reconciliation enriches one lead without losing richer data", () => {
  it("saves a provider recording without overwriting owner notes or contacted actor", async () => {
    lead.privateNotes = "Owner-only gate instructions";
    lead.contactedBy = "owner-a";
    await persistAnalyzedCall("test-call", {
      businessId: 2, recordingUrl: "https://recordings.example.test/call.wav",
      privateNotes: "Unexpected webhook note", contactedBy: "other",
    }, { businessId: 2, retellCallId: "test-call" }, true);
    expect(lead).toMatchObject({
      recordingUrl: "https://recordings.example.test/call.wav",
      privateNotes: "Owner-only gate instructions", contactedBy: "owner-a",
    });
  });
  it("a late ended event cannot replace an analyzed callback, issue, summary or contact status", async () => {
    await persistAnalyzedCall("test-call", { businessId: 2, callerId: "+15550000001", phoneNumber: "+15550000001",
      issueReason: "Partial call", summary: "Partial call", transcript: "user: Help" }, { businessId: 2, retellCallId: "test-call" }, false);
    expect(lead).toMatchObject({ phoneNumber: "+15550000002", callbackNumber: "+15550000002",
      issueReason: "Analyzed issue", summary: "Analyzed summary", status: "contacted", transcript: "user: Help" });
  });
  it("analysis fills missing fields and keeps both phone numbers and existing status", async () => {
    lead = { id: 1, businessId: 2, retellCallId: "test-call", status: "contacted", callerId: "+15550000001" };
    const result = await persistAnalyzedCall("test-call", { businessId: 2, callerName: "Sam", callerId: "+15550000001",
      callbackNumber: "+15550000002", phoneNumber: "+15550000002", issueReason: "Leaking pipe",
      address: "12 Test St", availability: "Tomorrow", transcript: "user: My pipe leaks", summary: "Sam needs help" },
    { businessId: 2, retellCallId: "test-call" }, true);
    expect(result).toEqual({ id: 1, notify: false });
    expect(lead).toMatchObject({ callerName: "Sam", phoneNumber: "+15550000002", callerId: "+15550000001",
      callbackNumber: "+15550000002", address: "12 Test St", availability: "Tomorrow", transcript: "user: My pipe leaks",
      summary: "Sam needs help", status: "contacted" });
    expect(mock.update).toHaveBeenCalledTimes(2);
  });

  it("stores a unique pending call with a ten-minute analysis deadline", async () => {
    const receivedAt = new Date("2026-01-02T03:04:05.000Z");
    const input = {
      callId: "pending-call",
      businessId: 2,
      callerNumber: "+15550000001",
      callStartedAt: new Date("2026-01-02T03:03:55.000Z"),
      durationMs: 10_000,
      receivedAt,
    };
    await expect(persistPendingRetellCall(input)).resolves.toBe(true);
    expect(mock.pendingCalls[0]).toMatchObject({
      businessId: 2,
      retellCallId: "pending-call",
      callerNumber: "+15550000001",
      callStartedAt: input.callStartedAt,
      durationMs: 10_000,
      deadlineAt: new Date(receivedAt.getTime() + 10 * 60_000),
    });
    await expect(persistPendingRetellCall(input)).resolves.toBe(false);
    expect(mock.pendingCalls).toHaveLength(1);
  });

  it("does not store a pending call for a suspended business", async () => {
    mock.business = { id: 2, accountStatus: "suspended", leadAlertsEnabled: false, isSample: false };
    await expect(persistPendingRetellCall({
      callId: "suspended-pending-call",
      businessId: 2,
      callerNumber: "+15550000001",
      callStartedAt: new Date("2026-01-02T03:03:55.000Z"),
      durationMs: 10_000,
    })).resolves.toBe(false);
    expect(mock.pendingCalls).toHaveLength(0);
  });

  it("does not persist an analyzed lead for a suspended business", async () => {
    mock.business = { id: 2, accountStatus: "suspended", leadAlertsEnabled: false, isSample: false };
    await expect(persistAnalyzedCall("suspended-analysis-call", {
      businessId: 2, callerName: "Sam", callerId: "+15550000001", issueReason: "Leaking pipe",
    }, { businessId: 2, retellCallId: "suspended-analysis-call" }, true)).resolves.toBeNull();
    expect(mock.inserted.filter(row => row.table === leadsTable)).toHaveLength(0);
  });

  it("suppresses a delayed fallback when suspension happens before lead creation", async () => {
    mock.business = { id: 2, accountStatus: "suspended", leadAlertsEnabled: false, isSample: false };
    const deadlineAt = new Date("2026-01-02T03:14:05.000Z");
    mock.pendingCalls = [{
      id: 1, businessId: 2, retellCallId: "suspended-fallback-call", callerNumber: "+15550000001",
      callStartedAt: new Date("2026-01-02T03:03:55.000Z"), durationMs: 10_000, deadlineAt, status: "pending",
    }];
    await expect(persistPendingCallFallback("suspended-fallback-call", new Date("2026-01-02T03:15:00.000Z")))
      .resolves.toBeNull();
    expect(mock.pendingCalls[0]).toMatchObject({ status: "suppressed_suspended", callerNumber: null });
    expect(mock.inserted.filter(row => row.table === leadsTable)).toHaveLength(0);
  });

  it("resolves the pending record when analyzed data is persisted", async () => {
    mock.pendingCalls = [{
      id: 1, businessId: 2, retellCallId: "test-call", status: "pending",
      deadlineAt: new Date(Date.now() + 60_000),
    }];
    await persistAnalyzedCall("test-call", {
      businessId: 2, callerName: "Sam", callerId: "+15550000001", issueReason: "Leaking pipe",
    }, { businessId: 2, retellCallId: "test-call" }, true);
    expect(mock.pendingCalls[0]).toMatchObject({ status: "resolved", leadId: 1 });
  });

  it("creates one basic overdue lead without claiming a callback or inventing a summary", async () => {
    const callStartedAt = new Date("2026-01-02T03:03:55.000Z");
    const deadlineAt = new Date("2026-01-02T03:14:05.000Z");
    mock.pendingCalls = [{
      id: 1, businessId: 2, retellCallId: "fallback-call", callerNumber: "+15550000001",
      callStartedAt, durationMs: 10_000, deadlineAt, status: "pending",
    }];

    await expect(persistPendingCallFallback("fallback-call", new Date(deadlineAt.getTime() - 1)))
      .resolves.toBeNull();
    expect(mock.inserted.filter(row => row.table === leadsTable)).toHaveLength(0);
    const result = await persistPendingCallFallback("fallback-call", new Date("2026-01-02T03:15:00.000Z"));
    expect(result).toEqual({ leadId: 2, businessId: 2, notify: false });
    expect(lead).toMatchObject({
      businessId: 2,
      retellCallId: "fallback-call",
      callerId: "+15550000001",
      phoneNumber: "+15550000001",
      callbackNumber: null,
      issueReason: NO_AI_SUMMARY_NOTE,
      summary: null,
      createdAt: callStartedAt,
    });
    expect(mock.pendingCalls[0]).toMatchObject({ status: "fallback_created", leadId: 2 });
    expect(mock.pendingCalls[0].callerNumber).toBeNull();
    expect(mock.inserted.some(row => row.table === retellCallRecordsTable
      && (row.values as Record<string, unknown>).outcome === "analysis_timeout")).toBe(true);

    await expect(persistPendingCallFallback("fallback-call", new Date("2026-01-02T03:16:00.000Z")))
      .resolves.toBeNull();
    expect(mock.inserted.filter(row => row.table === leadsTable)).toHaveLength(1);

    await persistAnalyzedCall("fallback-call", {
      businessId: 2, callerName: "Sam", callerId: "+15550000001", callbackNumber: "+15550000002",
      phoneNumber: "+15550000002", issueReason: "Leaking pipe", summary: "Sam needs pipe repair",
    }, { businessId: 2, retellCallId: "fallback-call" }, true);
    expect(lead).toMatchObject({
      retellCallId: "fallback-call",
      issueReason: "Leaking pipe",
      summary: "Sam needs pipe repair",
      callbackNumber: "+15550000002",
    });
    expect(mock.pendingCalls[0]).toMatchObject({ status: "resolved", leadId: 2 });
    expect(mock.inserted.filter(row => row.table === leadsTable)).toHaveLength(1);
  });

  it("suppresses a future notification for a manually marked caller number", async () => {
    mock.suppressedLeads = [{ businessId: 2, isSpam: true, spamCallerNumber: "+15550000001" }];
    await persistAnalyzedCall("new-call", {
      businessId: 2, callerId: "(555) 000-0001", phoneNumber: "(555) 000-0002",
      callbackNumber: "(555) 000-0002", callerName: "Sam",
    }, { businessId: 2, retellCallId: "new-call" }, true);
    expect(mock.inserted.some(row => row.table === notificationEventsTable)).toBe(false);
  });

  it("does not suppress a caller because another business marked that number as spam", async () => {
    mock.suppressedLeads = [{ businessId: 1, isSpam: true, spamCallerNumber: "+15550000001" }];
    await persistAnalyzedCall("new-call", {
      businessId: 2, callerId: "+15550000001", callerName: "Sam",
    }, { businessId: 2, retellCallId: "new-call" }, true);
    expect(mock.inserted.some(row => row.table === notificationEventsTable)).toBe(true);
  });
});
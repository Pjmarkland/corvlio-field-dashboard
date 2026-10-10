import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  transaction: vi.fn(), update: vi.fn(), select: vi.fn(), insert: vi.fn(),
  leads: { id: "id", retellCallId: "call_id" },
  records: { retellCallId: "call_id" }, notifications: {},
}));
vi.mock("@workspace/db", () => ({
  db: { transaction: mock.transaction }, leadsTable: mock.leads,
  retellCallRecordsTable: mock.records, notificationEventsTable: mock.notifications,
}));
import { persistAnalyzedCall } from "../../src/lib/retellPersistence";
let lead: Record<string, any>;
beforeEach(() => {
  vi.clearAllMocks();
  lead = { id: 1, businessId: 2, retellCallId: "test-call", callerName: "Sam", callerId: "+15550000001",
    callbackNumber: "+15550000002", phoneNumber: "+15550000002", issueReason: "Analyzed issue",
    address: "12 Test St", summary: "Analyzed summary", status: "contacted", contactedAt: new Date() };
  mock.select.mockImplementation(() => ({ from: (table: unknown) => ({
    where: async () => table === mock.leads ? [lead] : [{ businessId: 2, leadId: 1 }],
  }) }));
  mock.update.mockImplementation(() => ({ set: (changes: Record<string, unknown>) => ({ where: async () => { lead = { ...lead, ...changes }; } }) }));
  mock.insert.mockImplementation(() => ({ values: () => ({
    onConflictDoUpdate: async () => {},
    onConflictDoNothing: () => ({ returning: async () => [] }),
  }) }));
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
    expect(mock.update).toHaveBeenCalledOnce();
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  transaction: vi.fn(), select: vi.fn(), update: vi.fn(), send: vi.fn(), warn: vi.fn(), incident:vi.fn(), writes: [] as Record<string, unknown>[],
  tables: { events: { id: "event" }, business: { id: "business" }, lead: { id: "lead", businessId: "business" } },
}));
vi.mock("@workspace/db", () => ({
  db: m, notificationEventsTable: m.tables.events, businessesTable: m.tables.business, leadsTable: m.tables.lead,
}));
vi.mock("../../src/lib/gmail", () => ({ sendLeadNotificationEmail: m.send }));
vi.mock("../../src/lib/logger", () => ({ logger: { warn: m.warn } }));
vi.mock("../../src/lib/emailHealth",()=>({recordLeadEmailAttempt:vi.fn()}));
vi.mock("../../src/lib/operationalFailures",()=>({recordOperationalFailure:m.incident}));
vi.mock("../../src/lib/notificationService",()=>({runNotificationOutboxNow:vi.fn().mockResolvedValue(undefined)}));
import { deliverLeadAlertEmails } from "../../src/lib/leadAlertEmail";
let event: Record<string, any>, business: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks(); m.writes = [];
  event = { id: 1, businessId: "7", leadId: "9", emailStatus: "queued", emailAttempts: 0, emailNextAttemptAt: new Date(0), emailDeliveredAt: null };
  business = { id: 7, ownerEmail: "owner@example.test", leadAlertsEnabled: true, isSample: false };
  m.select.mockImplementation(() => ({ from: table => ({ where: () => {
    const rows = table === m.tables.events ? [event] : table === m.tables.business ? [business] : [{
      callerName: "Sam", callbackNumber: "+15551230001", phoneNumber: "+15559990000", issueReason: "Pipe leak",
    }];
    return { limit: async () => rows, then: (fn: (v: unknown) => unknown) => Promise.resolve(rows).then(fn) };
  } }) }));
  m.update.mockReturnValue({ set: (values: Record<string, unknown>) => {
    m.writes.push(values); Object.assign(event, values); return { where: async () => {} };
  } });
  m.transaction.mockImplementation(async fn => fn({ ...m, execute: async () => ({ rows: [{ locked: true }] }) }));
  m.send.mockResolvedValue(true);
  m.incident.mockResolvedValue(false);
});
describe("persisted immediate email outbox", () => {
  it.each(["Gmail API lead email failed (403): Gmail API is not enabled for Google Cloud project 1028015564678.",
    "Google Gmail OAuth refresh failed: invalid_grant"])("stops immediately for configuration errors and records one incident: %s",async error=>{
    m.send.mockRejectedValue(new Error(error));
    await deliverLeadAlertEmails();
    expect(event.emailStatus).toBe("failed");
    expect(event.emailAttempts).toBe(1);
    expect(m.incident).toHaveBeenCalledOnce();
    expect(m.incident.mock.calls[0][0].eventKey).toBe("lead-gmail:1");
    await deliverLeadAlertEmails();
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.incident).toHaveBeenCalledOnce();
  });
  it("sends full name, issue and spoken callback and records successful delivery once", async () => {
    await deliverLeadAlertEmails(); await deliverLeadAlertEmails();
    expect(m.send).toHaveBeenCalledExactlyOnceWith({
      ownerEmail: "owner@example.test", callerName: "Sam", phoneNumber: "+15551230001", issue: "Pipe leak",
    });
    expect(event.emailStatus).toBe("delivered");
    expect(event.emailDeliveredAt).toBeInstanceOf(Date);
  });
  it.each([{ leadAlertsEnabled: false }, { isSample: true }])("does not send disabled or sample-business alerts", async changes => {
    Object.assign(business, changes); await deliverLeadAlertEmails();
    expect(m.send).not.toHaveBeenCalled(); expect(event.emailStatus).toBe("skipped");
  });
  it("does not replay skipped historical events", async () => {
    event.emailStatus = "skipped"; await deliverLeadAlertEmails();
    expect(m.send).not.toHaveBeenCalled();
  });
  it("retries a transient email failure later instead of losing the event", async () => {
    m.send.mockRejectedValue(new Error("Gmail unavailable")); await deliverLeadAlertEmails();
    expect(event.emailStatus).toBe("queued"); expect(event.emailAttempts).toBe(1);
    expect(event.emailNextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(m.warn).toHaveBeenCalledWith({
      source: "lead_gmail_notification", eventId: 1, businessId: 7,
      attempt: 1, maxAttempts: 5, willRetry: true, error: "Gmail unavailable",
    }, "Owner lead email failed; retry scheduled");
    await deliverLeadAlertEmails(); expect(m.send).toHaveBeenCalledOnce();
  });
  it("records a terminal failure after five attempts", async () => {
    event.emailAttempts = 4; m.send.mockResolvedValue(false); await deliverLeadAlertEmails();
    expect(event.emailStatus).toBe("failed"); expect(event.emailLastError).toContain("not configured");
    expect(m.warn).toHaveBeenCalledWith(expect.objectContaining({ attempt: 5, willRetry: false }),
      "Owner lead email failed; retries exhausted");
  });
});
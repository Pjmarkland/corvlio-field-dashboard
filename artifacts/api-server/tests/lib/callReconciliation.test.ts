import { describe, expect, it, vi } from "vitest";
import { reconcileCall, type CallLead, type CallRecord, type CallTransaction } from "../../src/lib/callReconciliation";

function fixture() {
  const leads: CallLead[] = [];
  const records = new Map<string, CallRecord>();
  const notifications = new Set<number>();
  const tx: CallTransaction = {
    findLead: async (id) => leads.find((lead) => lead.retellCallId === id),
    findLeadById: async (id) => leads.find((lead) => lead.id === id),
    findRecord: async (id) => records.get(id),
    findLegacyLead: vi.fn(async () => undefined),
    createLead: vi.fn(async (id) => {
      const lead = { id: 100 + leads.length, businessId: 1, retellCallId: id };
      leads.push(lead);
      return lead;
    }),
    linkLead: async (id, call) => { leads.find((lead) => lead.id === id)!.retellCallId = call; },
    saveRecord: async (call, lead) => { records.set(call, { businessId: 1, leadId: lead }); },
    ensureNotification: async (lead) => {
      if (notifications.has(lead)) return false;
      notifications.add(lead);
      return true;
    },
  };
  return { tx, leads, records, notifications };
}
describe("transactional call reconciliation", () => {
  it("retries create one lead, one call record and one notification", async () => {
    const { tx, leads, records, notifications } = fixture();
    expect((await reconcileCall("call-1", 1, tx)).notify).toBe(true);
    expect((await reconcileCall("call-1", 1, tx)).notify).toBe(false);
    expect((await reconcileCall("call-1", 1, tx)).notify).toBe(false);
    expect(leads).toHaveLength(1);
    expect(records.size).toBe(1);
    expect(notifications.size).toBe(1);
  });
  it("repairs a missing call record without creating another lead or notification", async () => {
    const { tx, leads, records, notifications } = fixture();
    leads.push({ id: 42, businessId: 1, retellCallId: "call-1" });
    notifications.add(42);
    expect(await reconcileCall("call-1", 1, tx)).toEqual({ id: 42, notify: false });
    expect(records.get("call-1")?.leadId).toBe(42);
    expect(tx.createLead).not.toHaveBeenCalled();
  });
  it("repairs a call record with no lead", async () => {
    const { tx, leads, records } = fixture();
    records.set("call-1", { businessId: 1, leadId: null });
    await reconcileCall("call-1", 1, tx);
    await reconcileCall("call-1", 1, tx);
    expect(leads).toHaveLength(1);
    expect(records.get("call-1")?.leadId).toBe(leads[0]!.id);
  });
  it("links an unambiguous legacy lead instead of creating another", async () => {
    const { tx, leads, records } = fixture();
    const legacy = { id: 42, businessId: 1, retellCallId: null };
    leads.push(legacy);
    records.set("call-1", { businessId: 1, leadId: null });
    vi.mocked(tx.findLegacyLead).mockResolvedValue(legacy);
    await reconcileCall("call-1", 1, tx);
    expect(legacy.retellCallId).toBe("call-1");
    expect(tx.createLead).not.toHaveBeenCalled();
  });
  it("never sends a new alert on late analysis of an already linked lead, even if alerts were off originally", async () => {
    const { tx, leads, records } = fixture();
    leads.push({ id: 42, businessId: 1, retellCallId: "call-1" });
    records.set("call-1", { businessId: 1, leadId: 42 });
    expect((await reconcileCall("call-1", 1, tx)).notify).toBe(false);
    expect((await reconcileCall("call-1", 1, tx)).notify).toBe(false);
  });
  it("never reconciles a call ID or lead across business ownership", async () => {
    const { tx, records, leads } = fixture();
    records.set("call-1", { businessId: 2, leadId: null });
    await expect(reconcileCall("call-1", 1, tx)).rejects.toThrow("different business");
    records.clear();
    leads.push({ id: 42, businessId: 2, retellCallId: "call-1" });
    await expect(reconcileCall("call-1", 1, tx)).rejects.toThrow("ownership mismatch");
    expect(tx.createLead).not.toHaveBeenCalled();
  });
});
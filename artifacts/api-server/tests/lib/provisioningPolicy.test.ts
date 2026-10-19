import { describe, expect, it, vi } from "vitest";
import type { Business, NewBusiness } from "@workspace/db";
import { guardedProvisioning, provisioningCap, type ProvisioningStore, type PurchaseAttempt } from "../../src/lib/provisioningPolicy";

const input = (account = "test-owner", isSample = false): NewBusiness => ({
  clerkUserId: account, businessName: "Test business", isSample,
});
function fixture() {
  const businesses = new Map<string, Business>();
  const attempts = new Map<string, PurchaseAttempt>();
  const tails = new Map<string, Promise<void>>();
  let nextId = 1;
  const store: ProvisioningStore = {
    async lock<T>(account: string, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(account) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      tails.set(account, previous.then(() => gate));
      await previous;
      try { return await work(); } finally { release(); }
    },
    find: async (account) => businesses.get(account),
    create: vi.fn(async (data) => {
      const business = { ...data, id: nextId++, retellPhoneNumber: null,
        retellAgentId: null, isSample: Boolean(data.isSample), createdAt: new Date() } as Business;
      businesses.set(data.clerkUserId!, business);
      return business;
    }),
    attempt: async (account) => attempts.get(account),
    reserve: vi.fn(async (account, _business, daily, total) => {
      if (attempts.size >= Math.min(daily, total)) return false;
      attempts.set(account, { status: "reserved", purchasedNumber: null });
      return true;
    }),
    state: async (id, state) => {
      const business = [...businesses.values()].find((business) => business.id === id)!;
      business.provisioningState = state;
    },
    purchased: vi.fn(async (account, bought) => {
      attempts.set(account, { status: "purchased", purchasedNumber: bought.phoneNumber });
    }),
    attach: vi.fn(async (id, account, phone) => {
      const business = businesses.get(account)!;
      expect(business.id).toBe(id);
      business.retellPhoneNumber = phone;
      business.retellAgentId = "test-agent";
      business.provisioningState = "ready";
      return business;
    }),
    failure: async (account, id, _reason, bought) => {
      attempts.set(account, { status: bought ? "purchased" : "uncertain", purchasedNumber: bought?.phoneNumber ?? null });
      await store.state(id, bought ? "recovery" : "uncertain");
    },
  };
  const buy = vi.fn(async () => ({ phoneNumber: "+15551234567", agentId: "test-agent" }));
  return { store, buy, businesses, attempts };
}

describe("phone provisioning safeguards", () => {
  it("saves unpaid onboarding without reserving or purchasing a number", async () => {
    const {store,buy}=fixture();
    const r=await guardedProvisioning({...input(),chosenPlan:"starter",manualPaymentState:"invoiced"},store,buy);
    expect(r.business.provisioningState).toBe("awaiting_payment");
    expect(store.reserve).not.toHaveBeenCalled();
    expect(buy).not.toHaveBeenCalled();
  });
  it("a Startup request cannot activate before first payment", async () => {
    const {store,buy}=fixture();
    const r=await guardedProvisioning({...input(),chosenPlan:"startup",manualPaymentState:"requested"},store,buy);
    expect(r.business.provisioningState).toBe("awaiting_payment");
    expect(buy).not.toHaveBeenCalled();
  });
  it("activates an existing awaiting-payment account exactly once after payment", async () => {
    const {store,buy,businesses}=fixture();
    await guardedProvisioning({...input(),chosenPlan:"professional"},store,buy);
    const b=businesses.get("test-owner")!;
    b.firstInvoicePaidAt=new Date();
    await Promise.all(Array.from({length:5},()=>guardedProvisioning({...input(),chosenPlan:"professional"},store,buy)));
    expect(buy).toHaveBeenCalledOnce();
    expect(businesses.get("test-owner")?.retellPhoneNumber).toBeTruthy();
  });
  it("does not let a concurrent onboarding retry switch the saved plan", async () => {
    const {store,buy}=fixture();
    await guardedProvisioning({...input(),chosenPlan:"startup",manualPaymentState:"requested"},store,buy);
    await expect(guardedProvisioning({...input(),chosenPlan:"managed"},store,buy)).rejects.toThrow("plan is already saved");
    expect(buy).not.toHaveBeenCalled();
  });
  it("saves sample businesses but never reserves budget or buys a number", async () => {
    const { store, buy } = fixture();
    const result = await guardedProvisioning(input("demo", true), store, buy);
    expect(store.create).toHaveBeenCalledOnce();
    expect(store.reserve).not.toHaveBeenCalled();
    expect(buy).not.toHaveBeenCalled();
    expect(result.business).toMatchObject({ isSample: true, retellPhoneNumber: null, provisioningState: "sample" });
    expect(result.phoneProvisioningPending).toBe(false);
  });
  it("persists the business and reservation before contacting Retell", async () => {
    const { store, businesses, attempts } = fixture();
    const buy = vi.fn(async () => {
      expect(businesses.has("owner")).toBe(true);
      expect(attempts.has("owner")).toBe(true);
      return { phoneNumber: "+15551234567", agentId: "test-agent" };
    });
    const result = await guardedProvisioning(input("owner"), store, buy);
    expect(result.phoneProvisioningPending).toBe(false);
  });
  it("buys once under concurrent submissions by the same account", async () => {
    const { store, buy } = fixture();
    const results = await Promise.all(Array.from({ length: 5 }, () => guardedProvisioning(input(), store, buy)));
    expect(buy).toHaveBeenCalledOnce();
    expect(store.create).toHaveBeenCalledOnce();
    expect(new Set(results.map((result) => result.business.id)).size).toBe(1);
  });
  it.each([{ daily: 0, total: 25 }, { daily: 5, total: 0 }])("fails closed at zero caps: %j", async (caps) => {
    const { store, buy } = fixture();
    const result = await guardedProvisioning(input(), store, buy, caps);
    expect(result.phoneProvisioningPending).toBe(true);
    expect(result.business.provisioningState).toBe("capped");
    expect(buy).not.toHaveBeenCalled();
  });
  it.each([{ daily: 1, total: 25 }, { daily: 5, total: 1 }])("limits concurrent accounts with %j", async (caps) => {
    const { store, buy } = fixture();
    const results = await Promise.all(["one", "two", "three"].map((account) => guardedProvisioning(input(account), store, buy, caps)));
    expect(buy).toHaveBeenCalledOnce();
    expect(results.filter((result) => result.phoneProvisioningPending)).toHaveLength(2);
  });
  it("does not buy when the pre-purchase business save fails", async () => {
    const { store, buy } = fixture();
    vi.mocked(store.create).mockRejectedValue(new Error("Database unavailable"));
    await expect(guardedProvisioning(input(), store, buy)).rejects.toThrow("Database unavailable");
    expect(buy).not.toHaveBeenCalled();
  });
  it("never buys again after an ambiguous timeout", async () => {
    const { store, buy, attempts } = fixture();
    buy.mockRejectedValue(new Error("Provider request timed out"));
    const first = await guardedProvisioning(input(), store, buy);
    const retry = await guardedProvisioning(input(), store, buy);
    expect(first.phoneProvisioningPending).toBe(true);
    expect(retry.phoneProvisioningPending).toBe(true);
    expect(attempts.get("test-owner")?.status).toBe("uncertain");
    expect(buy).toHaveBeenCalledOnce();
  });
  it("reattaches a journaled purchase after the final business update failed", async () => {
    const { store, buy, attempts } = fixture();
    vi.mocked(store.attach).mockRejectedValueOnce(new Error("Save failed"));
    const first = await guardedProvisioning(input(), store, buy);
    expect(first.phoneProvisioningPending).toBe(true);
    expect(attempts.get("test-owner")?.purchasedNumber).toBe("+15551234567");
    const recovered = await guardedProvisioning(input(), store, buy);
    expect(recovered.business.retellPhoneNumber).toBe("+15551234567");
    expect(buy).toHaveBeenCalledOnce();
  });
  it("preserves purchase evidence if the initial journal write fails", async () => {
    const { store, buy } = fixture();
    vi.mocked(store.purchased).mockRejectedValueOnce(new Error("Transient database failure"));
    await guardedProvisioning(input(), store, buy);
    const recovered = await guardedProvisioning(input(), store, buy);
    expect(recovered.phoneProvisioningPending).toBe(false);
    expect(buy).toHaveBeenCalledOnce();
  });
  it("does not retry an existing pending business that predates the journal", async () => {
    const { store, buy } = fixture();
    await store.create({ ...input(), provisioningState: "pending" });
    expect((await guardedProvisioning(input(), store, buy)).phoneProvisioningPending).toBe(true);
    expect(buy).not.toHaveBeenCalled();
  });
  it("protects a live business from being replaced with a sample", async () => {
    const { store, buy } = fixture();
    await guardedProvisioning(input(), store, buy);
    await expect(guardedProvisioning(input("test-owner", true), store, buy)).rejects.toThrow("A live business cannot");
    expect(buy).toHaveBeenCalledOnce();
  });
  it("uses safe defaults and treats malformed cap configuration as zero", () => {
    expect(provisioningCap(undefined, 5)).toBe(5);
    expect(provisioningCap("12", 5)).toBe(12);
    for (const value of ["", "-1", "NaN", "2.5", "9007199254740992"]) expect(provisioningCap(value, 5)).toBe(0);
  });
  it("keeps an internal account out of payment gates and all Retell provisioning, even without a number", async () => {
    const {store,buy}=fixture();
    const state=vi.spyOn(store,"state");
    const existing=await store.create({...input(),isInternal:true,provisioningState:"internal"});
    const result=await guardedProvisioning({...input(),chosenPlan:"professional"},store,buy);
    expect(result.business).toBe(existing);
    expect(result.phoneProvisioningPending).toBe(false);
    expect(buy).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
  });
});
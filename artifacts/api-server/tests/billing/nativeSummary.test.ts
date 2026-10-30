import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: [] as any[], enabled: false, where: vi.fn(), select: vi.fn(), query:vi.fn() }));
vi.mock("@workspace/db", () => ({
  billingAccountsTable: { businessId: "business_id" },
  db: { select: m.select },
  pool:{query:m.query},
}));
vi.mock("../../src/billing/stripeClient", () => ({ billingEnabled: () => m.enabled }));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));
import { initialBillingState } from "../../src/billing/policy";
import { nativeBillingSummary, readNativeBillingSummary, nextManualInvoiceDate } from "../../src/billing/nativeSummary";
const now = new Date("2026-10-12T12:00:00Z");
const state = () => ({ ...initialBillingState(), plan: "starter" as const, status: "active" as const,
  customerId: "cus_fake", subscriptionId: "sub_fake", periodEnd: "2026-11-01T00:00:00Z" });
beforeEach(() => {
  vi.clearAllMocks(); m.rows = []; m.enabled = false;
  m.query.mockResolvedValue({rows:[{is_internal:false,chosen_plan:null,billing_mode:"manual"}]});
  m.where.mockImplementation(() => ({ limit: async () => m.rows }));
  m.select.mockReturnValue({ from: () => ({ where: m.where }) });
});
describe("read-only native billing summary", () => {
  it("calculates the next monthly invoice anniversary without charging or creating an invoice",()=>{
    const anchor=new Date("2026-01-31T12:00:00Z");
    expect(nextManualInvoiceDate(anchor,new Date("2026-02-02"))?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(nextManualInvoiceDate(anchor,new Date("2026-02-28T12:00:01Z"))?.toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(nextManualInvoiceDate(null)).toBeNull();
  });
  it("shows manual invoice plan, status and scheduled invoice date without prices",async()=>{
    m.query.mockResolvedValueOnce({rows:[{is_internal:false,chosen_plan:"starter",billing_mode:"manual",
      manual_payment_state:"paid",first_invoice_paid_at:new Date("2026-01-31T12:00:00Z")}]})
      .mockResolvedValueOnce({rows:[{due_at:new Date("2026-02-04"),paid_at:new Date("2026-02-02")}]});
    const summary=await readNativeBillingSummary(7);
    expect(summary).toMatchObject({planName:"Starter",status:"paid",hasStripeCustomer:false});
    expect(summary.nextInvoiceDate).toBeInstanceOf(Date);
    expect(JSON.stringify(summary)).not.toMatch(/Cents|price|setup|instructions/i);
    expect(m.select).not.toHaveBeenCalled();
  });
  it.each(["active", "past_due", "canceled", "not_subscribed"] as const)("shows stored %s status without prices or payment identifiers", status => {
    const result = nativeBillingSummary({ ...state(), status }, false, now);
    expect(result.status).toBe(status);
    expect(result.planName).toBe("Starter");
    expect(Object.keys(result).sort()).toEqual(["billingEnabled", "hasStripeCustomer", "nextChargeDate", "nextInvoiceDate", "planName", "status"]);
    expect(JSON.stringify(result)).not.toMatch(/cus_fake|sub_fake|Cents|price|checkout/i);
  });
  it("only gives a future charge date for an existing recurring subscription", () => {
    expect(nativeBillingSummary(state(), true, now).nextChargeDate?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    for (const patch of [{ status: "canceled" as const }, { subscriptionId: null }, { periodEnd: "invalid" },
      { periodEnd: "2026-01-01" }, { cancelAt: "2026-11-01T00:00:00Z" }]) {
      expect(nativeBillingSummary({ ...state(), ...patch }, true, now).nextChargeDate).toBeNull();
    }
  });
  it("reads a scoped existing account with billing disabled; performs only SELECT", async () => {
    m.rows = [{ state: state(), customerId: "cus_fake", subscriptionId: "sub_fake" }];
    expect(await readNativeBillingSummary(7)).toMatchObject({ planName: "Starter", billingEnabled: false, hasStripeCustomer: true });
    expect(m.select).toHaveBeenCalledOnce();
    expect(m.where).toHaveBeenCalledWith({ column: "business_id", value: 7 });
  });
  it("does not create an account when none exists", async () => {
    expect(await readNativeBillingSummary(7)).toMatchObject({ planName: null, status: "not_subscribed",
      nextChargeDate: null, billingEnabled: false, hasStripeCustomer: false });
  });
});

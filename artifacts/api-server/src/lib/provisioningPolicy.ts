import type { Business, NewBusiness } from "@workspace/db";

export type Purchase = { phoneNumber: string; agentId: string };
export type PurchaseAttempt = { purchasedNumber: string | null; status: string };
export interface ProvisioningStore {
  lock<T>(account: string, work: () => Promise<T>): Promise<T>;
  find(account: string): Promise<Business | undefined>;
  create(input: NewBusiness): Promise<Business>;
  update?(business: Business, input: NewBusiness): Promise<Business>;
  attempt(account: string): Promise<PurchaseAttempt | undefined>;
  reserve(account: string, businessId: number, daily: number, total: number): Promise<boolean>;
  state(businessId: number, state: string): Promise<void>;
  purchased(account: string, purchase: Purchase): Promise<void>;
  attach(businessId: number, account: string, phoneNumber: string): Promise<Business>;
  failure(account: string, businessId: number, reason: string, purchase?: Purchase): Promise<void>;
}

export function provisioningCap(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
}

export async function guardedProvisioning(
  input: NewBusiness,
  store: ProvisioningStore,
  purchase: (businessId: number) => Promise<Purchase>,
  caps = {
    daily: provisioningCap(process.env.PHONE_PROVISIONING_DAILY_CAP, 5),
    total: provisioningCap(process.env.PHONE_PROVISIONING_TOTAL_CAP, 25),
  },
) {
  const account = input.clerkUserId;
  if (!account) throw new Error("An authenticated account is required to provision a number");
  return store.lock(account, async () => {
    const existing = await store.find(account);
    if (existing?.chosenPlan && input.chosenPlan && existing.chosenPlan !== input.chosenPlan) {
      throw new Error("Your plan is already saved. Please contact support to change it.");
    }
    if (input.isSample && existing?.retellPhoneNumber) {
      throw new Error("A live business cannot be converted to a sample. Use Preview sample call instead.");
    }
    const business = existing
      ? (store.update ? await store.update(existing, input) : existing)
      : await store.create({
      ...input,
      retellPhoneNumber: null,
      retellAgentId: null,
      provisioningState: input.isSample ? "sample" : "pending",
    });
    const result = (current: Business, error: unknown = null) => ({
      business: current,
      phoneProvisioningPending: !current.isSample && !current.retellPhoneNumber,
      provisioningError: error,
    });
    if (business.isSample || business.retellPhoneNumber) return result(business);
    if (business.chosenPlan && !business.firstInvoicePaidAt) {
      await store.state(business.id, "awaiting_payment");
      return result({ ...business, provisioningState: "awaiting_payment" });
    }

    let attempt: PurchaseAttempt | undefined;
    try {
      attempt = await store.attempt(account);
    } catch (error) {
      console.error("Provisioning journal lookup failed; business remains pending", { businessId: business.id });
      return result(business, error);
    }
    if (attempt?.purchasedNumber) {
      // Recover a completed purchase without making another provider request.
      try {
        return result(await store.attach(business.id, account, attempt.purchasedNumber));
      } catch (error) {
        await store.state(business.id, "recovery").catch((stateError) => {
          console.error("Could not record pending purchase recovery", { businessId: business.id, error: String(stateError) });
        });
        return result({ ...business, provisioningState: "recovery" }, error);
      }
    }
    // Existing pending businesses/uncertain requests are deliberately not purchased again.
    const firstPaidActivation = Boolean(business.chosenPlan && business.firstInvoicePaidAt
      && business.provisioningState === "awaiting_payment");
    if ((existing && !firstPaidActivation) || attempt) return result(business);
    try {
      if (!await store.reserve(account, business.id, caps.daily, caps.total)) {
        await store.state(business.id, "capped");
        return result({ ...business, provisioningState: "capped" });
      }
    } catch (error) {
      console.error("Provisioning budget reservation failed; no provider purchase attempted", { businessId: business.id });
      return result(business, error);
    }

    let bought: Purchase | undefined;
    try {
      await store.state(business.id, "purchasing");
      bought = await purchase(business.id);
      // Recovery evidence even if the database becomes unavailable at this exact point.
      console.info("Retell number purchased", { businessId: business.id, phoneNumber: bought.phoneNumber });
      await store.purchased(account, bought);
      return result(await store.attach(business.id, account, bought.phoneNumber));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Provisioning request failed";
      try {
        await store.failure(account, business.id, reason, bought);
      } catch (journalError) {
        console.error("Provisioning recovery journal unavailable; do not repurchase", {
          businessId: business.id, purchasedNumber: bought?.phoneNumber, error: String(journalError),
        });
      }
      return result({ ...business, provisioningState: bought ? "recovery" : "uncertain" }, error);
    }
  });
}
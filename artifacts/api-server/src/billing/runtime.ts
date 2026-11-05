import { BillingService } from "./service";
import { adminLivePaymentTestService } from "./adminLivePaymentTest";
import { billingStore } from "./store";
import { configuredBillingMode, getBillingStripe } from "./stripeClient";
import { provisionPaidBusinesses } from "../invoicing/worker";

function activeMode() {
  const mode = configuredBillingMode();
  if (mode === "off") throw new Error("Billing is disabled");
  return mode;
}

export const billingService = new BillingService(
  billingStore,
  getBillingStripe,
  () => new Date(),
  activeMode,
  businessId => provisionPaidBusinesses([businessId]),
);

export { adminLivePaymentTestService };

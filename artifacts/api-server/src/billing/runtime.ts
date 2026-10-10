import { BillingService } from "./service";
import { billingStore } from "./store";
import { getBillingStripe } from "./stripeClient";
export const billingService = new BillingService(billingStore, getBillingStripe);

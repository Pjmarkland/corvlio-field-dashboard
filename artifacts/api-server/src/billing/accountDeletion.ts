import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { recordOperationalFailure } from "../lib/operationalFailures";
import { runNotificationOutboxNow } from "../lib/notificationService";
import { getBillingStripe } from "./stripeClient";

export type DeletedAccountBillingResources = {
  sourceKey: string;
  businessId: number;
  businessName: string;
  subscriptionId: string | null;
  checkoutSessionId: string | null;
};

function idOf(value: string | Stripe.Subscription | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

/** Immediately cancel resources belonging to the deleted account. Live billing is refused by getBillingStripe. */
export async function cancelStripeResourcesForDeletion(resources: DeletedAccountBillingResources): Promise<void> {
  const stripe = getBillingStripe();
  let subscriptionId = resources.subscriptionId;

  if (resources.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(resources.checkoutSessionId, { expand: ["subscription"] });
    if (session.status === "open") {
      await stripe.checkout.sessions.expire(session.id);
    } else if (session.status === "complete") {
      subscriptionId ??= idOf(session.subscription);
    }
  }

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
      await stripe.subscriptions.cancel(subscriptionId);
    }
  }
}

export async function alertStripeCancellationFailure(
  resources: DeletedAccountBillingResources,
  error: unknown,
): Promise<void> {
  const eventHash = createHash("sha256").update(resources.sourceKey).digest("hex");
  const message = error instanceof Error ? error.message.slice(0, 240) : "Unknown Stripe cancellation error";
  const inserted = await recordOperationalFailure({
    eventKey: `account-deletion-billing:${eventHash}`,
    source: "account_deletion_billing",
    summary: "Stripe cancellation remains queued after account deletion",
    details: `Provider cancellation could not be confirmed; automatic retry is scheduled. ${message}`,
    businessName: resources.businessName,
  });
  if (inserted) {
    void runNotificationOutboxNow().catch(() => {
      // The operational-failure alert remains queued for the normal retry worker.
    });
  }
}

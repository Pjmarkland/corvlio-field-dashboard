import {
  businessesTable,
  db,
  notificationEventsTable,
  operationalFailuresTable,
} from "@workspace/db";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendAdminOperationalFailureEmail } from "./gmail";
import { emailDiagnosis } from "./emailDiagnostics";
import { enqueueWebPushDeliveries } from "./webPushService";

export type OperationalFailureSource =
  | "pre_call_fallback"
  | "post_call_webhook"
  | "lead_gmail_notification"
  | "phone_provisioning"
  | "account_deletion_balance"
  | "account_deletion_billing";

export type OperationalFailureInput = {
  eventKey: string;
  source: OperationalFailureSource;
  summary: string;
  details: string;
  businessId?: number | null;
  businessName?: string | null;
  /** Individual blank calls are recorded, but only the third consecutive one alerts. */
  suppressAlert?: boolean;
};

const FAILURE_SUMMARY_FALLBACK: Record<OperationalFailureSource, string> = {
  pre_call_fallback: "Retell pre-call service needs attention",
  post_call_webhook: "Retell post-call service needs attention",
  lead_gmail_notification: "Owner email delivery needs attention",
  phone_provisioning: "Business phone provisioning needs attention",
  account_deletion_balance: "Account deletion balance cleanup needs attention",
  account_deletion_billing: "Account deletion billing cleanup needs attention",
};

const FAILURE_SUMMARY_ALLOWLIST: Record<OperationalFailureSource, Record<string, string>> = {
  pre_call_fallback: {
    "Inbound business lookup failed; generic fallback used": "Retell pre-call lookup failed; fallback used",
    "Retell pre-call webhook rejected: invalid signature": "Retell pre-call webhook rejected: invalid signature",
    "Retell pre-call webhook rejected: malformed payload": "Retell pre-call webhook rejected: malformed payload",
    "Retell pre-call event could not be matched to a business": "Retell pre-call event could not be matched",
    "Retell pre-call lookup timed out; fallback response used": "Retell pre-call lookup timed out; fallback used",
    "Retell pre-call lookup failed; fallback response used": "Retell pre-call lookup failed; fallback used",
  },
  post_call_webhook: {
    "Blank or failed call": "Retell call ended without a complete lead",
    "Three consecutive blank or failed calls": "Repeated Retell calls did not produce complete leads",
    "Post-call webhook processing failed": "Retell post-call processing failed",
    "Retell post-call webhook rejected: invalid signature": "Retell post-call webhook rejected: invalid signature",
    "Retell post-call webhook rejected: malformed payload": "Retell post-call webhook rejected: malformed payload",
    "Retell post-call event could not be matched to a business": "Retell post-call event could not be matched",
    "Retell post-call processing failed": "Retell post-call processing failed",
  },
  lead_gmail_notification: {
    "Owner lead email blocked by Gmail configuration": "Owner lead email configuration needs attention",
    "Owner lead notification failed after five delivery attempts": "Owner lead email delivery failed after retries",
    "Admin Gmail test failed": "Admin email test failed",
  },
  phone_provisioning: {
    "Business phone-number provisioning is pending": "Business phone-number provisioning is pending",
  },
  account_deletion_balance: {
    "Stripe cancellation remains queued after account deletion": "Account deletion balance cleanup remains queued",
  },
  account_deletion_billing: {
    "Stripe cancellation remains queued after account deletion": "Account deletion billing cleanup remains queued",
  },
};

const FAILURE_DETAILS: Record<OperationalFailureSource, string> = {
  pre_call_fallback: "An inbound call used a fallback response. Review webhook health and business routing.",
  post_call_webhook: "A call event needs review. Check webhook health and lead processing.",
  lead_gmail_notification: "Lead email delivery needs review. Check the configured email channel and sending limits.",
  phone_provisioning: "Phone-number provisioning is incomplete. Review the pending business setup.",
  account_deletion_balance: "A balance cleanup remains pending after account deletion. Review payment status.",
  account_deletion_billing: "A billing cleanup remains pending after account deletion. Review payment status.",
};

export function allowlistedOperationalFailureSummary(
  source: OperationalFailureSource | string,
  summary: string,
): string {
  if (!Object.prototype.hasOwnProperty.call(FAILURE_SUMMARY_FALLBACK, source)) {
    return "Operational service needs attention";
  }
  const knownSource = source as OperationalFailureSource;
  return FAILURE_SUMMARY_ALLOWLIST[knownSource][summary] ?? FAILURE_SUMMARY_FALLBACK[knownSource];
}

export function allowlistedOperationalFailureDetails(source: OperationalFailureSource | string): string {
  if (!Object.prototype.hasOwnProperty.call(FAILURE_DETAILS, source)) {
    return "Operational service status needs review.";
  }
  return FAILURE_DETAILS[source as OperationalFailureSource];
}

function safeAlertDeliveryError(message: string, configurationFailure: boolean): string {
  if (configurationFailure) return "Operational alert email configuration is incomplete.";
  if (/429|rate.?limit|quota/i.test(message)) return "Operational alert email provider rate limited delivery.";
  return "Operational alert email delivery failed.";
}

export type FounderPushInput = {
  eventKey: string;
  title: string;
  body: string;
  deepLink: string;
};

export async function recordOperationalFailure(input: OperationalFailureInput): Promise<boolean> {
  const [record] = await db
    .insert(operationalFailuresTable)
    .values({
      eventKey: input.eventKey.slice(0, 240),
      source: input.source,
      summary: allowlistedOperationalFailureSummary(input.source, input.summary),
      details: allowlistedOperationalFailureDetails(input.source),
      alertBlocked: input.suppressAlert === true || emailDiagnosis(input.details).configuration,
      businessId: input.businessId ?? null,
      businessName: input.businessName?.slice(0, 200) ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: operationalFailuresTable.id });
  return Boolean(record);
}

/** Queue one idempotent push event for each internal Corvlio business account. */
export async function queueFounderPushNotification(input: FounderPushInput): Promise<boolean> {
  const targets = await db
    .select({ id: businessesTable.id })
    .from(businessesTable)
    .where(eq(businessesTable.isInternal, true));
  let insertedAny = false;

  for (const target of targets) {
    const businessId = String(target.id);
    const [event] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(notificationEventsTable)
        .values({
          businessId,
          leadId: `operational:${input.eventKey}`.slice(0, 240),
          title: input.title.slice(0, 200),
          body: input.body.slice(0, 1000),
          deepLink: input.deepLink,
        })
        .onConflictDoNothing()
        .returning({ id: notificationEventsTable.id });
      if (created) await enqueueWebPushDeliveries(tx, created.id, businessId);
      return [created];
    });
    insertedAny ||= Boolean(event);
  }

  return insertedAny;
}

export async function deliverOperationalFailureAlerts(): Promise<void> {
  const queued = await db
    .select({ id: operationalFailuresTable.id })
    .from(operationalFailuresTable)
    .where(and(
      isNull(operationalFailuresTable.alertSentAt),
      eq(operationalFailuresTable.alertBlocked, false),
      lte(operationalFailuresTable.alertNextAttemptAt, new Date()),
    ))
    .orderBy(operationalFailuresTable.createdAt)
    .limit(50);

  for (const item of queued) {
    await db.transaction(async (tx) => {
      const lock = await tx.execute(sql`
        SELECT pg_try_advisory_xact_lock(542319, ${item.id}) AS locked
      `);
      if (!lock.rows[0]?.locked) return;

      const [failure] = await tx
        .select()
        .from(operationalFailuresTable)
        .where(eq(operationalFailuresTable.id, item.id));
      if (!failure || failure.alertSentAt || failure.alertBlocked || failure.alertNextAttemptAt > new Date()) return;

      const attempts = failure.alertAttempts + 1;
      try {
        const sent = await sendAdminOperationalFailureEmail({
          source: failure.source,
          summary: allowlistedOperationalFailureSummary(failure.source, failure.summary),
          details: allowlistedOperationalFailureDetails(failure.source),
          businessId: failure.businessId,
          businessName: failure.businessName,
          occurredAt: failure.createdAt.toISOString(),
        });
        if (!sent) throw new Error("Gmail or ADMIN_EMAILS is not configured");
        await tx
          .update(operationalFailuresTable)
          .set({
            alertAttempts: attempts,
            alertSentAt: new Date(),
            alertLastError: null,
          })
          .where(eq(operationalFailuresTable.id, failure.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown email delivery error";
        const configurationFailure = emailDiagnosis(message).configuration;
        const safeMessage = safeAlertDeliveryError(message, configurationFailure);
        const delayMs = Math.min(6 * 60 * 60_000, 2 ** Math.min(attempts, 12) * 60_000);
        await tx
          .update(operationalFailuresTable)
          .set({
            alertAttempts: attempts,
            alertNextAttemptAt: new Date(Date.now() + delayMs),
            alertLastError: safeMessage,
            alertBlocked: configurationFailure,
          })
          .where(eq(operationalFailuresTable.id, failure.id));
        logger.warn(
          { failureId: failure.id, source: failure.source, attempts, configurationFailure },
          "Operational failure admin email delivery failed; retry scheduled",
        );
      }
    });
  }
}

export async function listRecentOperationalFailures() {
  const failures = await db
    .select()
    .from(operationalFailuresTable)
    .orderBy(desc(operationalFailuresTable.createdAt), desc(operationalFailuresTable.id))
    .limit(100);
  return failures.map((failure) => ({
    id: failure.id,
    source: failure.source,
    summary: allowlistedOperationalFailureSummary(failure.source, failure.summary),
    details: allowlistedOperationalFailureDetails(failure.source),
    businessId: failure.businessId,
    businessName: failure.businessName,
    createdAt: failure.createdAt.toISOString(),
    alertAttempts: failure.alertAttempts,
    alertSentAt: failure.alertSentAt?.toISOString() ?? null,
    alertLastError: failure.alertLastError
      ? "Operational alert email delivery failed."
      : null,
    alertBlocked: failure.alertBlocked,
  }));
}

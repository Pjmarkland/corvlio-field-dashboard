import {
  db,
  operationalFailuresTable,
} from "@workspace/db";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendAdminOperationalFailureEmail } from "./gmail";

export type OperationalFailureSource =
  | "pre_call_fallback"
  | "post_call_webhook"
  | "lead_gmail_notification"
  | "phone_provisioning";

export type OperationalFailureInput = {
  eventKey: string;
  source: OperationalFailureSource;
  summary: string;
  details: string;
  businessId?: number | null;
  businessName?: string | null;
};

function safeFailureDetails(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|access_token|refresh_token|client_secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500) || "No error details were provided.";
}

export async function recordOperationalFailure(input: OperationalFailureInput): Promise<boolean> {
  const [record] = await db
    .insert(operationalFailuresTable)
    .values({
      eventKey: input.eventKey.slice(0, 240),
      source: input.source,
      summary: input.summary.slice(0, 200),
      details: safeFailureDetails(input.details),
      businessId: input.businessId ?? null,
      businessName: input.businessName?.slice(0, 200) ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: operationalFailuresTable.id });
  return Boolean(record);
}

export async function deliverOperationalFailureAlerts(): Promise<void> {
  const queued = await db
    .select({ id: operationalFailuresTable.id })
    .from(operationalFailuresTable)
    .where(and(
      isNull(operationalFailuresTable.alertSentAt),
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
      if (!failure || failure.alertSentAt || failure.alertNextAttemptAt > new Date()) return;

      const attempts = failure.alertAttempts + 1;
      try {
        const sent = await sendAdminOperationalFailureEmail({
          source: failure.source,
          summary: failure.summary,
          details: failure.details,
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
        const message = safeFailureDetails(error instanceof Error ? error.message : "Unknown email delivery error");
        const delayMs = Math.min(6 * 60 * 60_000, 2 ** Math.min(attempts, 12) * 60_000);
        await tx
          .update(operationalFailuresTable)
          .set({
            alertAttempts: attempts,
            alertNextAttemptAt: new Date(Date.now() + delayMs),
            alertLastError: message,
          })
          .where(eq(operationalFailuresTable.id, failure.id));
        logger.warn(
          { failureId: failure.id, source: failure.source, attempts, error: message },
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
    summary: failure.summary,
    details: failure.details,
    businessId: failure.businessId,
    businessName: failure.businessName,
    createdAt: failure.createdAt.toISOString(),
    alertAttempts: failure.alertAttempts,
    alertSentAt: failure.alertSentAt?.toISOString() ?? null,
    alertLastError: failure.alertLastError,
  }));
}

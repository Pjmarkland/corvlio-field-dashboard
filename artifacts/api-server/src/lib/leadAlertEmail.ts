import { businessesTable, db, leadsTable, notificationEventsTable } from "@workspace/db";
import { and, eq, lte, sql } from "drizzle-orm";
import { sendLeadNotificationEmail } from "./gmail";
import { recordOperationalFailure } from "./operationalFailures";
import { runNotificationOutboxNow } from "./notificationService";

// Historical events default to skipped; only new real-lead events are queued.
export async function deliverLeadAlertEmails() {
  const events = await db.select({ id: notificationEventsTable.id }).from(notificationEventsTable).where(and(
    eq(notificationEventsTable.emailStatus, "queued"),
    lte(notificationEventsTable.emailNextAttemptAt, new Date()),
  )).limit(50);
  for (const event of events) {
    const terminalFailure = await db.transaction(async (tx) => {
      const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(542316, ${event.id}) AS locked`);
      if (!lock.rows[0]?.locked) return null;
      const [current] = await tx.select().from(notificationEventsTable).where(eq(notificationEventsTable.id, event.id));
      if (!current || current.emailStatus !== "queued" || current.emailNextAttemptAt > new Date()) return null;
      const [business] = await tx.select().from(businessesTable).where(sql`${businessesTable.id}::text = ${current.businessId}`);
      const [lead] = await tx.select().from(leadsTable).where(and(
        sql`${leadsTable.id}::text = ${current.leadId}`, eq(leadsTable.businessId, business?.id ?? -1),
      ));
      if (!business?.leadAlertsEnabled || business.isSample || !lead) {
        await tx.update(notificationEventsTable).set({ emailStatus: "skipped" }).where(eq(notificationEventsTable.id, event.id));
        return null;
      }
      const attempts = current.emailAttempts + 1;
      try {
        const sent = await sendLeadNotificationEmail({
          ownerEmail: business.ownerEmail, callerName: lead.callerName,
          phoneNumber: lead.callbackNumber || lead.phoneNumber, issue: lead.issueReason,
        });
        if (!sent) throw new Error("Email channel or owner email is not configured");
        await tx.update(notificationEventsTable).set({ emailStatus: "delivered", emailAttempts: attempts, emailLastError: null })
          .where(eq(notificationEventsTable.id, event.id));
        return null;
      } catch (error) {
        const details = error instanceof Error ? error.message : "Email delivery failed";
        await tx.update(notificationEventsTable).set({
          emailStatus: attempts >= 5 ? "failed" : "queued", emailAttempts: attempts,
          emailNextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
          emailLastError: details.slice(0, 300),
        }).where(eq(notificationEventsTable.id, event.id));
        if (attempts >= 5) {
          return { businessId: business.id, businessName: business.businessName, details };
        }
        return null;
      }
      return null;
    });
    if (terminalFailure) {
      try {
        const inserted = await recordOperationalFailure({
          eventKey: `lead-gmail:${event.id}`,
          source: "lead_gmail_notification",
          summary: "Owner lead notification failed after five delivery attempts",
          details: terminalFailure.details,
          businessId: terminalFailure.businessId,
          businessName: terminalFailure.businessName,
        });
        if (inserted) {
          void runNotificationOutboxNow().catch(() => {
            // The normal notification poller will retry delivery if the immediate pass fails.
          });
        }
      } catch {
        // Leave the lead email marked failed; a later notification cycle remains available.
      }
    }
  }
}
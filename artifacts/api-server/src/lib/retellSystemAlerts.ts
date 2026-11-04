import {
  db,
  retellSystemAlertsTable,
  retellWebhookHealthTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  queueFounderPushNotification,
  recordOperationalFailure,
  type OperationalFailureSource,
} from "./operationalFailures";
import { getWebPushReadiness } from "./webPushService";
import { runNotificationOutboxNow } from "./notificationService";
import { logger } from "./logger";

export type RetellWebhookEndpoint = "pre-call" | "post-call";
const ALERT_WINDOW_MS = 15 * 60_000;
const RETELL_ALERT_COPY: Partial<Record<string, (endpoint: RetellWebhookEndpoint) => { summary: string; details: string }>> = {
  invalid_signature: (endpoint) => ({
    summary: `Retell ${endpoint} webhook rejected: invalid signature`,
    details: "A webhook signature check failed. Confirm the provider URL and signing configuration.",
  }),
  malformed_payload: (endpoint) => ({
    summary: `Retell ${endpoint} webhook rejected: malformed payload`,
    details: "A webhook payload could not be parsed or validated.",
  }),
  unmatched_business: (endpoint) => ({
    summary: `Retell ${endpoint} event could not be matched to a business`,
    details: "The event did not match a configured business number. Review webhook routing.",
  }),
  pre_call_timeout: () => ({
    summary: "Retell pre-call lookup timed out; fallback response used",
    details: "The pre-call lookup exceeded its response window and used a generic fallback.",
  }),
  pre_call_error: () => ({
    summary: "Retell pre-call lookup failed; fallback response used",
    details: "The pre-call lookup failed and used a generic fallback.",
  }),
  post_call_processing_error: () => ({
    summary: "Retell post-call processing failed",
    details: "A post-call event could not be processed. Review webhook health and server status.",
  }),
};

function allowlistedRetellAlertText(endpoint: RetellWebhookEndpoint, category: string) {
  const copy = RETELL_ALERT_COPY[category];
  return {
    category: copy ? category : "webhook_error",
    ...(copy?.(endpoint) ?? {
      summary: `Retell ${endpoint} webhook needs attention`,
      details: "A Retell webhook event needs review.",
    }),
  };
}

export type RetellSystemAlertInput = {
  issueKey: string;
  endpoint: RetellWebhookEndpoint;
  category: string;
  summary: string;
  details: string;
  source: Extract<OperationalFailureSource, "pre_call_fallback" | "post_call_webhook">;
  businessId?: number | null;
  businessName?: string | null;
};

function notificationEventKey(issueKey: string, notifiedAt: Date): string {
  return `retell-system-alert:${issueKey}:${notifiedAt.getTime()}`.slice(0, 240);
}

async function notifyOwner(input: RetellSystemAlertInput, eventKey: string): Promise<void> {
  try {
    const emailQueued = await recordOperationalFailure({
      eventKey,
      source: input.source,
      summary: input.summary,
      details: input.details,
      businessId: input.businessId,
      businessName: input.businessName,
    });
    let pushQueued = false;
    if (getWebPushReadiness().configured) {
      pushQueued = await queueFounderPushNotification({
        eventKey,
        title: "Retell system alert",
        body: input.summary,
        deepLink: "/admin/system-alerts",
      });
    }
    if (emailQueued || pushQueued) {
      void runNotificationOutboxNow().catch((error) => {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Retell system alert delivery could not start",
        );
      });
    }
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError", endpoint: input.endpoint },
      "Retell system alert notification could not be queued",
    );
  }
}

/**
 * Keep one aggregated incident per issue. A database-side rolling window
 * ensures concurrent API instances notify no more than once every 15 minutes.
 */
export async function recordRetellSystemAlert(input: RetellSystemAlertInput): Promise<void> {
  const issueKey = input.issueKey.trim().slice(0, 180);
  const safeCopy = allowlistedRetellAlertText(input.endpoint, input.category);
  const safeInput = {
    ...input,
    category: safeCopy.category,
    summary: safeCopy.summary,
    details: safeCopy.details,
  };
  try {
    const [record] = await db
      .insert(retellSystemAlertsTable)
      .values({
        issueKey,
        endpoint: input.endpoint,
        category: safeInput.category,
        summary: safeInput.summary,
        details: safeInput.details,
        businessId: input.businessId ?? null,
        businessName: input.businessName?.slice(0, 200) ?? null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastNotifiedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: retellSystemAlertsTable.issueKey,
        set: {
          category: safeInput.category,
          summary: safeInput.summary,
          details: safeInput.details,
          businessId: input.businessId ?? null,
          businessName: input.businessName?.slice(0, 200) ?? null,
          lastSeenAt: new Date(),
          occurrenceCount: sql`${retellSystemAlertsTable.occurrenceCount} + 1`,
          lastNotifiedAt: sql`CASE
            WHEN ${retellSystemAlertsTable.lastNotifiedAt} IS NULL
              OR ${retellSystemAlertsTable.lastNotifiedAt} <= CURRENT_TIMESTAMP - (${ALERT_WINDOW_MS} * INTERVAL '1 millisecond')
            THEN CURRENT_TIMESTAMP
            ELSE ${retellSystemAlertsTable.lastNotifiedAt}
          END`,
          resolvedAt: null,
          resolvedBy: null,
        },
      })
      .returning({
        lastNotifiedAt: retellSystemAlertsTable.lastNotifiedAt,
        shouldNotify: sql<boolean>`${retellSystemAlertsTable.lastNotifiedAt} = CURRENT_TIMESTAMP`,
      });
    if (record?.shouldNotify && record.lastNotifiedAt) {
      void notifyOwner(safeInput, notificationEventKey(issueKey, record.lastNotifiedAt));
    }
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError", endpoint: input.endpoint },
      "Retell system alert could not be recorded",
    );
  }
}

export async function recordRetellWebhookSuccess(endpoint: RetellWebhookEndpoint): Promise<void> {
  const now = new Date();
  try {
    await db
      .insert(retellWebhookHealthTable)
      .values({ endpoint, lastSuccessfulAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: retellWebhookHealthTable.endpoint,
        set: { lastSuccessfulAt: now, updatedAt: now },
      });
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError", endpoint },
      "Retell webhook health timestamp could not be updated",
    );
  }
}

function serializeAlert(alert: typeof retellSystemAlertsTable.$inferSelect) {
  const safeCopy = allowlistedRetellAlertText(alert.endpoint, alert.category);
  return {
    id: alert.id,
    endpoint: alert.endpoint,
    category: safeCopy.category,
    summary: safeCopy.summary,
    details: safeCopy.details,
    businessId: alert.businessId,
    businessName: alert.businessName,
    firstSeenAt: alert.firstSeenAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    occurrenceCount: alert.occurrenceCount,
    status: alert.resolvedAt ? "resolved" as const : "open" as const,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    resolvedBy: alert.resolvedBy,
  };
}

export async function getAdminRetellSystemAlerts() {
  const [alerts, [openCount]] = await Promise.all([
    db
      .select()
      .from(retellSystemAlertsTable)
      .orderBy(desc(retellSystemAlertsTable.lastSeenAt), desc(retellSystemAlertsTable.id))
      .limit(100),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(retellSystemAlertsTable)
      .where(isNull(retellSystemAlertsTable.resolvedAt)),
  ]);
  return {
    alerts: alerts.map(serializeAlert),
    openCount: openCount?.count ?? 0,
  };
}

export async function getAdminRetellHealthCheck() {
  const [healthRows, openAlerts, [openCount]] = await Promise.all([
    db.select().from(retellWebhookHealthTable),
    db
      .select()
      .from(retellSystemAlertsTable)
      .where(isNull(retellSystemAlertsTable.resolvedAt))
      .orderBy(desc(retellSystemAlertsTable.lastSeenAt), desc(retellSystemAlertsTable.id))
      .limit(100),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(retellSystemAlertsTable)
      .where(isNull(retellSystemAlertsTable.resolvedAt)),
  ]);
  const lastSuccess = new Map(healthRows.map((row) => [row.endpoint, row.lastSuccessfulAt.toISOString()]));
  return {
    lastPreCallSuccessfulAt: lastSuccess.get("pre-call") ?? null,
    lastPostCallSuccessfulAt: lastSuccess.get("post-call") ?? null,
    openAlertCount: openCount?.count ?? 0,
    openAlerts: openAlerts.map(serializeAlert),
  };
}

export async function resolveRetellSystemAlert(alertId: number, resolvedBy: string): Promise<boolean> {
  const [resolved] = await db
    .update(retellSystemAlertsTable)
    .set({ resolvedAt: new Date(), resolvedBy: resolvedBy.slice(0, 320) })
    .where(and(
      eq(retellSystemAlertsTable.id, alertId),
      isNull(retellSystemAlertsTable.resolvedAt),
    ))
    .returning({ id: retellSystemAlertsTable.id });
  return Boolean(resolved);
}

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

function safeDetails(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|access_token|refresh_token|client_secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500) || "No error details were provided.";
}

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
  const details = safeDetails(input.details);
  try {
    const [record] = await db
      .insert(retellSystemAlertsTable)
      .values({
        issueKey,
        endpoint: input.endpoint,
        category: input.category.slice(0, 80),
        summary: input.summary.slice(0, 200),
        details,
        businessId: input.businessId ?? null,
        businessName: input.businessName?.slice(0, 200) ?? null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastNotifiedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: retellSystemAlertsTable.issueKey,
        set: {
          category: input.category.slice(0, 80),
          summary: input.summary.slice(0, 200),
          details,
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
      void notifyOwner({ ...input, details }, notificationEventKey(issueKey, record.lastNotifiedAt));
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
  return {
    id: alert.id,
    endpoint: alert.endpoint,
    category: alert.category,
    summary: alert.summary,
    details: alert.details,
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

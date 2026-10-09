import { randomUUID } from "node:crypto";
import {
  db,
  businessesTable,
  notificationDeliveryAttemptsTable,
  notificationDevicesTable,
  notificationEventsTable,
  notificationPollerLeasesTable,
  notificationPollStateTable,
  notificationSeenLeadsTable,
} from "@workspace/db";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Business } from "./businessRegistry";
import { sendApnsNotification, isApnsConfigured } from "./apnsAdapter";
import { readGoogleSheetLeads } from "./googleSheets";
import { logger } from "./logger";
import { deliverLeadAlertEmails } from "./leadAlertEmail";
import { deliverOperationalFailureAlerts } from "./operationalFailures";

const POLL_INTERVAL_MS = 60_000;
const SHEETS_READ_TIMEOUT_MS = 55_000; // must be < POLLER_LEASE_MS
const POLLER_LEASE_NAME = "lead-notification-poller";
const POLLER_OWNER_ID = randomUUID();
// Lease is long enough to cover all businesses in one cycle, plus a buffer.
// Heartbeat renews it every LEASE_RENEWAL_INTERVAL_MS so it never expires mid-cycle.
const POLLER_LEASE_MS = 120_000;
const LEASE_RENEWAL_INTERVAL_MS = 30_000;

export type NotificationPollResult = {
  businessId: string;
  baselineCreated: boolean;
  rowsRead: number;
  newEvents: number;
  duplicateRows: number;
  polledAt: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ).unref(),
    ),
  ]);
}

function eventCopy(lead: { id: string; name: string; issue: string }) {
  const firstName = lead.name.trim().split(/\s+/, 1)[0] || "A new caller";
  return {
    title: `New lead from ${firstName}`,
    body: lead.issue || "A new receptionist lead is waiting.",
    deepLink: `/leads/${encodeURIComponent(lead.id)}`,
  };
}

export async function pollBusinessForNewLeads(
  business: Business,
): Promise<NotificationPollResult> {
  const polledAt = new Date();

  try {
    const { leads } = await withTimeout(
      readGoogleSheetLeads(business.googleSheetId),
      SHEETS_READ_TIMEOUT_MS,
      `Sheets read for ${business.id}`,
    );

    const result = await db.transaction(async (tx) => {
      const [state] = await tx
        .select()
        .from(notificationPollStateTable)
        .where(eq(notificationPollStateTable.businessId, business.id))
        .limit(1);

      const baselineCreated = !state?.initializedAt;
      let newEvents = 0;
      let duplicateRows = 0;

      for (const lead of leads) {
        const [newSeenLead] = await tx
          .insert(notificationSeenLeadsTable)
          .values({
            businessId: business.id,
            leadId: lead.id,
            baseline: baselineCreated,
          })
          .onConflictDoNothing()
          .returning({ leadId: notificationSeenLeadsTable.leadId });

        // Row already existed in seen_leads — it's a duplicate.
        if (!newSeenLead) {
          duplicateRows += 1;
          continue;
        }

        // First time we've seen this lead, but this is a baseline cycle — just
        // record it without enqueuing an alert.
        if (baselineCreated) continue;

        const copy = eventCopy(lead);
        const [event] = await tx
          .insert(notificationEventsTable)
          .values({
            businessId: business.id,
            leadId: lead.id,
            ...copy,
          })
          .onConflictDoNothing()
          .returning({ id: notificationEventsTable.id });
        if (event) newEvents += 1;
      }

      await tx
        .insert(notificationPollStateTable)
        .values({
          businessId: business.id,
          initializedAt: polledAt,
          lastPolledAt: polledAt,
          lastSucceededAt: polledAt,
          lastError: null,
          updatedAt: polledAt,
        })
        .onConflictDoUpdate({
          target: notificationPollStateTable.businessId,
          set: {
            initializedAt: sql`coalesce(${notificationPollStateTable.initializedAt}, ${polledAt})`,
            lastPolledAt: polledAt,
            lastSucceededAt: polledAt,
            lastError: null,
            updatedAt: polledAt,
          },
        });

      return { baselineCreated, newEvents, duplicateRows };
    });

    return {
      businessId: business.id,
      baselineCreated: result.baselineCreated,
      rowsRead: leads.length,
      newEvents: result.newEvents,
      duplicateRows: result.duplicateRows,
      polledAt: polledAt.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown polling error";
    await db
      .insert(notificationPollStateTable)
      .values({
        businessId: business.id,
        lastPolledAt: polledAt,
        lastError: message,
        updatedAt: polledAt,
      })
      .onConflictDoUpdate({
        target: notificationPollStateTable.businessId,
        set: {
          lastPolledAt: polledAt,
          lastError: message,
          updatedAt: polledAt,
        },
      });
    throw error;
  }
}

// Acquire the DB-backed lease. Only succeeds if no other process holds it or
// it has expired. Does NOT allow re-entry by the same owner — the in-process
// cycleInFlight guard prevents that before this is called.
async function acquirePollerLease(): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + POLLER_LEASE_MS);
  const rows = await db
    .insert(notificationPollerLeasesTable)
    .values({
      name: POLLER_LEASE_NAME,
      ownerId: POLLER_OWNER_ID,
      lockedUntil,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationPollerLeasesTable.name,
      set: {
        ownerId: POLLER_OWNER_ID,
        lockedUntil,
        updatedAt: now,
      },
      // Only take the lease if it is expired — never allow re-entry by the same
      // owner here; the in-flight guard is the right place for that.
      setWhere: sql`${notificationPollerLeasesTable.lockedUntil} < now()`,
    })
    .returning({ ownerId: notificationPollerLeasesTable.ownerId });
  return rows[0]?.ownerId === POLLER_OWNER_ID;
}

async function renewPollerLease(): Promise<void> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + POLLER_LEASE_MS);
  await db
    .update(notificationPollerLeasesTable)
    .set({ lockedUntil, updatedAt: now })
    .where(
      and(
        eq(notificationPollerLeasesTable.name, POLLER_LEASE_NAME),
        eq(notificationPollerLeasesTable.ownerId, POLLER_OWNER_ID),
      ),
    );
}

async function releasePollerLease(): Promise<void> {
  await db
    .update(notificationPollerLeasesTable)
    .set({ lockedUntil: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notificationPollerLeasesTable.name, POLLER_LEASE_NAME),
        eq(notificationPollerLeasesTable.ownerId, POLLER_OWNER_ID),
      ),
    );
}

// ─── APNs outbox processor ────────────────────────────────────────────────────

const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * Process all queued notification events and attempt delivery to registered
 * iOS devices via APNs. Marks events delivered/failed and records per-device
 * attempt rows in notification_delivery_attempts.
 */
async function processNotificationOutbox(): Promise<void> {
  if (!isApnsConfigured()) {
    logger.debug("APNs not configured — skipping outbox processing");
    return;
  }

  const now = new Date();

  // Fetch events that are ready for (re-)delivery.
  const events = await db
    .select()
    .from(notificationEventsTable)
    .where(
      and(
        eq(notificationEventsTable.status, "queued"),
        lte(notificationEventsTable.nextAttemptAt, now),
        sql`${notificationEventsTable.attempts} < ${MAX_DELIVERY_ATTEMPTS}`,
      ),
    )
    .limit(50);

  if (events.length === 0) return;

  logger.info({ count: events.length }, "Processing notification outbox");

  for (const queuedEvent of events) {
    await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(542317, ${queuedEvent.id}) AS locked`);
    if (!lock.rows[0]?.locked) return;
    const [event] = await tx.select().from(notificationEventsTable).where(eq(notificationEventsTable.id, queuedEvent.id));
    if (!event || event.status !== "queued" || event.nextAttemptAt > new Date() || event.attempts >= MAX_DELIVERY_ATTEMPTS) return;
    const [business] = await db.select().from(businessesTable)
      .where(sql`${businessesTable.id}::text = ${event.businessId}`);
    if (!business || !business.leadAlertsEnabled || business.isSample) {
      await db.update(notificationEventsTable).set({ status: "failed", lastError: "Business alerts disabled", attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(notificationEventsTable.id, event.id));
      return;
    }
    // Fetch active iOS devices for this business.
    const devices = await db
      .select()
      .from(notificationDevicesTable)
      .where(
        and(
          eq(notificationDevicesTable.businessId, event.businessId),
          eq(notificationDevicesTable.platform, "ios"),
          eq(notificationDevicesTable.enabled, true),
          sql`${notificationDevicesTable.invalidatedAt} is null`,
        ),
      );

    const newAttempts = event.attempts + 1;

    if (devices.length === 0) {
      logger.debug({ eventId: event.id, businessId: event.businessId }, "No active iOS devices — deferring event");
      // Increment attempts so events don't spin forever when no devices are
      // registered yet; they will be retried until MAX_DELIVERY_ATTEMPTS.
      const nextAttemptAt = new Date(now.getTime() + Math.pow(2, newAttempts) * 60_000);
      await db
        .update(notificationEventsTable)
        .set({ attempts: newAttempts, lastError: "No active iOS devices", nextAttemptAt })
        .where(eq(notificationEventsTable.id, event.id));
      return;
    }

    let anyDelivered = false;
    let lastError: string | null = null;

    for (const device of devices) {
      const result = await sendApnsNotification({
        deviceToken: device.token,
        title: event.title,
        body: event.body,
        deepLink: event.deepLink,
      });

      // Record the per-device attempt.
      await db.insert(notificationDeliveryAttemptsTable).values({
        eventId: event.id,
        deviceId: device.id,
        provider: "apns",
        outcome: result.outcome,
        providerMessageId: result.outcome === "delivered" ? (result.apnsId ?? null) : null,
        error:
          result.outcome === "invalid_token"
            ? "invalid_token (410)"
            : result.outcome === "error"
              ? (result.reason ?? `HTTP ${result.statusCode}`)
              : null,
        attemptedAt: now,
      });

      if (result.outcome === "delivered") {
        anyDelivered = true;
        logger.info({ eventId: event.id, deviceId: device.id }, "APNs delivery succeeded");
      } else if (result.outcome === "invalid_token") {
        // 410 Gone — the device token is no longer valid.
        logger.info(
          { deviceId: device.id, tokenSuffix: device.token.slice(-8) },
          "APNs 410 Gone — invalidating device token",
        );
        await db
          .update(notificationDevicesTable)
          .set({ enabled: false, invalidatedAt: now, updatedAt: now })
          .where(eq(notificationDevicesTable.id, device.id));
      } else {
        lastError = result.reason ?? `HTTP ${result.statusCode}`;
        logger.warn(
          { eventId: event.id, deviceId: device.id, statusCode: result.statusCode, reason: result.reason },
          "APNs delivery failed",
        );
      }
    }

    // Update the event record with the outcome of this attempt batch.
    if (anyDelivered) {
      await db
        .update(notificationEventsTable)
        .set({ status: "delivered", attempts: newAttempts, deliveredAt: now, lastError: null })
        .where(eq(notificationEventsTable.id, event.id));
      logger.info({ eventId: event.id }, "Notification event marked delivered");
    } else if (newAttempts >= MAX_DELIVERY_ATTEMPTS) {
      await db
        .update(notificationEventsTable)
        .set({ status: "failed", attempts: newAttempts, lastError: lastError ?? "All delivery attempts exhausted" })
        .where(eq(notificationEventsTable.id, event.id));
      logger.warn({ eventId: event.id }, "Notification event permanently failed");
    } else {
      // Exponential back-off: 2^attempts minutes (2 min, 4 min, …).
      const nextAttemptAt = new Date(now.getTime() + Math.pow(2, newAttempts) * 60_000);
      await db
        .update(notificationEventsTable)
        .set({ attempts: newAttempts, lastError, nextAttemptAt })
        .where(eq(notificationEventsTable.id, event.id));
      logger.debug({ eventId: event.id, nextAttemptAt }, "Notification event scheduled for retry");
    }
    });
  }
}

export async function runNotificationPollCycle(): Promise<void> {
  if (!(await acquirePollerLease())) {
    logger.debug("Skipping lead poll because another server owns the lease");
    return;
  }

  // Renew the lease periodically so it never expires during a long cycle.
  const heartbeat = setInterval(() => {
    void renewPollerLease().catch((error) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Failed to renew poller lease during cycle",
      );
    });
  }, LEASE_RENEWAL_INTERVAL_MS);
  heartbeat.unref();

  try {
    // The owner workspace now reads PostgreSQL leads. Do not also poll legacy
    // Make/Sheets logs: that would generate duplicate or historical alerts.
    try {
      await runNotificationOutboxNow();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Notification outbox processing failed",
      );
    }
  } finally {
    clearInterval(heartbeat);
    await releasePollerLease();
  }
}

let outboxPromise: Promise<void> | null = null;
let outboxRequested = false;

export function runNotificationOutboxNow(): Promise<void> {
  if (outboxPromise) { outboxRequested = true; return outboxPromise; }
  outboxPromise = (async () => {
    do {
      outboxRequested = false;
      await Promise.all([
        deliverLeadAlertEmails(),
        deliverOperationalFailureAlerts(),
        processNotificationOutbox(),
      ]);
    } while (outboxRequested);
  })().finally(() => {
    outboxPromise = null;
  });
  return outboxPromise;
}

// ─── Poller lifecycle ─────────────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null;
// True while a cycle is in progress — prevents overlapping cycles from the
// same process regardless of how long a cycle takes.
let cycleInFlight = false;
// Resolves when the active cycle completes; null when no cycle is running.
let cyclePromise: Promise<void> | null = null;

export function startLeadNotificationPoller(): void {
  if (pollTimer) return;

  const runOnce = () => {
    if (cycleInFlight) {
      logger.debug("Skipping lead poll tick because previous cycle is still in progress");
      return;
    }
    cycleInFlight = true;
    cyclePromise = runNotificationPollCycle()
      .catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : "Unknown polling error" },
          "Lead notification poll cycle failed",
        );
      })
      .finally(() => {
        cycleInFlight = false;
        cyclePromise = null;
      });
  };

  runOnce();
  pollTimer = setInterval(runOnce, POLL_INTERVAL_MS);
  pollTimer.unref();
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Lead notification retry worker started (new events deliver immediately)");
}

/** Stop scheduling new cycles and wait for any in-progress cycle to finish. */
export async function stopLeadNotificationPoller(): Promise<void> {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  logger.info("Lead notification poller stopping — waiting for in-flight cycle");
  if (cyclePromise) await cyclePromise;
  logger.info("Lead notification poller stopped");
}

// ─── Status / device management ──────────────────────────────────────────────

export async function getNotificationStatus(
  clerkUserId: string,
  businessId: string,
) {
  const [devices, state] = await Promise.all([
    db
      .select({
        id: notificationDevicesTable.id,
        platform: notificationDevicesTable.platform,
        enabled: notificationDevicesTable.enabled,
        lastSeenAt: notificationDevicesTable.lastSeenAt,
      })
      .from(notificationDevicesTable)
      .where(
        and(
          eq(notificationDevicesTable.clerkUserId, clerkUserId),
          eq(notificationDevicesTable.businessId, businessId),
          sql`${notificationDevicesTable.invalidatedAt} is null`,
        ),
      )
      .orderBy(desc(notificationDevicesTable.lastSeenAt)),
    db
      .select()
      .from(notificationPollStateTable)
      .where(eq(notificationPollStateTable.businessId, businessId))
      .limit(1),
  ]);

  return {
    enabledDeviceCount: devices.filter((device) => device.enabled).length,
    devices: devices.map((device) => ({
      ...device,
      platform: device.platform as "ios" | "android",
      lastSeenAt: device.lastSeenAt.toISOString(),
    })),
    poller: {
      initialized: Boolean(state[0]?.initializedAt),
      lastSucceededAt: state[0]?.lastSucceededAt?.toISOString() ?? null,
      lastError: state[0]?.lastError ?? null,
    },
  };
}

export async function registerNotificationDevice(input: {
  clerkUserId: string;
  businessId: string;
  platform: "ios" | "android";
  token: string;
  enabled: boolean;
}) {
  const now = new Date();
  const [device] = await db
    .insert(notificationDevicesTable)
    .values({
      ...input,
      lastSeenAt: now,
      updatedAt: now,
      invalidatedAt: null,
    })
    .onConflictDoUpdate({
      target: notificationDevicesTable.token,
      set: {
        clerkUserId: input.clerkUserId,
        businessId: input.businessId,
        platform: input.platform,
        enabled: input.enabled,
        lastSeenAt: now,
        updatedAt: now,
        invalidatedAt: null,
      },
    })
    .returning({
      id: notificationDevicesTable.id,
      platform: notificationDevicesTable.platform,
      enabled: notificationDevicesTable.enabled,
      lastSeenAt: notificationDevicesTable.lastSeenAt,
    });

  if (!device) throw new Error("Device registration did not return a record");
  return {
    ...device,
    platform: device.platform as "ios" | "android",
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

export async function revokeNotificationDevice(input: {
  deviceId: number;
  clerkUserId: string;
  businessId: string;
}): Promise<boolean> {
  const [device] = await db
    .update(notificationDevicesTable)
    .set({ enabled: false, invalidatedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notificationDevicesTable.id, input.deviceId),
        eq(notificationDevicesTable.clerkUserId, input.clerkUserId),
        eq(notificationDevicesTable.businessId, input.businessId),
      ),
    )
    .returning({ id: notificationDevicesTable.id });
  return Boolean(device);
}

export async function listNotificationOutbox(businessId: string) {
  const events = await db
    .select({
      id: notificationEventsTable.id,
      leadId: notificationEventsTable.leadId,
      status: notificationEventsTable.status,
      attempts: notificationEventsTable.attempts,
      createdAt: notificationEventsTable.createdAt,
      deliveredAt: notificationEventsTable.deliveredAt,
      lastError: notificationEventsTable.lastError,
    })
    .from(notificationEventsTable)
    .where(eq(notificationEventsTable.businessId, businessId))
    .orderBy(desc(notificationEventsTable.createdAt))
    .limit(50);

  return events.map((event) => ({
    ...event,
    status: event.status as "queued" | "delivered" | "failed",
    createdAt: event.createdAt.toISOString(),
    deliveredAt: event.deliveredAt?.toISOString() ?? null,
  }));
}

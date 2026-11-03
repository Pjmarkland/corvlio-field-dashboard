import webPush from "web-push";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;
const RETRY_BASE_MS = 60_000;

export class WebPushConfigurationError extends Error {}

type VapidConfiguration = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

type ClaimedDelivery = {
  delivery_id: number;
  attempts: number;
  event_id: number;
  title: string;
  body: string;
  deep_link: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_at: Date | null;
  lead_alerts_enabled: boolean;
  is_sample: boolean;
};

export type WebPushReadiness = {
  configured: boolean;
  publicKeyPresent: boolean;
  privateKeyPresent: boolean;
  subjectPresent: boolean;
  subjectValid: boolean;
};

function isValidVapidSubject(subject: string | undefined): boolean {
  if (!subject) return false;
  if (subject.startsWith("mailto:")) return /^mailto:[^\s@]+@[^\s@]+$/.test(subject);
  try {
    const url = new URL(subject);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getWebPushReadiness(
  env: Record<string, string | undefined> = process.env,
): WebPushReadiness {
  const publicKeyPresent = Boolean(env.VAPID_PUBLIC_KEY?.trim());
  const privateKeyPresent = Boolean(env.VAPID_PRIVATE_KEY?.trim());
  const subject = env.VAPID_SUBJECT?.trim();
  const subjectPresent = Boolean(subject);
  const subjectValid = isValidVapidSubject(subject);
  return {
    configured: publicKeyPresent && privateKeyPresent && subjectValid,
    publicKeyPresent,
    privateKeyPresent,
    subjectPresent,
    subjectValid,
  };
}

function getVapidConfiguration(): VapidConfiguration | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey) {
    throw new WebPushConfigurationError("Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured");
  }
  if (!subject) {
    throw new WebPushConfigurationError("VAPID_SUBJECT must be configured");
  }
  if (!isValidVapidSubject(subject)) {
    throw new WebPushConfigurationError("VAPID_SUBJECT must be a valid mailto: or HTTPS URL");
  }
  return { publicKey, privateKey, subject };
}

export function getWebPushPublicConfig(): { available: boolean; publicKey: string | null } {
  const config = getVapidConfiguration();
  return { available: Boolean(config), publicKey: config?.publicKey ?? null };
}

export type WebPushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
};

export async function registerWebPushSubscription(input: {
  clerkUserId: string;
  businessId: number;
  subscription: WebPushSubscriptionInput;
}): Promise<boolean> {
  if (!getVapidConfiguration()) throw new WebPushConfigurationError("Browser push is not configured");
  const expirationAt = input.subscription.expirationTime == null
    ? null
    : new Date(input.subscription.expirationTime);
  if (expirationAt && !Number.isFinite(expirationAt.getTime())) {
    throw new TypeError("Invalid subscription expiration time");
  }

  const result = await pool.query(
    `INSERT INTO web_push_subscriptions
      (clerk_user_id, business_id, endpoint, p256dh, auth, expiration_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       expiration_at = EXCLUDED.expiration_at,
       updated_at = now()
     WHERE web_push_subscriptions.clerk_user_id = EXCLUDED.clerk_user_id
       AND web_push_subscriptions.business_id = EXCLUDED.business_id
     RETURNING id`,
    [
      input.clerkUserId,
      input.businessId,
      input.subscription.endpoint,
      input.subscription.keys.p256dh,
      input.subscription.keys.auth,
      expirationAt,
    ],
  );
  return result.rowCount === 1;
}

export async function revokeWebPushSubscription(input: {
  clerkUserId: string;
  businessId: number;
  endpoint: string;
}): Promise<void> {
  await pool.query(
    `DELETE FROM web_push_subscriptions
     WHERE clerk_user_id = $1 AND business_id = $2 AND endpoint = $3`,
    [input.clerkUserId, input.businessId, input.endpoint],
  );
}

type SqlExecutor = { execute(query: SQL): Promise<unknown> };

/** Enqueue only subscriptions belonging to the business that owns this event. */
export async function enqueueWebPushDeliveries(
  tx: SqlExecutor,
  eventId: number,
  businessId: string | number,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO web_push_deliveries (event_id, subscription_id)
    SELECT ${eventId}, s.id
    FROM web_push_subscriptions s
    WHERE s.business_id::text = ${String(businessId)}
      AND (s.expiration_at IS NULL OR s.expiration_at > now())
    ON CONFLICT (event_id, subscription_id) DO NOTHING
  `);
}

async function pruneExpiredSubscriptions(): Promise<void> {
  await pool.query(
    `DELETE FROM web_push_subscriptions
     WHERE expiration_at IS NOT NULL AND expiration_at <= now()`,
  );
}

function getProviderStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

async function updateDelivery(
  deliveryId: number,
  values: { status: string; delivered?: boolean; attempts?: number; retryMs?: number; error?: string },
): Promise<void> {
  if (values.delivered) {
    await pool.query(
      `UPDATE web_push_deliveries
       SET status = $2, delivered_at = now(), claim_until = NULL, last_error = NULL
       WHERE id = $1`,
      [deliveryId, values.status],
    );
    return;
  }

  if (values.retryMs != null) {
    await pool.query(
      `UPDATE web_push_deliveries
       SET status = $2, next_attempt_at = now() + ($3 * interval '1 millisecond'),
           claim_until = NULL, last_error = $4
       WHERE id = $1`,
      [deliveryId, values.status, values.retryMs, values.error ?? null],
    );
    return;
  }

  await pool.query(
    `UPDATE web_push_deliveries
     SET status = $2, claim_until = NULL, last_error = $3
     WHERE id = $1`,
    [deliveryId, values.status, values.error ?? null],
  );
}

export async function processWebPushOutbox(): Promise<void> {
  await pruneExpiredSubscriptions();
  const config = getVapidConfiguration();
  if (!config) {
    logger.debug("Web Push is not configured; leaving queued browser notifications pending");
    return;
  }

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const claimed = await pool.query<ClaimedDelivery>(
    `WITH due AS (
       SELECT d.id
       FROM web_push_deliveries d
       WHERE (
         (d.status = 'queued' AND d.next_attempt_at <= now())
         OR (d.status = 'processing' AND d.claim_until <= now())
       )
       ORDER BY d.next_attempt_at, d.id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     ),
     claimed AS (
       UPDATE web_push_deliveries d
       SET status = 'processing', attempts = d.attempts + 1,
           claim_until = now() + interval '2 minutes'
       FROM due
       WHERE d.id = due.id
       RETURNING d.id, d.attempts, d.event_id, d.subscription_id
     )
     SELECT c.id AS delivery_id, c.attempts, e.id AS event_id, e.title, e.body,
            e.deep_link, s.endpoint, s.p256dh, s.auth, s.expiration_at,
            b.lead_alerts_enabled, b.is_sample
     FROM claimed c
     JOIN notification_events e ON e.id = c.event_id
     JOIN web_push_subscriptions s ON s.id = c.subscription_id
     JOIN businesses b ON b.id = s.business_id
     WHERE s.business_id::text = e.business_id`,
    [BATCH_SIZE],
  );

  for (const delivery of claimed.rows) {
    if (!delivery.lead_alerts_enabled || delivery.is_sample) {
      await updateDelivery(delivery.delivery_id, { status: "skipped", error: "Business alerts disabled" });
      continue;
    }
    if (delivery.expiration_at && delivery.expiration_at.getTime() <= Date.now()) {
      await pool.query(
        `DELETE FROM web_push_subscriptions WHERE endpoint = $1`,
        [delivery.endpoint],
      );
      continue;
    }

    try {
      await webPush.sendNotification(
        {
          endpoint: delivery.endpoint,
          keys: { p256dh: delivery.p256dh, auth: delivery.auth },
        },
        JSON.stringify({
          title: delivery.title,
          body: delivery.body,
          deepLink: delivery.deep_link,
        }),
        { TTL: 60, urgency: "high" },
      );
      await updateDelivery(delivery.delivery_id, { status: "delivered", delivered: true });
    } catch (error) {
      const providerStatus = getProviderStatus(error);
      if (providerStatus === 404 || providerStatus === 410) {
        await pool.query(
          `DELETE FROM web_push_subscriptions WHERE endpoint = $1`,
          [delivery.endpoint],
        );
        logger.info({ deliveryId: delivery.delivery_id, providerStatus }, "Removed expired Web Push subscription");
        continue;
      }

      const exhausted = delivery.attempts >= MAX_ATTEMPTS;
      const retryMs = RETRY_BASE_MS * 2 ** Math.max(0, delivery.attempts - 1);
      if (exhausted) {
        await updateDelivery(delivery.delivery_id, {
          status: "failed",
          error: providerStatus ? `Push service returned ${providerStatus}` : "Push service request failed",
        });
      } else {
        await updateDelivery(delivery.delivery_id, {
          status: "queued",
          retryMs,
          error: providerStatus ? `Push service returned ${providerStatus}` : "Push service request failed",
        });
      }
      logger.warn(
        { deliveryId: delivery.delivery_id, providerStatus, exhausted },
        "Web Push delivery attempt failed",
      );
    }
  }
}

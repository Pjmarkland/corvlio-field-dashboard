import { db, billingNoticesTable, notificationDevicesTable } from "@workspace/db";
import { and, eq, lte, sql } from "drizzle-orm";
import { billingEnabled } from "./stripeClient";
import { billingService } from "./runtime";
import { billingStore } from "./store";
import { config, billingUrl } from "./policy";
import { sendBillingNotificationEmail } from "../lib/gmail";
import { sendApnsNotification } from "../lib/apnsAdapter";
import { logger } from "../lib/logger";
import { runBillingEnforcementCycle } from "./enforcement";

let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
async function deliverPendingNotices() {
  // Claim one row at a time; do not lease an entire batch which might expire
  // before the last message begins. Persist channel/device progress separately.
  for (let i = 0; i < 20; i++) {
    const notice = await db.transaction(async tx => {
      const row = (await tx.select().from(billingNoticesTable).where(and(
        lte(billingNoticesTable.nextAttemptAt, new Date()),
        sql`NOT ((${billingNoticesTable.delivery}->>'email')::boolean AND (${billingNoticesTable.delivery}->>'push')::boolean)`,
      )).limit(1).for("update", { skipLocked: true }))[0];
      if (!row) return null;
      await tx.update(billingNoticesTable).set({
        nextAttemptAt: new Date(Date.now() + config.operations.notificationLeaseMinutes * 60_000),
      }).where(eq(billingNoticesTable.id, row.id));
      return row;
    });
    if (!notice) return;
    const progress = { ...notice.delivery };
    const save = (release = false) => db.update(billingNoticesTable).set({
      delivery: progress, nextAttemptAt: new Date(Date.now() + (release ? config.operations.notificationRetryMinutes : config.operations.notificationLeaseMinutes) * 60_000),
    }).where(eq(billingNoticesTable.id, notice.id));
    try {
      const business = await billingStore.business(notice.businessId);
      if (!business) continue;
      const link = notice.audience === "owner" ? billingUrl(undefined, true) : billingUrl(config.operations.adminPath);
      const body = `${business.businessName}\n\n${notice.body}\n\n${link}`;
      if (!progress.email) {
        const recipients = notice.audience === "owner" ? [business.ownerEmail].filter((v): v is string => !!v)
          : [...new Set((process.env.ADMIN_EMAILS ?? "").split(",").map(s => s.trim()).filter(Boolean))];
        progress.emailRecipients ??= [];
        for (const recipient of recipients) {
          if (progress.emailRecipients.includes(recipient)) continue;
          try {
            if (await sendBillingNotificationEmail(recipient, notice.title, body)) {
              progress.emailRecipients.push(recipient);
              await save();
            }
          } catch { logger.warn({ noticeId: notice.id }, "Billing email pending; other channels continue"); }
        }
        progress.email = recipients.length > 0 && recipients.every(r => progress.emailRecipients!.includes(r));
        await save();
      }
      if (!progress.push) {
        const devices = notice.audience === "owner" ? await db.select().from(notificationDevicesTable).where(and(
          eq(notificationDevicesTable.businessId, String(notice.businessId)),
          eq(notificationDevicesTable.clerkUserId, business.clerkUserId ?? ""),
          eq(notificationDevicesTable.platform, "ios"), eq(notificationDevicesTable.enabled, true),
        )) : [];
        progress.deviceIds ??= [];
        for (const device of devices) {
          if (progress.deviceIds.includes(device.id)) continue;
          const result = await sendApnsNotification({
            deviceToken: device.token, title: notice.title, body: notice.body,
            environment: device.apnsEnvironment ?? undefined,
            deepLink: config.operations.ownerPath,
          });
          if (result.outcome === "delivered" || result.outcome === "invalid_token") {
            progress.deviceIds.push(device.id);
            if (result.outcome === "invalid_token") await db.update(notificationDevicesTable)
              .set({ enabled: false }).where(eq(notificationDevicesTable.id, device.id));
            await save();
          }
        }
        // No eligible device is explicitly skipped, not reported as a delivery.
        progress.push = devices.every(d => progress.deviceIds!.includes(d.id));
        await save();
      }
      await save(true);
    } catch {
      logger.warn({ noticeId: notice.id }, "Billing notice delivery pending; will retry");
      await save(true);
    }
  }
}
export function runBillingCycle(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (billingEnabled()) {
      for (const business of await billingStore.businesses()) {
        try { await billingService.refresh(business.id); }
        catch { logger.warn({ businessId: business.id }, "Test billing refresh failed; calls unaffected"); }
      }
    }
    await deliverPendingNotices();
    await runBillingEnforcementCycle();
  })().catch(() => {
    logger.warn("Billing worker unavailable; enforcement remains fail-open");
  }).finally(() => { running = undefined; });
  return running;
}
export function startBillingWorker() {
  if (timer) return;
  void runBillingCycle();
  timer = setInterval(() => void runBillingCycle(), config.operations.workerIntervalMs);
  timer.unref();
}
export async function stopBillingWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await running;
}

import { getAuth } from "@clerk/express";
import { GetLeadAlertInboxResponse, ReadLeadAlertsBody } from "@workspace/api-zod";
import { db, notificationEventsTable } from "@workspace/db";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";

const router = Router();
router.get("/notifications/inbox", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business?.leadAlertsEnabled) { res.json({ enabled: false, unreadCount: 0, alerts: [] }); return; }
    const where = and(eq(notificationEventsTable.businessId, String(business.id)), isNull(notificationEventsTable.readAt));
    const [alerts, [count]] = await Promise.all([
      db.select().from(notificationEventsTable).where(where).orderBy(desc(notificationEventsTable.id)).limit(50),
      db.select({ total: sql<number>`count(*)::int` }).from(notificationEventsTable).where(where),
    ]);
    res.json(GetLeadAlertInboxResponse.parse({ enabled: true, unreadCount: count.total, alerts: alerts.map(e => ({
      id: e.id, title: e.title, body: e.body, deepLink: e.deepLink, createdAt: e.createdAt.toISOString(),
    })) }));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "unknown" }, "Lead alert inbox failed");
    res.status(502).json({ error: "Unable to load lead alerts" });
  }
});
router.post("/notifications/inbox", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const parsed = ReadLeadAlertsBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid observed alert ID is required" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "Business not found" }); return; }
    await db.update(notificationEventsTable).set({ readAt: new Date() }).where(and(
      eq(notificationEventsTable.businessId, String(business.id)), lte(notificationEventsTable.id, parsed.data.throughId),
      isNull(notificationEventsTable.readAt),
    ));
    res.sendStatus(204);
  } catch {
    res.status(502).json({ error: "Unable to mark alerts read" });
  }
});
export default router;
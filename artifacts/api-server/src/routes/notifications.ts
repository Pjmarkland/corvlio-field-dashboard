import { getAuth } from "@clerk/express";
import {
  GetNotificationStatusResponse,
  ListNotificationOutboxResponse,
  RegisterNotificationDeviceBody,
  RegisterNotificationDeviceResponse,
  RevokeNotificationDeviceParams,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import {
  getNotificationStatus,
  listNotificationOutbox,
  registerNotificationDevice,
  revokeNotificationDevice,
} from "../lib/notificationService";

const router: IRouter = Router();

function developmentOnly(res: Parameters<Parameters<IRouter["get"]>[1]>[1]): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  res.status(404).json({ error: "Not found" });
  return false;
}

router.get("/notifications/status", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const business = await findBusinessByClerkUserId(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  const status = await getNotificationStatus(userId, String(business.id));
  res.json(GetNotificationStatusResponse.parse(status));
});

router.post("/notification-devices", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const body = RegisterNotificationDeviceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A valid native notification registration is required" });
    return;
  }
  const business = await findBusinessByClerkUserId(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  const device = await registerNotificationDevice({
    clerkUserId: userId,
    businessId: String(business.id),
    ...body.data,
  });
  res.json(RegisterNotificationDeviceResponse.parse(device));
});

router.delete("/notification-devices/:deviceId", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const params = RevokeNotificationDeviceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid device ID is required" });
    return;
  }
  const business = await findBusinessByClerkUserId(userId);
  if (!business) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  const revoked = await revokeNotificationDevice({
    deviceId: params.data.deviceId,
    clerkUserId: userId,
    businessId: String(business.id),
  });
  if (!revoked) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/notifications/poll/run", async (req, res): Promise<void> => {
  if (!developmentOnly(res)) return;
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.status(410).json({ error: "Leads now arrive through the signed Retell webhook. Legacy Sheets alert polling is disabled to avoid duplicate alerts." });
});

router.get("/notifications/outbox", async (req, res): Promise<void> => {
  if (!developmentOnly(res)) return;
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const business = await findBusinessByClerkUserId(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  const events = await listNotificationOutbox(String(business.id));
  res.json(ListNotificationOutboxResponse.parse(events));
});

export default router;
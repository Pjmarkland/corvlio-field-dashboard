import { getAuth } from "@clerk/express";
import {
  GetNotificationStatusResponse,
  ListNotificationOutboxResponse,
  RegisterNotificationDeviceBody,
  RegisterNotificationDeviceResponse,
  RevokeNotificationDeviceParams,
  RunNotificationPollResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { findBusinessForClerkUser } from "../lib/businessRegistry";
import { GoogleSheetStatusError } from "../lib/googleSheets";
import {
  getNotificationStatus,
  listNotificationOutbox,
  pollBusinessForNewLeads,
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
  const business = findBusinessForClerkUser(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  const status = await getNotificationStatus(userId, business.id);
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
  const business = findBusinessForClerkUser(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  const device = await registerNotificationDevice({
    clerkUserId: userId,
    businessId: business.id,
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
  const business = findBusinessForClerkUser(userId);
  if (!business) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  const revoked = await revokeNotificationDevice({
    deviceId: params.data.deviceId,
    clerkUserId: userId,
    businessId: business.id,
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
  const business = findBusinessForClerkUser(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  try {
    const result = await pollBusinessForNewLeads(business);
    res.json(RunNotificationPollResponse.parse(result));
  } catch (error) {
    const status = error instanceof GoogleSheetStatusError ? error.status : 502;
    req.log.error(
      {
        businessId: business.id,
        status,
        error: error instanceof Error ? error.message : "Unknown polling error",
      },
      "Manual notification poll failed",
    );
    res.status(status).json({ error: "Unable to poll the connected Google Sheet" });
  }
});

router.get("/notifications/outbox", async (req, res): Promise<void> => {
  if (!developmentOnly(res)) return;
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const business = findBusinessForClerkUser(userId);
  if (!business) {
    res.status(403).json({ error: "No business is configured for this account" });
    return;
  }
  const events = await listNotificationOutbox(business.id);
  res.json(ListNotificationOutboxResponse.parse(events));
});

export default router;
import { getAuth } from "@clerk/express";
import {
  GetWebPushConfigResponse,
  RegisterWebPushSubscriptionBody,
  RegisterWebPushSubscriptionResponse,
  RevokeWebPushSubscriptionBody,
} from "@workspace/api-zod";
import { Router } from "express";
import { databaseErrorFields } from "@workspace/db/errors";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import {
  getWebPushPublicConfig,
  registerWebPushSubscription,
  revokeWebPushSubscription,
  WebPushConfigurationError,
} from "../lib/webPushService";
import { createUserRateLimit } from "../middlewares/requestRateLimit";

const router = Router();
const webPushSubscriptionRateLimit = createUserRateLimit({
  bucket: "web-push-subscriptions",
  windowMs: 60_000,
  maxRequests: 30,
});

function isHttpsEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const allowedPushDomains = [
      "fcm.googleapis.com",
      "push.services.mozilla.com",
      "push.apple.com",
      "notify.windows.com",
    ];
    const hostIsPushService = allowedPushDomains.some((domain) =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
    return url.protocol === "https:"
      && (!url.port || url.port === "443")
      && hostIsPushService
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

router.get("/web-push/config", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(403).json({ error: "No business is configured for this account" }); return; }
    res.json(GetWebPushConfigResponse.parse(getWebPushPublicConfig()));
  } catch (error) {
    if (error instanceof WebPushConfigurationError) {
      res.status(503).json({ error: "Browser push is misconfigured" });
      return;
    }
    req.log.error(databaseErrorFields(error), "Web Push configuration lookup failed");
    res.status(502).json({ error: "Unable to load browser push configuration" });
  }
});

router.post("/web-push-subscriptions", webPushSubscriptionRateLimit, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const parsed = RegisterWebPushSubscriptionBody.strict().safeParse(req.body);
  if (!parsed.success || !isHttpsEndpoint(parsed.data?.endpoint ?? "")) {
    res.status(400).json({ error: "A valid HTTPS browser subscription is required" });
    return;
  }
  if (parsed.data.expirationTime != null
    && (!Number.isFinite(parsed.data.expirationTime) || parsed.data.expirationTime <= Date.now())) {
    res.status(400).json({ error: "The browser subscription has expired" });
    return;
  }

  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(403).json({ error: "No business is configured for this account" }); return; }
    const registered = await registerWebPushSubscription({
      clerkUserId: userId,
      businessId: business.id,
      subscription: parsed.data,
    });
    if (!registered) {
      res.status(409).json({ error: "This browser subscription belongs to another account" });
      return;
    }
    res.json(RegisterWebPushSubscriptionResponse.parse({ registered: true }));
  } catch (error) {
    if (error instanceof WebPushConfigurationError) {
      res.status(503).json({ error: "Browser push is not configured" });
      return;
    }
    req.log.error(databaseErrorFields(error), "Web Push subscription registration failed");
    res.status(502).json({ error: "Unable to register browser notifications" });
  }
});

router.delete("/web-push-subscriptions", webPushSubscriptionRateLimit, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const parsed = RevokeWebPushSubscriptionBody.strict().safeParse(req.body);
  if (!parsed.success || !isHttpsEndpoint(parsed.data?.endpoint ?? "")) {
    res.status(400).json({ error: "A valid HTTPS browser subscription is required" });
    return;
  }

  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(403).json({ error: "No business is configured for this account" }); return; }
    await revokeWebPushSubscription({ clerkUserId: userId, businessId: business.id, endpoint: parsed.data.endpoint });
    res.sendStatus(204);
  } catch (error) {
    req.log.error(databaseErrorFields(error), "Web Push subscription revocation failed");
    res.status(502).json({ error: "Unable to disable browser notifications" });
  }
});

export default router;

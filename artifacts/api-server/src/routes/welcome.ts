import { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { ClaimWelcomeResponse } from "@workspace/api-zod";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import { provisioningStore } from "../lib/provisioningStore";
import { claimNewUserWelcome } from "../lib/welcomePolicy";

const router = Router();
router.post("/user/welcome", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const entry = await provisioningStore.lock(userId, async () => {
      if (await findBusinessByClerkUserId(userId)) return { showWelcome: false, nextPath: "/dashboard" };
      const user = await clerkClient.users.getUser(userId);
      return claimNewUserWelcome(user, async () => {
        await clerkClient.users.updateUserMetadata(userId, {
          privateMetadata: { corvlioWelcomeSeenAt: new Date().toISOString() },
        });
      });
    });
    res.json(ClaimWelcomeResponse.parse(entry));
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: "Verify your email before continuing" }); return;
    }
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Welcome entry could not be checked");
    res.status(502).json({ error: "Welcome could not be checked. Please try again." });
  }
});
export default router;
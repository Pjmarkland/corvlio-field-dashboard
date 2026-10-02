import { getAuth } from "@clerk/express";
import { CreateOwnerDemoCallBody } from "@workspace/api-zod";
import { Router } from "express";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import { DemoCallError, placeOwnerDemoCall } from "../lib/ownerDemoCall";

const router = Router();
router.post("/businesses/me/demo-call", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (process.env.NODE_ENV === "production") { res.status(404).json({ error: "Not found" }); return; }
  const parsed = CreateOwnerDemoCallBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Confirm your saved owner phone number first." }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "No business is configured for this account" }); return; }
    res.json(await placeOwnerDemoCall(business, parsed.data.confirmedNumber, parsed.data.confirmed, parsed.data.scenario));
  } catch (error) {
    if (!(error instanceof DemoCallError)) req.log.error({ errorName: error instanceof Error ? error.name : "unknown" }, "Owner demo call failed");
    res.status(error instanceof DemoCallError ? error.status : 502).json({
      error: error instanceof DemoCallError ? error.message : "Unable to request a test call. No number was purchased.",
    });
  }
});
export default router;
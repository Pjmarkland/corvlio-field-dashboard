import { getAuth } from "@clerk/express";
import { Router } from "express";
import { DeleteMyAccountBody } from "@workspace/api-zod";
import { AccountDeletionError, deleteAccount, accountDeletionEligibility } from "../lib/accountDeletion";
import { destructiveOriginAllowed } from "../middlewares/destructiveOrigin";
const router = Router();
router.get("/account/deletion-eligibility",async(req,res)=>{
  res.set("Cache-Control","private, no-store");
  const {userId}=getAuth(req);
  if(!userId){res.sendStatus(401);return;}
  try {res.json(await accountDeletionEligibility(userId));}
  catch {res.status(503).json({error:"Account protection could not be checked. Deletion is unavailable until it can be verified."});}
});
router.delete("/account/me", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!destructiveOriginAllowed(req)) { res.status(403).json({ error: "Account deletion must be requested from this app." }); return; }
  const body = DeleteMyAccountBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Type DELETE to confirm account deletion." }); return; }
  try {
    const status = await deleteAccount(userId);
    res.status(status === "completed" ? 200 : 202).json({ status,
      message: status === "completed" ? "Your account and app data have been deleted."
        : "Your app data has been deleted. Clerk account deletion is queued for automatic retry. You will be signed out." });
  } catch (error) {
    if (error instanceof AccountDeletionError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error("Account deletion could not safely finish; no provider details logged.");
    res.status(503).json({ error: "Account deletion could not safely finish. Please retry or contact hello@corvlio.com." });
  }
});
export default router;

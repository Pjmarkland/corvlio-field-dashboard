import { verifyWebhook } from "@clerk/express/webhooks";
import type { RequestHandler } from "express";
import { AccountDeletionError, deleteAccount } from "../lib/accountDeletion";
import { logger } from "../lib/logger";
export const clerkDeletionWebhook: RequestHandler = async (req, res) => {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) { res.status(503).json({ error: "Clerk deletion webhook is not configured." }); return; }
  let event;
  try { event = await verifyWebhook(req, { signingSecret }); }
  catch { res.status(401).json({ error: "Invalid webhook signature." }); return; }
  if (event.type !== "user.deleted") { res.sendStatus(204); return; }
  const id = event.data.id;
  if (!id || !id.startsWith("user_")) { res.sendStatus(400); return; }
  try {
    await deleteAccount(id, undefined, true);
    res.sendStatus(204);
  } catch (error) {
    logger.error("Signed Clerk deletion cleanup needs retry.");
    res.status(error instanceof AccountDeletionError ? error.status : 503).json({ error: "Account cleanup requires retry." });
  }
};

import { getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import type { RequestHandler } from "express";
// Prevent an identity awaiting Clerk deletion from recreating onboarding/data.
export const accountDeletionGuard: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId || (req.method === "DELETE" && req.path === "/account/me")) { next(); return; }
  try {
    const result = await pool.query("SELECT status FROM account_deletions WHERE clerk_user_id = $1", [userId]);
    if (result.rows[0]) { res.status(403).json({ error: "This account has been deleted or is being deleted. Please sign out." }); return; }
    next();
  } catch {
    res.status(503).json({ error: "Account status could not be verified. Please retry." });
  }
};

import { getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import type { RequestHandler } from "express";
import { databaseErrorFields, isMissingAccountDeletionTable } from "@workspace/db/errors";
// Prevent an identity awaiting Clerk deletion from recreating onboarding/data.
export const accountDeletionGuard: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId || (req.method === "DELETE" && req.path === "/account/me")) { next(); return; }
  try {
    const result = await pool.query("SELECT status FROM account_deletions WHERE clerk_user_id = $1", [userId]);
    if (result.rows[0]) { res.status(403).json({ error: "This account has been deleted or is being deleted. Please sign out." }); return; }
    next();
  } catch (error) {
    req.log.error(databaseErrorFields(error), "Account deletion status lookup failed");
    // Only a confirmed missing ledger permits this degraded mode. Connectivity,
    // permission and missing-column failures remain fail-closed.
    if (isMissingAccountDeletionTable(error) && ["GET", "HEAD"].includes(req.method)) {
      try {
        // Deletion removes owned businesses in the same transaction as writing
        // its tombstone. Do not permit deleted/unconfigured identities, and do
        // not allow writes/onboarding to recreate any removed data.
        const owned = await pool.query("SELECT id FROM businesses WHERE clerk_user_id = $1 LIMIT 1", [userId]);
        if (!owned.rows.length) {
          res.status(403).json({ error: "No active business is configured for this account." });
          return;
        }
        req.log.warn({ mode: "existing_owner_read_only" }, "Account deletion ledger missing; schema repair required");
        next();
        return;
      } catch (fallbackError) {
        req.log.error(databaseErrorFields(fallbackError), "Read-only business ownership fallback failed");
      }
    }
    res.status(503).json({ error: "Account status could not be verified. Please retry." });
  }
};

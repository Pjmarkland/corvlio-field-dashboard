import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { pool } from "@workspace/db";

function isAllowedWhileBillingLocked(path: string): boolean {
  return path.startsWith("/admin/")
    || path === "/admin"
    || path.startsWith("/billing")
    || path === "/invoicing/me"
    || path.startsWith("/account/")
    || path === "/businesses/me/enforcement-status"
    || path === "/businesses/me/support-requests"
    || path === "/businesses/me/export";
}

/**
 * Keep the owner dashboard/API locked while preserving payment, support, data
 * export, account-deletion and admin escape hatches. A database error or
 * ambiguous owner mapping deliberately fails open.
 */
export const billingEnforcementAccess: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId || isAllowedWhileBillingLocked(req.path)) {
    next();
    return;
  }

  try {
    const result = await pool.query<{ suspended_at: Date | null }>(`
      SELECT billing_enforcement_suspended_at AS suspended_at
      FROM businesses WHERE clerk_user_id=$1 LIMIT 2
    `, [userId]);
    if (result.rows.length !== 1 || !result.rows[0]?.suspended_at) {
      next();
      return;
    }
    res.set("Cache-Control", "private, no-store");
    res.status(423).json({
      error: "This account is temporarily paused for billing review.",
      code: "billing_enforcement_suspended",
    });
  } catch {
    next();
  }
};

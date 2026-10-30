import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { CompletePendingRetellReleaseBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { destructiveOriginAllowed } from "../middlewares/destructiveOrigin";
const router = Router();
router.get("/admin/pending-releases", requireAdmin, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const { rows } = await pool.query("SELECT * FROM pending_retell_releases WHERE status = 'pending' ORDER BY created_at DESC");
    res.json(rows.map(r => ({ id: r.id, businessId: r.business_id, businessName: r.business_name,
      phoneNumber: r.phone_number, agentId: r.agent_id, provisioningStatus: r.provisioning_status, createdAt: r.created_at.toISOString() })));
  } catch { res.status(503).json({ error: "Pending releases could not be loaded." }); }
});
router.post("/admin/pending-releases/:releaseId/complete", requireAdmin, async (req, res) => {
  if (!destructiveOriginAllowed(req)) { res.sendStatus(403); return; }
  const id = z.coerce.number().int().positive().safeParse(req.params.releaseId);
  if (!id.success || !CompletePendingRetellReleaseBody.strict().safeParse(req.body).success) { res.sendStatus(400); return; }
  try {
    const result = await pool.query(`UPDATE pending_retell_releases SET status = 'resolved',
      resolved_at = COALESCE(resolved_at, now()), business_id = NULL,
      business_name = 'Manually released resource', phone_number = NULL, agent_id = NULL,
      provisioning_status = NULL WHERE id = $1 RETURNING id`, [id.data]);
    res.sendStatus(result.rows.length ? 204 : 404);
  } catch { res.status(503).json({ error: "Manual release record could not be updated." }); }
});
export default router;

import {
  GetAdminBusinessParams,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import {
  getAdminActivity,
  getAdminBusiness,
  getAdminOverview,
} from "../lib/adminData";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getAdminCallQuality } from "../lib/callQuality";
import { z } from "zod";
import { pool } from "@workspace/db";
import { createInternalBusiness, internalBusinessDirectory, internalBusinessRecord, InternalBusinessError } from "../lib/internalBusinesses";

const router: IRouter = Router();

router.use("/admin", requireAdmin);
const internalInput = z.object({
  businessName: z.string().trim().min(1).max(160),
  retellPhoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  ownerUserId: z.string().trim().min(1).max(200),
  retellAgentId: z.string().trim().max(200).nullable().optional(),
}).strict();
router.get("/admin/internal-businesses", async (req,res) => {
  res.set("Cache-Control","private, no-store");
  try { res.json(await internalBusinessDirectory()); }
  catch { req.log.error("Internal business directory unavailable"); res.status(503).json({error:"Internal businesses could not load."}); }
});
router.post("/admin/internal-businesses", async (req,res) => {
  const body=internalInput.safeParse(req.body);
  if (!body.success) {res.status(400).json({error:"Enter a name, E.164 phone number, and verified admin owner. Billing fields are not allowed."});return;}
  try { res.json(await createInternalBusiness(body.data)); }
  catch (e) {res.status(e instanceof InternalBusinessError ? e.status : 503).json({error:e instanceof InternalBusinessError ? e.message : "Internal business could not be created."});}
});
router.patch("/admin/internal-businesses/:businessId",async(req,res) => {
  const id=z.coerce.number().int().positive().safeParse(req.params.businessId);
  const body=z.object({retellAgentId:z.string().trim().max(200).nullable()}).strict().safeParse(req.body);
  if (!id.success || !body.success) {res.status(400).json({error:"Only the local Retell agent ID can be edited here."});return;}
  try {
    const r=await pool.query("UPDATE businesses SET retell_agent_id=$2,updated_at=now() WHERE id=$1 AND is_internal=true RETURNING *",
      [id.data,body.data.retellAgentId || null]);
    if (!r.rows[0]) {res.sendStatus(404);return;}
    res.json(internalBusinessRecord(r.rows[0]));
  } catch {res.status(503).json({error:"Agent ID could not be saved."});}
});

router.get("/admin/call-quality", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try { res.json(await getAdminCallQuality()); }
  catch (error) {
    req.log.error({ error: error instanceof Error ? error.message : "Unknown quality error" }, "Call quality request failed");
    res.status(502).json({ error: "Unable to load call quality" });
  }
});

router.get("/admin/overview", async (req, res): Promise<void> => {
  try {
    res.json(await getAdminOverview());
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown admin overview error" },
      "Admin overview request failed",
    );
    res.status(502).json({ error: "Unable to load admin overview" });
  }
});

router.get("/admin/businesses/:businessId", async (req, res): Promise<void> => {
  const params = GetAdminBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid business ID" });
    return;
  }

  try {
    const result = await getAdminBusiness(params.data.businessId);
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json(result);
  } catch (error) {
    req.log.error(
      {
        businessId: params.data.businessId,
        error: error instanceof Error ? error.message : "Unknown admin business error",
      },
      "Admin business detail request failed",
    );
    res.status(502).json({ error: "Unable to load business details" });
  }
});

router.get("/admin/activity", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(await getAdminActivity());
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown admin activity error" },
      "Admin activity request failed",
    );
    res.status(502).json({ error: "Unable to load admin activity" });
  }
});

export default router;
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

const router: IRouter = Router();

router.use("/admin", requireAdmin);

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
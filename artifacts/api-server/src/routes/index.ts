import { Router, type IRouter } from "express";
import businessesRouter from "./businesses";
import adminRouter from "./admin";
import adminEmailHealthRouter from "./adminEmailHealth";
import healthRouter from "./health";
import leadsRouter from "./leads";
import notificationsRouter from "./notifications";
import retellRouter from "./retell";
import leadDetailsRouter from "./leadDetails";
import welcomeRouter from "./welcome";
import ownerDemoRouter from "./ownerDemo";
import leadAlertsRouter from "./leadAlerts";
import webPushRouter from "./webPush";
import billingRouter from "./billing";
import accountRouter from "./account";
import ownerSmsRouter from "./ownerSms";
import pendingReleasesRouter from "./pendingReleases";
import invoicingRouter from "./invoicing";
import { accountDeletionGuard } from "../middlewares/accountDeletionGuard";
import { requireAdmin } from "../middlewares/requireAdmin";
import { billingEnforcementAccess } from "../middlewares/billingEnforcementAccess";

const router: IRouter = Router();
router.use(healthRouter);
// This guard runs before all route groups so no /api/admin path can bypass it.
router.use("/admin", requireAdmin);
router.use(accountDeletionGuard);
router.use(billingEnforcementAccess);
router.use(accountRouter);
router.use(ownerSmsRouter);
router.use(pendingReleasesRouter);
router.use(invoicingRouter);

router.use(billingRouter);
router.use(adminEmailHealthRouter);
router.use(adminRouter);
router.use(businessesRouter);
router.use(leadsRouter);
router.use(leadDetailsRouter);
router.use(notificationsRouter);
router.use(retellRouter);
router.use(welcomeRouter);
router.use(ownerDemoRouter);
router.use(leadAlertsRouter);
router.use(webPushRouter);
router.use("/admin", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;

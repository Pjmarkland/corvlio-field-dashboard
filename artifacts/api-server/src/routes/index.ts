import { Router, type IRouter } from "express";
import businessesRouter from "./businesses";
import adminRouter from "./admin";
import healthRouter from "./health";
import leadsRouter from "./leads";
import notificationsRouter from "./notifications";
import retellRouter from "./retell";
import welcomeRouter from "./welcome";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(businessesRouter);
router.use(leadsRouter);
router.use(notificationsRouter);
router.use(retellRouter);
router.use(welcomeRouter);

export default router;

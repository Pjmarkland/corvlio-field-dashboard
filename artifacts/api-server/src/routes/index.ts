import { Router, type IRouter } from "express";
import businessesRouter from "./businesses";
import healthRouter from "./health";
import leadsRouter from "./leads";
import notificationsRouter from "./notifications";
import retellRouter from "./retell";

const router: IRouter = Router();

router.use(healthRouter);
router.use(businessesRouter);
router.use(leadsRouter);
router.use(notificationsRouter);
router.use(retellRouter);

export default router;

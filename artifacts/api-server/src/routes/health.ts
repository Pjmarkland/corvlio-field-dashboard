import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { getDeletedAccountGuardStatus } from "../lib/deletedAccountGuardCheck";

const router: IRouter = Router();

function healthPayload(status: "ok" | "unavailable") {
  return HealthCheckResponse.parse({
    status,
    details: {
      deletedAccountGuards: getDeletedAccountGuardStatus(),
    },
  });
}

router.get("/healthz", async (_req, res): Promise<void> => {
  try {
    await pool.query("SELECT 1");
    res.json(healthPayload("ok"));
  } catch {
    res.status(503).json(healthPayload("unavailable"));
  }
});

router.get("/health/launch", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "available" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

export default router;

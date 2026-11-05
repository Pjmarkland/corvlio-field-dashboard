import { Router, type IRouter, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { findBusinessByClerkUserId } from "../lib/businessDirectory";
import { isVerifiedAdminUser, requireAdmin } from "../middlewares/requireAdmin";
import { billingEnabled, configuredBillingMode } from "../billing/stripeClient";
import { adminLivePaymentTestService, billingService } from "../billing/runtime";
import { billingStore } from "../billing/store";
import { BillingError, billingGate } from "../billing/policy";
import { readNativeBillingSummary } from "../billing/nativeSummary";
import { checkBillingReadiness } from "../billing/readiness";
import { getOwnerSmsReadiness } from "../lib/ownerSms";
import { getWebPushReadiness } from "../lib/webPushService";
import { isAdminOnlyPlan } from "../billing/policy";

const router: IRouter = Router();
// Read-only exception BEFORE the unchanged payment gate. This cannot enable billing.
router.get("/billing/native-summary", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const userId = getAuth(req).userId;
  if (!userId) { res.sendStatus(401); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business || business.isInternal) { res.sendStatus(404); return; }
    res.json(await readNativeBillingSummary(business.id));
  } catch {
    res.status(503).json({ error: "Billing details are temporarily unavailable." });
  }
});
router.get("/billing/availability", (_req, res) => {
  const gate = billingGate();
  res.set("Cache-Control", "no-store").json({
    enabled: gate.enabled,
    mode: gate.mode,
    smsAvailable: getOwnerSmsReadiness().ready,
  });
});
router.post("/admin/billing/readiness-check", requireAdmin, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    const readiness = await checkBillingReadiness();
    res.json({
      ...readiness,
      sms: getOwnerSmsReadiness(),
      webPush: getWebPushReadiness(),
    });
  } catch {
    req.log?.error("Admin billing readiness check failed");
    res.status(503).json({ error: "Billing readiness could not be checked." });
  }
});
const enabled = (_req: Request, res: Response, next: NextFunction) => {
  if (!billingEnabled()) { res.sendStatus(404); return; }
  next();
};
const livePaymentTestEnabled = (_req: Request, res: Response, next: NextFunction) => {
  if (!billingEnabled() || configuredBillingMode() !== "live") { res.sendStatus(404); return; }
  next();
};
router.use("/billing", enabled);
router.use("/admin/billing", enabled, requireAdmin);
const emptyInput = z.object({}).strict();
const planInput = z.object({ plan: z.string().min(1).max(100) }).strict();

type Action = (businessId: number, actor: string, req: Request) => Promise<unknown>;
function ownerAction(action: Action, input: "plan" | "empty" | "none" = "empty") {
  return async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "private, no-store");
    const userId = getAuth(req).userId;
    if (!userId) { res.sendStatus(401); return; }
    try {
      if (input !== "none" && !(input === "plan" ? planInput : emptyInput).safeParse(req.body ?? {}).success) {
        res.status(400).json({ error: "Invalid billing input" }); return;
      }
      const business = await findBusinessByClerkUserId(userId);
      if (!business || business.isInternal) { res.sendStatus(404); return; }
      res.json(await action(business.id, userId, req));
    } catch (error) {
      res.status(error instanceof BillingError ? error.status : 503)
        .json({ error: error instanceof BillingError ? error.message : "Billing is temporarily unavailable. Calls continue." });
    }
  };
}
router.get("/billing", ownerAction(async (id, userId) =>
  billingService.snapshot(id, await isVerifiedAdminUser(userId)), "none"));
const requireAdminForRestrictedPlan: RequestHandler = async (req, res, next): Promise<void> => {
  const input = planInput.safeParse(req.body ?? {});
  if (input.success && isAdminOnlyPlan(input.data.plan)) {
    await requireAdmin(req, res, next);
    return;
  }
  next();
};
router.post("/billing/checkout", requireAdminForRestrictedPlan,
  ownerAction((id, _actor, req) => billingService.checkout(id, planInput.parse(req.body).plan), "plan"));
router.post("/billing/portal", ownerAction(id => billingService.portal(id)));
router.post("/billing/upgrade", ownerAction((id, actor, req) => billingService.upgrade(id, planInput.parse(req.body).plan, actor), "plan"));
router.post("/billing/cancel", ownerAction((id, actor) => billingService.cancel(id, actor)));
router.post("/billing/resume", ownerAction((id, actor) => billingService.resume(id, actor)));
router.get("/admin/billing", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    const businesses = await billingStore.businesses();
    res.json(await Promise.all(businesses.map(b => billingService.snapshot(b.id, true))));
  } catch { res.status(503).json({ error: "Billing is temporarily unavailable" }); }
});
router.post("/admin/billing/live-payment-test", livePaymentTestEnabled, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const adminUserId = getAuth(req).userId;
  if (!adminUserId) { res.sendStatus(401); return; }
  if (!emptyInput.safeParse(req.body ?? {}).success) {
    res.status(400).json({ error: "Invalid live payment test request" });
    return;
  }
  try {
    res.status(201).json(await adminLivePaymentTestService.createCheckout(adminUserId));
  } catch (error) {
    res.status(error instanceof BillingError ? error.status : 503)
      .json({ error: error instanceof BillingError ? error.message : "The live payment test could not be started." });
  }
});
router.get("/admin/billing/live-payment-test/:testId", livePaymentTestEnabled, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const adminUserId = getAuth(req).userId;
  if (!adminUserId) { res.sendStatus(401); return; }
  const params = z.object({ testId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) { res.sendStatus(400); return; }
  try {
    res.json(await adminLivePaymentTestService.getStatus(params.data.testId, adminUserId));
  } catch (error) {
    res.status(error instanceof BillingError ? error.status : 503)
      .json({ error: error instanceof BillingError ? error.message : "The live payment test status could not be loaded." });
  }
});
router.patch("/admin/billing/:businessId/startup", async (req, res): Promise<void> => {
  const id = z.coerce.number().int().positive().safeParse(req.params.businessId);
  const input = z.object({ eligible: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !input.success) { res.sendStatus(400); return; }
  try { res.json(await billingService.startupEligibility(id.data, input.data.eligible, getAuth(req).userId!)); }
  catch (error) { res.status(error instanceof BillingError ? error.status : 503).json({ error: "Unable to set Startup eligibility" }); }
});
export default router;

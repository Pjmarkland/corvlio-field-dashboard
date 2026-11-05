import {
  ConfirmManualInvoiceOverdueParams,
  ConfirmManualInvoiceOverdueResponse,
  GetBillingEnforcementResponse,
  ReinstateBillingAccountParams,
  ReinstateBillingAccountResponse,
  SetBillingEnforcementModeBody,
  SetBillingEnforcementModeResponse,
  SetBillingEnforcementOverrideBody,
  SetBillingEnforcementOverrideParams,
  SetBillingEnforcementOverrideResponse,
} from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  confirmManualInvoiceOverdue,
  getBillingEnforcementSettings,
  reinstateBillingSuspension,
  setBillingEnforcementMode,
  setNeverAutoSuspend,
} from "../billing/enforcement";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();
router.use("/admin/billing-enforcement", requireAdmin);
const emptyBody = z.object({}).strict();

router.get("/admin/billing-enforcement", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(GetBillingEnforcementResponse.parse(await getBillingEnforcementSettings()));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Billing enforcement settings failed");
    res.status(503).json({ error: "Billing enforcement settings are temporarily unavailable." });
  }
});

router.patch("/admin/billing-enforcement/mode", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const input = SetBillingEnforcementModeBody.strict().safeParse(req.body);
  const actor = getAuth(req).userId;
  if (!input.success) { res.status(400).json({ error: "Choose Off, Dry-run, or On." }); return; }
  if (!actor) { res.sendStatus(401); return; }
  try {
    res.json(SetBillingEnforcementModeResponse.parse(await setBillingEnforcementMode(input.data.mode, actor)));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Billing enforcement mode update failed");
    res.status(503).json({ error: "Billing enforcement mode could not be updated." });
  }
});

router.patch("/admin/billing-enforcement/businesses/:businessId/override", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const id = SetBillingEnforcementOverrideParams.safeParse(req.params);
  const input = SetBillingEnforcementOverrideBody.strict().safeParse(req.body);
  const actor = getAuth(req).userId;
  if (!id.success || !input.success) { res.status(400).json({ error: "Invalid account override." }); return; }
  if (!actor) { res.sendStatus(401); return; }
  try {
    const result = await setNeverAutoSuspend(id.data.businessId, input.data.neverAutoSuspend, actor);
    if (!result) { res.sendStatus(404); return; }
    res.json(SetBillingEnforcementOverrideResponse.parse({ businessId: id.data.businessId, ...result }));
  } catch (error) {
    req.log.error({ businessId: id.data.businessId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Billing enforcement override failed");
    res.status(503).json({ error: "Account override could not be updated." });
  }
});

router.post("/admin/billing-enforcement/businesses/:businessId/reinstate", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const id = ReinstateBillingAccountParams.safeParse(req.params);
  if (!id.success || !emptyBody.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "Invalid reinstatement request." }); return; }
  const actor = getAuth(req).userId;
  if (!actor) { res.sendStatus(401); return; }
  try {
    const status = await getBillingEnforcementSettings();
    const business = status.businesses.find(item => item.businessId === id.data.businessId);
    if (!business?.suspension) {
      res.status(409).json({ error: "This account has no billing-enforcement suspension to reinstate." });
      return;
    }
    const reinstated = await reinstateBillingSuspension({
      businessId: id.data.businessId,
      source: business.suspension.source,
      invoiceId: business.suspension.invoiceId,
      actor,
      reason: `Admin ${actor} manually reinstated the account.`,
    });
    if (!reinstated) { res.status(409).json({ error: "The account status changed before reinstatement." }); return; }
    res.json(ReinstateBillingAccountResponse.parse({ businessId: id.data.businessId, reinstated: true }));
  } catch (error) {
    req.log.error({ businessId: id.data.businessId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Billing enforcement reinstatement failed");
    res.status(503).json({ error: "The account could not be reinstated." });
  }
});

router.post("/admin/billing-enforcement/manual-invoices/:invoiceId/confirm-overdue", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const id = ConfirmManualInvoiceOverdueParams.safeParse(req.params);
  if (!id.success || !emptyBody.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "Invalid invoice confirmation." }); return; }
  const actor = getAuth(req).userId;
  if (!actor) { res.sendStatus(401); return; }
  try {
    const result = await confirmManualInvoiceOverdue(id.data.invoiceId, actor);
    if (!result) { res.sendStatus(404); return; }
    res.json(ConfirmManualInvoiceOverdueResponse.parse({
      invoiceId: id.data.invoiceId,
      confirmed: result.confirmed,
      confirmedAt: result.confirmedAt ?? null,
      changed: result.changed ?? false,
      reason: result.reason ?? null,
    }));
  } catch (error) {
    req.log.error({ invoiceId: id.data.invoiceId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Manual overdue confirmation failed");
    res.status(503).json({ error: "The overdue status could not be confirmed." });
  }
});

export default router;

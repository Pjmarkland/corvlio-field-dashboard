import {
  CreateAdminInternalBusinessBody,
  GetAdminBusinessParams,
  LinkAdminAppReviewDemoBody,
  GetAdminFallbackPhoneSettingsResponse,
  UpdateAdminFallbackPhoneSettingsBody,
  UpdateAdminFallbackPhoneSettingsResponse,
  UpdateAdminBusinessFallbackPhoneParams,
  UpdateAdminBusinessFallbackPhoneBody,
  UpdateAdminBusinessFallbackPhoneResponse,
  GetAdminSystemAlertsResponse,
  ResolveAdminSystemAlertParams,
  ResolveAdminSystemAlertResponse,
  GetAdminHealthCheckResponse,
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
import { and, desc, eq, isNull } from "drizzle-orm";
import { businessesTable, db, leadInfoFlagsTable, leadsTable, pool } from "@workspace/db";
import { createInternalBusiness, internalBusinessDirectory, internalBusinessRecord, InternalBusinessError } from "../lib/internalBusinesses";
import { AppReviewDemoError, getAppReviewDemoStatus, linkAppReviewDemoEmail, resetAppReviewDemo } from "../lib/appReviewDemo";
import { parseBusinessHours, validTimeZone } from "../lib/businessHours";
import { getAdminRetellWebhookUrls } from "../lib/retellWebhookUrls";
import {
  DEFAULT_FALLBACK_PHONE_NUMBER,
  getDefaultFallbackPhoneNumber,
  saveDefaultFallbackPhoneNumber,
} from "../lib/fallbackPhoneSettings";
import { normalizeUsPhoneNumber } from "../lib/usPhoneNumber";
import {
  getAdminRetellHealthCheck,
  getAdminRetellSystemAlerts,
  resolveRetellSystemAlert,
} from "../lib/retellSystemAlerts";

const router: IRouter = Router();

router.use("/admin", requireAdmin);
router.get("/admin/fallback-phone-settings", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    const defaultFallbackPhoneNumber = await getDefaultFallbackPhoneNumber();
    res.json(GetAdminFallbackPhoneSettingsResponse.parse({ defaultFallbackPhoneNumber }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Default fallback phone setting could not be loaded",
    );
    res.status(502).json({ error: "Fallback phone settings could not be loaded." });
  }
});

router.patch("/admin/fallback-phone-settings", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const body = UpdateAdminFallbackPhoneSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter a valid US fallback phone number." });
    return;
  }
  const normalized = normalizeUsPhoneNumber(body.data.defaultFallbackPhoneNumber);
  if (!normalized) {
    res.status(400).json({ error: "Enter a valid US phone number, such as +1 (863) 446-3029." });
    return;
  }

  try {
    const defaultFallbackPhoneNumber = await saveDefaultFallbackPhoneNumber(normalized);
    res.json(UpdateAdminFallbackPhoneSettingsResponse.parse({ defaultFallbackPhoneNumber }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Default fallback phone setting could not be saved",
    );
    res.status(502).json({ error: "Fallback phone settings could not be saved." });
  }
});

router.patch("/admin/businesses/:businessId/fallback-phone", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = UpdateAdminBusinessFallbackPhoneParams.safeParse(req.params);
  const body = UpdateAdminBusinessFallbackPhoneBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid business and fallback phone number." });
    return;
  }

  const input = body.data.fallbackPhoneNumber?.trim() ?? "";
  const fallbackPhoneNumber = input ? normalizeUsPhoneNumber(input) : null;
  if (input && !fallbackPhoneNumber) {
    res.status(400).json({ error: "Enter a valid US phone number, such as +1 (863) 446-3029." });
    return;
  }

  try {
    const [business] = await db.update(businessesTable)
      .set({ fallbackPhoneNumber, updatedAt: new Date() })
      .where(eq(businessesTable.id, params.data.businessId))
      .returning({ fallbackPhoneNumber: businessesTable.fallbackPhoneNumber });
    if (!business) {
      res.status(404).json({ error: "Business not found." });
      return;
    }
    const defaultPhoneNumber = await getDefaultFallbackPhoneNumber().catch(() => DEFAULT_FALLBACK_PHONE_NUMBER);
    res.json(UpdateAdminBusinessFallbackPhoneResponse.parse({
      overridePhoneNumber: business.fallbackPhoneNumber,
      resolvedPhoneNumber: business.fallbackPhoneNumber ?? defaultPhoneNumber,
      defaultPhoneNumber,
    }));
  } catch (error) {
    req.log.error(
      {
        businessId: params.data.businessId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Business fallback phone setting could not be saved",
    );
    res.status(502).json({ error: "Business fallback phone setting could not be saved." });
  }
});

router.get("/admin/system-alerts", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(GetAdminSystemAlertsResponse.parse(await getAdminRetellSystemAlerts()));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Admin Retell system alerts could not be loaded",
    );
    res.status(502).json({ error: "System alerts could not be loaded." });
  }
});

router.patch("/admin/system-alerts/:alertId/resolve", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = ResolveAdminSystemAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Enter a valid alert ID." });
    return;
  }
  try {
    const resolved = await resolveRetellSystemAlert(
      params.data.alertId,
      typeof res.locals.adminEmail === "string" ? res.locals.adminEmail : "admin",
    );
    if (!resolved) {
      res.status(404).json({ error: "Open system alert not found." });
      return;
    }
    res.json(ResolveAdminSystemAlertResponse.parse({ resolved }));
  } catch (error) {
    req.log.error(
      { alertId: params.data.alertId, errorName: error instanceof Error ? error.name : "UnknownError" },
      "Admin Retell system alert could not be resolved",
    );
    res.status(502).json({ error: "System alert could not be resolved." });
  }
});

router.get("/admin/health-check", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(GetAdminHealthCheckResponse.parse(await getAdminRetellHealthCheck()));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Admin Retell health check could not be loaded",
    );
    res.status(502).json({ error: "Health check could not be loaded." });
  }
});

router.get("/admin/retell-webhook-urls", (_req, res): void => {
  res.set("Cache-Control", "private, no-store").json(getAdminRetellWebhookUrls());
});
router.get("/admin/internal-businesses", async (req,res) => {
  res.set("Cache-Control","private, no-store");
  try { res.json(await internalBusinessDirectory()); }
  catch { req.log.error("Internal business directory unavailable"); res.status(503).json({error:"Internal businesses could not load."}); }
});
router.post("/admin/internal-businesses", async (req,res) => {
  const body=CreateAdminInternalBusinessBody.safeParse(req.body);
  if (!body.success) {res.status(400).json({error:"Complete the internal business profile and select a verified admin owner. Billing and Retell routing fields are not allowed."});return;}
  const requiredProfile = [
    body.data.businessName, body.data.businessType, body.data.servicesOffered,
    body.data.servicesNotOffered, body.data.serviceArea, body.data.majorIssueExamples,
    body.data.businessHours, body.data.timeZone,
  ];
  if (requiredProfile.some((value) => !value.trim())) {
    res.status(400).json({error:"Complete all required receptionist profile fields."});
    return;
  }
  if (!parseBusinessHours(body.data.businessHours) || !validTimeZone(body.data.timeZone)) {
    res.status(400).json({error:"Enter valid business hours and a time zone."});
    return;
  }
  if (body.data.emergencyAvailable && (!body.data.emergencyEscalationPhone
    || !/^\+[1-9]\d{7,14}$/.test(body.data.emergencyEscalationPhone))) {
    res.status(400).json({error:"Add a valid country-code emergency escalation phone when emergency calls are enabled."});
    return;
  }
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

const appReviewDemoLinkInput = LinkAdminAppReviewDemoBody.extend({
  email: z.string().trim().email().max(320),
}).strict();

router.get("/admin/app-review-demo", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(await getAppReviewDemoStatus());
  } catch (error) {
    if (error instanceof AppReviewDemoError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ error: error instanceof Error ? error.message : "Unknown demo status error" }, "App Review demo status failed");
    res.status(503).json({ error: "App Review demo status is unavailable." });
  }
});

router.post("/admin/app-review-demo/reset", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(await resetAppReviewDemo());
  } catch (error) {
    if (error instanceof AppReviewDemoError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ error: error instanceof Error ? error.message : "Unknown demo reset error" }, "App Review demo reset failed");
    res.status(503).json({ error: "App Review demo could not be reset." });
  }
});

router.post("/admin/app-review-demo/link", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const rawInput = req.body as {
    email?: unknown;
    allowUnverifiedEmail?: unknown;
  } | null;
  const overrideRequested = rawInput?.allowUnverifiedEmail === true;
  const targetEmail = typeof rawInput?.email === "string"
    ? rawInput.email.trim().toLowerCase().slice(0, 320)
    : null;
  const logOverride = (result: string) => {
    if (!overrideRequested) return;
    req.log.info(
      {
        adminEmail: typeof res.locals.adminEmail === "string" ? res.locals.adminEmail : null,
        targetEmail,
        result,
      },
      "App Review Demo unverified email override used",
    );
  };
  const body = appReviewDemoLinkInput.safeParse(req.body);
  if (!body.success) {
    logOverride("invalid_input");
    res.status(400).json({
      error: overrideRequested
        ? "Enter a valid reviewer email address."
        : "Enter the reviewer's verified email address.",
    });
    return;
  }
  const allowUnverifiedEmail = body.data.allowUnverifiedEmail;
  let overrideResult = "error";
  try {
    res.json(await linkAppReviewDemoEmail(body.data.email, allowUnverifiedEmail));
    overrideResult = "linked";
  } catch (error) {
    overrideResult = error instanceof AppReviewDemoError
      ? `refused_${error.status}`
      : "error";
    if (error instanceof AppReviewDemoError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ error: error instanceof Error ? error.message : "Unknown demo link error" }, "App Review demo linking failed");
    res.status(503).json({ error: "The App Review account could not be linked." });
  } finally {
    if (allowUnverifiedEmail) logOverride(overrideResult);
  }
});

router.patch("/admin/businesses/:businessId/managed-reports", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const id = z.coerce.number().int().positive().safeParse(req.params.businessId);
  const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "Enter a valid business and enabled state." }); return; }
  try {
    const [updated] = await db.update(businessesTable)
      .set({ managedReportsEnabled: body.data.enabled, updatedAt: new Date() })
      .where(eq(businessesTable.id, id.data))
      .returning({ enabled: businessesTable.managedReportsEnabled });
    if (!updated) { res.status(404).json({ error: "Business not found" }); return; }
    res.json(updated);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Managed report setting could not be updated");
    res.status(503).json({ error: "Managed report setting could not be updated." });
  }
});

router.get("/admin/flagged-leads", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    const items = await db.select({
      flagId: leadInfoFlagsTable.id,
      businessId: businessesTable.id,
      businessName: businessesTable.businessName,
      leadId: leadsTable.id,
      reason: leadInfoFlagsTable.reason,
      createdAt: leadInfoFlagsTable.createdAt,
    }).from(leadInfoFlagsTable)
      .innerJoin(leadsTable, eq(leadsTable.id, leadInfoFlagsTable.leadId))
      .innerJoin(businessesTable, eq(businessesTable.id, leadInfoFlagsTable.businessId))
      .where(isNull(leadInfoFlagsTable.resolvedAt))
      .orderBy(desc(leadInfoFlagsTable.createdAt))
      .limit(200);
    res.json({ items });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Flagged leads could not be loaded");
    res.status(503).json({ error: "Flagged leads could not be loaded." });
  }
});

router.patch("/admin/lead-information-flags/:flagId/resolve", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const id = z.coerce.number().int().positive().safeParse(req.params.flagId);
  if (!id.success) { res.status(400).json({ error: "Invalid flag ID." }); return; }
  try {
    const [updated] = await db.update(leadInfoFlagsTable)
      .set({
        resolvedAt: new Date(),
        resolvedBy: typeof res.locals.adminEmail === "string" ? res.locals.adminEmail : "admin",
      })
      .where(and(eq(leadInfoFlagsTable.id, id.data), isNull(leadInfoFlagsTable.resolvedAt)))
      .returning({ id: leadInfoFlagsTable.id });
    if (!updated) { res.status(404).json({ error: "Unresolved flag not found." }); return; }
    res.json({ resolved: true });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Lead information flag could not be resolved");
    res.status(503).json({ error: "Lead information flag could not be resolved." });
  }
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
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
  UpdateAdminBusinessRetellPhoneNumberParams,
  UpdateAdminBusinessRetellPhoneNumberBody,
  UpdateAdminBusinessRetellPhoneNumberResponse,
  GetAdminSystemAlertsResponse,
  ResolveAdminSystemAlertParams,
  ResolveAdminSystemAlertResponse,
  GetAdminHealthCheckResponse,
  GetAdminUsageAlertSettingsResponse,
  UpdateAdminUsageAlertSettingsBody,
  UpdateAdminUsageAlertSettingsResponse,
  UpdateAdminFirstClientChecklistItemParams,
  UpdateAdminFirstClientChecklistItemBody,
  UpdateAdminFirstClientChecklistItemResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import {
  getAdminActivity,
  getAdminBusiness,
  getAdminOverview,
} from "../lib/adminData";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getAdminCallQuality } from "../lib/callQuality";
import { getUsageAlertSettings, saveUsageAlertSettings } from "../lib/usageAlertSettings";
import { isFirstClientChecklistKey, updateFirstClientChecklistItem } from "../lib/firstClientChecklist";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { businessAdminEventsTable, businessesTable, db, leadInfoFlagsTable, leadsTable, pool, supportRequestsTable } from "@workspace/db";
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
import { getAuth } from "@clerk/express";
import { sql } from "drizzle-orm";
import {
  getAdminRetellHealthCheck,
  getAdminRetellSystemAlerts,
  resolveRetellSystemAlert,
} from "../lib/retellSystemAlerts";

const router: IRouter = Router();

router.use("/admin", requireAdmin);
router.patch("/admin/businesses/:businessId/suspension", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const id = z.coerce.number().int().positive().safeParse(req.params.businessId);
  const input = z.object({
    suspended: z.boolean(),
    reason: z.string().trim().min(3).max(300).optional(),
  }).strict().safeParse(req.body);
  if (!id.success || !input.success || (input.data.suspended && !input.data.reason)) {
    res.status(400).json({ error: "A reason of 3–300 characters is required to suspend an account." });
    return;
  }
  try {
    const actorUserId = getAuth(req).userId;
    if (!actorUserId) { res.sendStatus(401); return; }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(542313, ${id.data})`);
      const locked = await tx.execute(sql`
        SELECT id, account_status, account_status_reason
        FROM businesses WHERE id=${id.data} AND is_internal=false AND is_sample=false
        FOR UPDATE
      `);
      const current = locked.rows[0] as {
        id: number; account_status: "active" | "suspended"; account_status_reason: string | null;
      } | undefined;
      if (!current) return null;
      const nextStatus = input.data.suspended ? "suspended" : "active";
      const nextReason = input.data.suspended ? input.data.reason!.trim() : null;
      if (current.account_status !== nextStatus || current.account_status_reason !== nextReason) {
        await tx.update(businessesTable).set({
          accountStatus: nextStatus,
          accountStatusReason: nextReason,
          accountStatusUpdatedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(businessesTable.id, id.data));
        await tx.insert(businessAdminEventsTable).values({
          businessId: id.data,
          actorUserId,
          action: input.data.suspended ? "suspended" : "restored",
          previousValue: current.account_status,
          newValue: nextStatus,
          reason: nextReason,
        });
      }
      return { businessId: id.data, accountStatus: nextStatus, reason: nextReason };
    });
    if (!result) { res.sendStatus(404); return; }
    res.json(result);
  } catch (error) {
    req.log.error({ businessId: id.data, errorName: error instanceof Error ? error.name : "UnknownError" }, "Business suspension update failed");
    res.status(502).json({ error: "The account status could not be updated." });
  }
});

router.get("/admin/support-requests", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    const rows = await db.select().from(supportRequestsTable)
      .orderBy(desc(supportRequestsTable.createdAt), desc(supportRequestsTable.id)).limit(100);
    res.json({ items: rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      businessName: row.businessName,
      ownerEmail: row.ownerEmail,
      message: row.message,
      urgent: row.urgent,
      createdAt: row.createdAt.toISOString(),
      emailStatus: row.emailStatus,
    })) });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Admin support inbox failed");
    res.status(502).json({ error: "Support requests could not be loaded." });
  }
});
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

router.patch("/admin/businesses/:businessId/retell-phone-number", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = UpdateAdminBusinessRetellPhoneNumberParams.safeParse(req.params);
  const body = UpdateAdminBusinessRetellPhoneNumberBody.safeParse(req.body);
  const actorUserId = res.locals.adminUserId;
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid business ID and E.164 Retell phone number." });
    return;
  }
  if (typeof actorUserId !== "string" || !actorUserId) {
    res.sendStatus(401);
    return;
  }

  const businessId = params.data.businessId;
  const phoneNumber = body.data.retellPhoneNumber;
  const normalized = phoneNumber.replace(/\D/g, "");
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(542313, ${businessId})`);
      const locked = await tx.execute(sql`
        SELECT id, retell_phone_number AS "retellPhoneNumber"
        FROM businesses WHERE id=${businessId} FOR UPDATE
      `);
      const current = locked.rows[0] as { id: number; retellPhoneNumber: string | null } | undefined;
      if (!current) return { kind: "not_found" as const };
      if (current.retellPhoneNumber === phoneNumber) {
        return { kind: "updated" as const, changed: false, retellPhoneNumber: phoneNumber };
      }

      const conflict = await tx.execute(sql`
        SELECT id FROM businesses
        WHERE retell_phone_normalized=${normalized} AND id <> ${businessId}
        LIMIT 1
      `);
      if (conflict.rows.length) return { kind: "duplicate" as const };

      await tx.execute(sql`
        UPDATE businesses
        SET retell_phone_number=${phoneNumber}, updated_at=now()
        WHERE id=${businessId}
      `);
      await tx.insert(businessAdminEventsTable).values({
        businessId,
        actorUserId,
        action: "retell_phone_number_changed",
        previousValue: current.retellPhoneNumber,
        newValue: phoneNumber,
        reason: "Updated from the Founder Console business detail page.",
      });
      return { kind: "updated" as const, changed: true, retellPhoneNumber: phoneNumber };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "Business not found." });
      return;
    }
    if (outcome.kind === "duplicate") {
      res.status(409).json({ error: "That Retell phone number is already assigned to another business." });
      return;
    }
    res.json(UpdateAdminBusinessRetellPhoneNumberResponse.parse({
      businessId,
      retellPhoneNumber: outcome.retellPhoneNumber,
      changed: outcome.changed,
    }));
  } catch (error) {
    const candidate = error as { code?: unknown; cause?: { code?: unknown } };
    if (candidate?.code === "23505" || candidate?.cause?.code === "23505") {
      res.status(409).json({ error: "That Retell phone number is already assigned to another business." });
      return;
    }
    req.log.error(
      { businessId, errorName: error instanceof Error ? error.name : "UnknownError" },
      "Business Retell number could not be updated",
    );
    res.status(502).json({ error: "The Retell phone number could not be updated." });
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

router.get("/admin/usage-alert-settings", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(GetAdminUsageAlertSettingsResponse.parse(await getUsageAlertSettings()));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Usage alert settings request failed",
    );
    res.status(503).json({ error: "Unable to load usage alert settings" });
  }
});

router.patch("/admin/usage-alert-settings", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const body = UpdateAdminUsageAlertSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "One or more thresholds are outside the supported range" });
    return;
  }
  const actorUserId = getAuth(req).userId;
  if (!actorUserId) {
    res.sendStatus(401);
    return;
  }
  try {
    res.json(UpdateAdminUsageAlertSettingsResponse.parse(
      await saveUsageAlertSettings(body.data, actorUserId),
    ));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Usage alert settings update failed",
    );
    res.status(503).json({ error: "Unable to save usage alert settings" });
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

router.patch("/admin/businesses/:businessId/first-client-checklist/:itemKey", async (req, res): Promise<void> => {
  const params = UpdateAdminFirstClientChecklistItemParams.safeParse(req.params);
  const body = UpdateAdminFirstClientChecklistItemBody.safeParse(req.body);
  if (!params.success || !body.success || !isFirstClientChecklistKey(params.data.itemKey)) {
    res.status(400).json({ error: "Invalid checklist item or completion state" });
    return;
  }
  const actorUserId = getAuth(req).userId;
  if (!actorUserId) {
    res.sendStatus(401);
    return;
  }
  try {
    const item = await updateFirstClientChecklistItem({
      businessId: params.data.businessId,
      itemKey: params.data.itemKey,
      completed: body.data.completed,
      actorUserId,
    });
    if (!item) {
      res.sendStatus(404);
      return;
    }
    res.json(UpdateAdminFirstClientChecklistItemResponse.parse(item));
  } catch (error) {
    req.log.error(
      {
        businessId: params.data.businessId,
        itemKey: params.data.itemKey,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "First-client checklist update failed",
    );
    res.status(503).json({ error: "Unable to save checklist item" });
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
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  GetBusinessProfileResponse,
  UpdateBusinessProfileBody,
  UpdateBusinessProfileResponse,
  PreviewBusinessWebsiteBody,
  PreviewBusinessWebsiteResponse,
  GetNativeBusinessSetupStatusResponse,
  OnboardBusinessBody,
  SubmitNativeBusinessSetupBody,
  SubmitNativeBusinessSetupResponse,
} from "@workspace/api-zod";
import { saveBusinessWithOptionalPhone } from "../lib/retellProvisioning";
import {
  findBusinessByClerkUserId,
  updateBusiness,
  updateOwnedBusiness,
  WEBSITE_ENRICHMENT_FIELDS,
  type WebsiteEnrichmentField,
} from "../lib/businessDirectory";
import { pool, supportRequestsTable, db } from "@workspace/db";
import { config as billingConfig } from "../billing/policy";
import { normalizeWebsiteUrl, previewBusinessWebsite, unavailableWebsitePreview, UnsafeWebsiteUrlError } from "../lib/websiteEnrichment";
import { parseBusinessHours, validTimeZone } from "../lib/businessHours";
import { businessNameValidationError } from "../lib/businessNameValidation";
import { getOwnerSmsReadiness } from "../lib/ownerSms";
import { queueFounderPushNotification, recordOperationalFailure } from "../lib/operationalFailures";
import { sendAdminSupportRequestEmail } from "../lib/gmail";
import { runNotificationOutboxNow } from "../lib/notificationService";
import { initializeInvoices } from "../invoicing/service";
import { runInvoiceCycle } from "../invoicing/worker";
import { createUserRateLimit } from "../middlewares/requestRateLimit";

const router: IRouter = Router();
const businessProfileWriteRateLimit = createUserRateLimit({
  bucket: "business-profile-write",
  windowMs: 60_000,
  maxRequests: 30,
});
const websitePreviewRateLimit = createUserRateLimit({
  bucket: "website-preview",
  windowMs: 60_000,
  maxRequests: 5,
});
const businessOnboardingRateLimit = createUserRateLimit({
  bucket: "business-onboarding",
  windowMs: 60 * 60_000,
  maxRequests: 10,
});
const supportRequestRateLimit = createUserRateLimit({
  bucket: "owner-support-request",
  windowMs: 60 * 60_000,
  maxRequests: 5,
});
// Shared version for the Privacy Policy, Terms of Service, and Client Service Agreement; bump when any changes.
const CURRENT_AGREEMENT_VERSION = "v1";
const ONBOARDING_TRIMMED_FIELDS = [
  "businessHours",
  "timeZone",
  "agentName",
  "servicesOffered",
  "servicesNotOffered",
  "businessWebsiteUrl",
  "otherPolicies",
  "ownerPhone",
  "emergencyEscalationPhone",
] as const;

function normalizeOnboardingInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = { ...(value as Record<string, unknown>) };
  for (const field of ONBOARDING_TRIMMED_FIELDS) {
    if (typeof normalized[field] === "string") normalized[field] = (normalized[field] as string).trim();
  }
  return normalized;
}

type OwnedBusiness = NonNullable<Awaited<ReturnType<typeof findBusinessByClerkUserId>>>;
type BusinessProfileUpdate = z.infer<typeof UpdateBusinessProfileBody>;
type BusinessProfileField = keyof BusinessProfileUpdate;

const BUSINESS_PROFILE_COLUMN_BY_FIELD: Record<BusinessProfileField, string> = {
  ownerPhone: "ownerPhone",
  leadAlertsEnabled: "leadAlertsEnabled",
  businessHours: "businessHours",
  timeZone: "timeZone",
  businessName: "businessName",
  agentName: "agentName",
  businessType: "businessType",
  servicesOffered: "servicesOffered",
  businessWebsiteUrl: "businessWebsiteUrl",
  ownerEmail: "ownerEmail",
  serviceArea: "serviceArea",
  personalityToneDescription: "personalityToneDescription",
  servicesNotOffered: "servicesNotOffered",
  majorIssueExamples: "majorIssueExamples",
  pricingPolicy: "pricingPolicy",
  financingPolicy: "financingPolicy",
  brandsWorkedWith: "brandsWorkedWith",
  responseTimeCommitment: "typicalResponseTimeCommitment",
  warrantyInfo: "warrantyInfo",
  maintenancePlanOfferings: "maintenancePlanOfferings",
  credentials: "credentialsCertifications",
  ownerAvailability: "ownerAvailability",
  emergencyContactInfo: "emergencyContactInfo",
  emergencyAvailable: "emergencyAvailable",
  emergencyEscalationPhone: "emergencyEscalationPhone",
  aiPromisePolicy: "aiPromisePolicy",
};

const ENRICHMENT_FIELD_BY_PROFILE_FIELD: Partial<
  Record<BusinessProfileField, WebsiteEnrichmentField>
> = {
  businessType: "businessType",
  servicesOffered: "servicesOffered",
  majorIssueExamples: "majorIssueExamples",
  servicesNotOffered: "servicesNotOffered",
  pricingPolicy: "pricingPolicy",
  financingPolicy: "financingPolicy",
  brandsWorkedWith: "brandsWorkedWith",
  responseTimeCommitment: "typicalResponseTimeCommitment",
  warrantyInfo: "warrantyInfo",
  maintenancePlanOfferings: "maintenancePlanOfferings",
  credentials: "credentialsCertifications",
  ownerAvailability: "ownerAvailability",
  emergencyContactInfo: "emergencyContactInfo",
};

function toBusinessProfile(business: OwnedBusiness) {
  return {
    isInternal: business.isInternal,
    billingMode: business.billingMode,
    ownerPhone: business.ownerPhone ?? null,
    leadAlertsEnabled: business.leadAlertsEnabled ?? true,
    businessHours: business.businessHours ?? "",
    timeZone: business.timeZone ?? "",
    businessName: business.businessName,
    agentName: business.agentName,
    businessType: business.businessType,
    servicesOffered: business.servicesOffered ?? null,
    businessWebsiteUrl: business.businessWebsiteUrl,
    ownerEmail: business.ownerEmail,
    serviceArea: business.serviceArea,
    personalityToneDescription: business.personalityToneDescription,
    servicesNotOffered: business.servicesNotOffered,
    majorIssueExamples: business.majorIssueExamples,
    pricingPolicy: business.pricingPolicy,
    financingPolicy: business.financingPolicy,
    brandsWorkedWith: business.brandsWorkedWith,
    responseTimeCommitment: business.typicalResponseTimeCommitment,
    warrantyInfo: business.warrantyInfo,
    maintenancePlanOfferings: business.maintenancePlanOfferings,
    credentials: business.credentialsCertifications,
    ownerAvailability: business.ownerAvailability,
    emergencyContactInfo: business.emergencyContactInfo,
    emergencyAvailable: business.emergencyAvailable ?? null,
    emergencyEscalationPhone: business.emergencyEscalationPhone ?? null,
    aiPromisePolicy: business.aiPromisePolicy === "appointment_windows" ? "appointment_windows"
      : business.aiPromisePolicy === "callback_only" ? "callback_only" : null,
    retellPhoneNumber: business.retellPhoneNumber,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function setPrivateOwnerResponseHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");
}

router.get("/businesses/me", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  setPrivateOwnerResponseHeaders(res);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) {
      res.status(404).json({ error: "No business is configured for this account" });
      return;
    }

    res.status(200).json(GetBusinessProfileResponse.parse(toBusinessProfile(business)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Business profile could not be loaded",
    );
    res.status(502).json({ error: "Business profile could not be loaded" });
  }
});

router.get("/businesses/me/enforcement-status", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "No business is configured for this account" }); return; }
    res.json({
      suspended: Boolean(business.billingEnforcementSuspendedAt),
      source: business.billingEnforcementInvoiceSource ?? null,
    });
  } catch {
    // The client treats an unavailable enforcement check as service-on.
    res.status(503).json({ error: "Billing access status is temporarily unavailable." });
  }
});

router.get("/businesses/me/call-usage", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "No business is configured for this account" }); return; }
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const result = await pool.query<{ count: number | string }>(
      `SELECT count(*)::int AS count
       FROM retell_call_records
       WHERE business_id = $1 AND call_started_at >= $2 AND call_started_at < $3
         AND COALESCE(duration_ms, 0) > 0`,
      [business.id, periodStart, periodEnd],
    );
    const plan = billingConfig.plans.find((entry) => entry.id === business.chosenPlan);
    res.json({
      count: Number(result.rows[0]?.count ?? 0),
      includedCalls: plan?.callLimit ?? null,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Business call usage could not be loaded");
    res.status(502).json({ error: "Business call usage could not be loaded" });
  }
});

router.get("/businesses/me/monthly-report", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business) { res.status(404).json({ error: "No business is configured for this account" }); return; }
    const timeZone = business.timeZone || "America/New_York";
    if (!business.managedReportsEnabled) {
      const period = await pool.query<{ month: string }>(
        "SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-01') AS month",
        [timeZone],
      );
      res.json({
        enabled: false, month: period.rows[0]?.month ?? new Date().toISOString().slice(0, 7) + "-01",
        calls: 0, leadsCaptured: 0, urgentLeads: 0, contactedLeads: 0, pendingLeads: 0, busiestDays: [],
      });
      return;
    }
    const result = await pool.query<{
      month: string;
      calls: number | string;
      leads_captured: number | string;
      urgent_leads: number | string;
      contacted_leads: number | string;
      pending_leads: number | string;
      busiest_days: Array<{ day: string; callCount: number }> | string | null;
    }>(
      `WITH bounds AS (
         SELECT date_trunc('month', now() AT TIME ZONE $2) AS local_start,
                date_trunc('month', now() AT TIME ZONE $2) + interval '1 month' AS local_end
       ), call_stats AS (
         SELECT count(*)::int AS calls
         FROM retell_call_records r, bounds b
         WHERE r.business_id = $1 AND r.call_started_at >= timezone($2, b.local_start)
           AND r.call_started_at < timezone($2, b.local_end) AND COALESCE(r.duration_ms, 0) > 0
       ), lead_stats AS (
         SELECT count(*)::int AS leads_captured,
           count(*) FILTER (WHERE COALESCE(urgency_level, '') ~* '(urgent|high|emergency|same.day)')::int AS urgent_leads,
           count(*) FILTER (WHERE lower(status) IN ('called_back','booked','closed','contacted','complete','completed','done'))::int AS contacted_leads,
           count(*) FILTER (WHERE lower(status) NOT IN ('called_back','booked','closed','contacted','complete','completed','done'))::int AS pending_leads
         FROM leads l, bounds b
         WHERE l.business_id = $1 AND l.created_at >= timezone($2, b.local_start)
           AND l.created_at < timezone($2, b.local_end)
       ), busiest AS (
         SELECT json_agg(json_build_object('day', to_char(day, 'YYYY-MM-DD'), 'callCount', call_count)
                         ORDER BY call_count DESC, day DESC) AS days
         FROM (
           SELECT (r.call_started_at AT TIME ZONE $2)::date AS day, count(*)::int AS call_count
           FROM retell_call_records r, bounds b
           WHERE r.business_id = $1 AND r.call_started_at >= timezone($2, b.local_start)
             AND r.call_started_at < timezone($2, b.local_end) AND COALESCE(r.duration_ms, 0) > 0
           GROUP BY 1 ORDER BY call_count DESC, day DESC LIMIT 3
         ) daily
       )
       SELECT to_char(b.local_start, 'YYYY-MM-01') AS month, c.calls, l.leads_captured,
              l.urgent_leads, l.contacted_leads, l.pending_leads, COALESCE(d.days, '[]'::json) AS busiest_days
       FROM bounds b CROSS JOIN call_stats c CROSS JOIN lead_stats l CROSS JOIN busiest d`,
      [business.id, timeZone],
    );
    const row = result.rows[0];
    let busiestDays: Array<{ day: string; callCount: number }> = [];
    try {
      const parsed = typeof row?.busiest_days === "string" ? JSON.parse(row.busiest_days) : row?.busiest_days;
      if (Array.isArray(parsed)) busiestDays = parsed;
    } catch { /* Invalid aggregate output is represented as an empty chart, not raw data. */ }
    res.json({
      enabled: true,
      month: row?.month ?? new Date().toISOString().slice(0, 7) + "-01",
      calls: Number(row?.calls ?? 0),
      leadsCaptured: Number(row?.leads_captured ?? 0),
      urgentLeads: Number(row?.urgent_leads ?? 0),
      contactedLeads: Number(row?.contacted_leads ?? 0),
      pendingLeads: Number(row?.pending_leads ?? 0),
      busiestDays,
    });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Managed monthly report could not be loaded");
    res.status(502).json({ error: "Managed monthly report could not be loaded" });
  }
});

router.patch("/businesses/me", businessProfileWriteRateLimit, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  setPrivateOwnerResponseHeaders(res);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = UpdateBusinessProfileBody.strict().safeParse(req.body);
  if (!body.success || Object.keys(body.data ?? {}).length === 0) {
    res.status(400).json({ error: "At least one valid business profile field is required" });
    return;
  }

  const businessName = body.data.businessName?.trim();
  if (body.data.ownerPhone && !/^\+[1-9]\d{7,14}$/.test(body.data.ownerPhone.trim())) {
    res.status(400).json({ error: "Owner phone must include a country code, for example +14155550123" });
    return;
  }
  if (body.data.emergencyEscalationPhone && !/^\+[1-9]\d{7,14}$/.test(body.data.emergencyEscalationPhone.trim())) {
    res.status(400).json({ error: "Emergency escalation phone must include a country code, for example +14155550123" });
    return;
  }
  if ((body.data.businessHours?.trim() && !parseBusinessHours(body.data.businessHours))
    || (body.data.timeZone?.trim() && !validTimeZone(body.data.timeZone.trim()))) {
    res.status(400).json({ error: "Use valid business hours (Mon-Fri 09:00-17:00; Sat 10:00-14:00, or 24/7) and an IANA time zone" });
    return;
  }
  if (body.data.businessName !== undefined && !businessName) {
    res.status(400).json({ error: "Business name cannot be empty" });
    return;
  }
  if (businessName !== undefined) {
    const nameError = businessNameValidationError(businessName);
    if (nameError) {
      res.status(400).json({ error: nameError });
      return;
    }
  }

  const ownerEmail = body.data.ownerEmail?.trim();
  if (
    ownerEmail !== undefined
    && !z.string().email().safeParse(ownerEmail).success
  ) {
    res.status(400).json({ error: "A valid owner email is required" });
    return;
  }

  const websiteUrl = typeof body.data.businessWebsiteUrl === "string"
    ? body.data.businessWebsiteUrl.trim()
    : body.data.businessWebsiteUrl;
  if (websiteUrl && !isHttpUrl(websiteUrl)) {
    res.status(400).json({ error: "Website must be a valid HTTP or HTTPS URL" });
    return;
  }

  try {
    const currentBusiness = await findBusinessByClerkUserId(userId);
    if (!currentBusiness) {
      res.status(404).json({ error: "No business is configured for this account" });
      return;
    }
    const emergencyAvailable = Object.prototype.hasOwnProperty.call(body.data, "emergencyAvailable")
      ? body.data.emergencyAvailable
      : currentBusiness.emergencyAvailable;
    const emergencyPhone = Object.prototype.hasOwnProperty.call(body.data, "emergencyEscalationPhone")
      ? body.data.emergencyEscalationPhone
      : currentBusiness.emergencyEscalationPhone;
    if (emergencyAvailable === true && (!emergencyPhone || !/^\+[1-9]\d{7,14}$/.test(emergencyPhone.trim()))) {
      res.status(400).json({ error: "Add an emergency escalation phone when 24/7 emergency calls are enabled." });
      return;
    }

    const changes: Parameters<typeof updateOwnedBusiness>[2] = {};
    for (
      const [profileField, databaseField]
      of Object.entries(BUSINESS_PROFILE_COLUMN_BY_FIELD) as [BusinessProfileField, string][]
    ) {
      if (!Object.prototype.hasOwnProperty.call(body.data, profileField)) continue;

      const value = body.data[profileField];
      const normalizedValue = typeof value === "boolean" ? value : typeof value === "string" ? value.trim() : null;
      const requiredValue = profileField === "businessName" || profileField === "ownerEmail"
        || profileField === "businessHours" || profileField === "timeZone";
      Object.assign(changes, {
        [databaseField]: typeof normalizedValue === "boolean" || requiredValue ? normalizedValue : normalizedValue || null,
      });
    }
    if (body.data.emergencyAvailable === false) changes.emergencyEscalationPhone = null;

    const websiteEnrichmentSources = {
      ...(currentBusiness.websiteEnrichmentSources ?? {}),
    };
    let clearedEnrichmentSource = false;
    for (
      const [profileField, enrichmentField]
      of Object.entries(ENRICHMENT_FIELD_BY_PROFILE_FIELD) as [
        BusinessProfileField,
        WebsiteEnrichmentField,
      ][]
    ) {
      if (!Object.prototype.hasOwnProperty.call(body.data, profileField)) continue;
      delete websiteEnrichmentSources[enrichmentField];
      clearedEnrichmentSource = true;
    }
    if (clearedEnrichmentSource) {
      changes.websiteEnrichmentSources = websiteEnrichmentSources;
    }

    const updatedBusiness = await updateOwnedBusiness(
      currentBusiness.id,
      userId,
      changes,
    );
    if (!updatedBusiness) {
      res.status(404).json({ error: "No business is configured for this account" });
      return;
    }

    res.status(200).json(
      UpdateBusinessProfileResponse.parse(toBusinessProfile(updatedBusiness)),
    );
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Business profile could not be updated",
    );
    res.status(502).json({ error: "Business profile could not be updated" });
  }
});

const activeWebsitePreviews = new Set<string>();

router.post("/businesses/onboarding/website-preview", websitePreviewRateLimit, async (req, res): Promise<void> => {
  setPrivateOwnerResponseHeaders(res);
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const body = PreviewBusinessWebsiteBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter a valid public business website URL." }); return; }
  if (activeWebsitePreviews.has(userId)) {
    res.status(429).json({ error: "Please wait a moment before reading the website again." });
    return;
  }
  activeWebsitePreviews.add(userId);
  try {
    const url = normalizeWebsiteUrl(body.data.websiteUrl);
    const existingBusiness = await findBusinessByClerkUserId(userId);
    if (existingBusiness?.isSample) {
      res.status(200).json(PreviewBusinessWebsiteResponse.parse(unavailableWebsitePreview("unavailable")));
      return;
    }
    res.status(200).json(PreviewBusinessWebsiteResponse.parse(await previewBusinessWebsite(url.toString())));
  } catch (error) {
    if (error instanceof UnsafeWebsiteUrlError) {
      res.status(400).json({ error: "Use a public HTTP or HTTPS business website, without credentials or private network addresses." });
    } else {
      req.log.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Optional website preview did not complete");
      res.status(200).json(PreviewBusinessWebsiteResponse.parse(unavailableWebsitePreview()));
    }
  } finally {
    activeWebsitePreviews.delete(userId);
  }
});

router.get("/businesses/native-onboard/status", async (req, res): Promise<void> => {
  setPrivateOwnerResponseHeaders(res);
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const business = await findBusinessByClerkUserId(userId);
    res.json(GetNativeBusinessSetupStatusResponse.parse({
      submitted: Boolean(business),
      businessName: business?.businessName ?? null,
      provisioningState: business?.provisioningState ?? null,
    }));
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown native setup status error" },
      "Could not check native business setup status",
    );
    res.status(503).json({ error: "Business setup status is temporarily unavailable." });
  }
});

router.post("/businesses/native-onboard", businessOnboardingRateLimit, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = SubmitNativeBusinessSetupBody.strict().safeParse(req.body);
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid native business setup payload");
    res.status(400).json({ error: "Complete the required business details and accept all three agreements." });
    return;
  }

  const nameError = businessNameValidationError(body.data.businessName);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }
  const answers = [
    body.data.businessType,
    body.data.servicesOffered,
    body.data.servicesNotOffered,
    body.data.serviceArea,
    body.data.majorIssueExamples,
  ];
  if (answers.some((value) => !value.trim())) {
    res.status(400).json({ error: "Business type, services offered and excluded, service area, and urgent-issue examples are required." });
    return;
  }
  if (body.data.emergencyAvailable && (!body.data.emergencyEscalationPhone
    || !/^\+[1-9]\d{7,14}$/.test(body.data.emergencyEscalationPhone.trim()))) {
    res.status(400).json({ error: "Add a valid country-code emergency escalation phone when 24/7 emergency calls are enabled." });
    return;
  }
  if (!body.data.businessHours.trim() || !parseBusinessHours(body.data.businessHours)
    || !validTimeZone(body.data.timeZone)) {
    res.status(400).json({ error: "Enter valid business hours and a time zone." });
    return;
  }
  if (body.data.websiteScrapePreviewed && body.data.websiteSuggestionsReviewed !== true) {
    res.status(400).json({ error: "Review the website suggestions before submitting." });
    return;
  }

  const rawWebsiteUrl = body.data.businessWebsiteUrl?.trim() ?? "";
  if (rawWebsiteUrl && !isHttpUrl(rawWebsiteUrl)) {
    res.status(400).json({ error: "Website must be a valid HTTP or HTTPS URL." });
    return;
  }

  try {
    const existingBusiness = await findBusinessByClerkUserId(userId);
    const retryingNativeSetup = existingBusiness?.provisioningState === "awaiting_activation"
      && !existingBusiness.chosenPlan
      && !existingBusiness.retellPhoneNumber;
    if (existingBusiness && !retryingNativeSetup) {
      res.status(409).json({ error: "A business setup is already linked to this account." });
      return;
    }
    const ownerPhone = body.data.ownerPhone === undefined
      ? existingBusiness?.ownerPhone ?? null
      : body.data.ownerPhone?.trim() || null;
    if (ownerPhone && !/^\+[1-9]\d{7,14}$/.test(ownerPhone)) {
      res.status(400).json({ error: "Owner mobile number must include a country code, for example +14155550123." });
      return;
    }
    const smsReady = getOwnerSmsReadiness().ready;
    if (body.data.smsAlertsConsent && !smsReady) {
      res.status(409).json({ error: "Text alerts are not available right now." });
      return;
    }
    const smsAlertsConsent = smsReady && (body.data.smsAlertsConsent
      ?? existingBusiness?.smsAlertsConsent
      ?? false);
    if (smsAlertsConsent && !ownerPhone) {
      res.status(400).json({ error: "Enter a mobile number before opting in to text alerts." });
      return;
    }
    const smsAlertsConsentAt = body.data.smsAlertsConsent === undefined
      ? existingBusiness?.smsAlertsConsentAt ?? (smsAlertsConsent ? new Date() : null)
      : smsAlertsConsent ? new Date() : null;

    await saveBusinessWithOptionalPhone({
      clerkUserId: userId,
      businessName: body.data.businessName.trim(),
      ownerEmail: body.data.ownerEmail.trim(),
      ownerPhone,
      smsAlertsConsent,
      smsAlertsConsentAt,
      businessType: body.data.businessType.trim(),
      servicesOffered: body.data.servicesOffered.trim(),
      servicesNotOffered: body.data.servicesNotOffered.trim(),
      emergencyAvailable: body.data.emergencyAvailable,
      emergencyEscalationPhone: body.data.emergencyAvailable ? body.data.emergencyEscalationPhone?.trim() ?? null : null,
      aiPromisePolicy: body.data.aiPromisePolicy,
      serviceArea: body.data.serviceArea.trim(),
      majorIssueExamples: body.data.majorIssueExamples.trim(),
      businessHours: body.data.businessHours.trim(),
      timeZone: body.data.timeZone.trim(),
      agentName: body.data.agentName?.trim() || null,
      personalityToneDescription: "",
      otherPolicies: "",
      pricingPolicy: "",
      financingPolicy: "",
      brandsWorkedWith: "",
      typicalResponseTimeCommitment: "",
      warrantyInfo: "",
      maintenancePlanOfferings: "",
      credentialsCertifications: "",
      ownerAvailability: "",
      emergencyContactInfo: "",
      businessWebsiteUrl: rawWebsiteUrl || null,
      isSample: false,
      chosenPlan: null,
      startupAgeMonths: null,
      manualPaymentState: null,
      provisioningState: "awaiting_activation",
      agreementsAcceptedAt: new Date(),
      agreementsAcceptedVersion: CURRENT_AGREEMENT_VERSION,
      websiteEnrichmentAttemptedAt: null,
    });

    res.status(existingBusiness ? 200 : 201).json(SubmitNativeBusinessSetupResponse.parse({
      status: "received",
      provisioningState: "awaiting_activation",
    }));
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown native business setup error" },
      "Native business setup failed while saving",
    );
    res.status(502).json({ error: "We could not save your setup. Please try again." });
  }
});

router.post("/businesses/onboard", businessOnboardingRateLimit, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = OnboardBusinessBody.safeParse(normalizeOnboardingInput(req.body));
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid business onboarding payload");
    res.status(400).json({ error: "Complete the required business details and accept all three agreements." });
    return;
  }

  const nameError = businessNameValidationError(body.data.businessName);
  if(body.data.chosenPlan === "startup" && body.data.startupAgeMonths === undefined) {
    res.status(400).json({error:"Startup requires a business age under 18 months."});return;
  }
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }
  if ([body.data.businessType, body.data.serviceArea, body.data.majorIssueExamples]
    .some((value) => !value.trim())) {
    res.status(400).json({ error: "Business type, service area, and urgent-issue examples are required." });
    return;
  }
  if ((body.data.businessHours && !parseBusinessHours(body.data.businessHours))
    || (body.data.timeZone && !validTimeZone(body.data.timeZone))) {
    res.status(400).json({ error: "Enter valid business hours and a time zone." });
    return;
  }
  if (body.data.websiteScrapePreviewed && body.data.websiteSuggestionsReviewed !== true) {
    res.status(400).json({ error: "Review the website suggestions and missing fields before saving." });
    return;
  }
  if (!body.data.servicesOffered?.trim() || !body.data.servicesNotOffered.trim()) {
    res.status(400).json({ error: "Add short descriptions of services offered and services not offered (enter None if there are no exclusions)." });
    return;
  }
  if (body.data.emergencyAvailable && (!body.data.emergencyEscalationPhone
    || !/^\+[1-9]\d{7,14}$/.test(body.data.emergencyEscalationPhone.trim()))) {
    res.status(400).json({ error: "Add a valid country-code emergency escalation phone when 24/7 emergency calls are enabled." });
    return;
  }
  if (body.data.websitePreviewAttempted && !body.data.servicesOffered?.trim()
    && body.data.servicesOfferedDeferred !== true) {
    res.status(400).json({ error: "Tell us what you do, or choose I'll add this later before saving." });
    return;
  }
  if (body.data.businessWebsiteUrl && !isHttpUrl(body.data.businessWebsiteUrl)) {
    res.status(400).json({ error: "Website must be a valid HTTP or HTTPS URL" });
    return;
  }

  const isSample = body.data.isSample === true
    || body.data.businessName.trim().toLowerCase().includes("fictional sample")
    || body.data.ownerEmail.toLowerCase() === "owner@example.com";
  const businessInfo = {
    businessHours: body.data.businessHours ?? "",
    timeZone: body.data.timeZone ?? "",
    isSample,
    clerkUserId: userId,
    businessName: body.data.businessName.trim(),
    agentName: body.data.agentName?.trim() || null,
    businessType: body.data.businessType,
    servicesOffered: body.data.servicesOffered,
    ownerEmail: body.data.ownerEmail,
    serviceArea: body.data.serviceArea,
    personalityToneDescription: body.data.personalityToneDescription,
    servicesNotOffered: body.data.servicesNotOffered,
    otherPolicies: body.data.otherPolicies,
    majorIssueExamples: body.data.majorIssueExamples,
    pricingPolicy: body.data.pricingPolicy,
    financingPolicy: body.data.financingPolicy,
    brandsWorkedWith: body.data.brandsWorkedWith,
    typicalResponseTimeCommitment: body.data.responseTimeCommitment,
    warrantyInfo: body.data.warrantyInfo,
    maintenancePlanOfferings: body.data.maintenancePlanOfferings,
    credentialsCertifications: body.data.credentials,
    ownerAvailability: body.data.ownerAvailability,
    emergencyContactInfo: body.data.emergencyContactInfo,
    emergencyAvailable: body.data.emergencyAvailable,
    emergencyEscalationPhone: body.data.emergencyAvailable ? body.data.emergencyEscalationPhone : null,
    aiPromisePolicy: body.data.aiPromisePolicy,
    agreementsAcceptedAt: new Date(),
    agreementsAcceptedVersion: CURRENT_AGREEMENT_VERSION,
  };
  const submittedOwnerPhone = body.data.ownerPhone?.trim() || null;
  if (submittedOwnerPhone && !/^\+[1-9]\d{7,14}$/.test(submittedOwnerPhone)) {
    res.status(400).json({ error: "Owner mobile number must include a country code, for example +14155550123." });
    return;
  }
  const rawWebsiteUrl = body.data.businessWebsiteUrl?.trim() || "";
  const websiteUrl = !isSample && rawWebsiteUrl.length <= 2048 ? rawWebsiteUrl || null : null;

  try {
    const existingBusiness = await findBusinessByClerkUserId(userId);
    if (existingBusiness?.chosenPlan && existingBusiness.chosenPlan !== body.data.chosenPlan) {
      res.status(409).json({error:"Your plan is already saved. Please contact support to change it."});return;
    }
    const ownerPhone = isSample ? null : body.data.ownerPhone === undefined
      ? existingBusiness?.ownerPhone ?? null
      : submittedOwnerPhone;
    const smsReady = getOwnerSmsReadiness().ready;
    if (!isSample && body.data.smsAlertsConsent === true && !smsReady) {
      res.status(409).json({ error: "Text alerts are not available right now." });
      return;
    }
    const smsAlertsConsent = smsReady && !isSample && (body.data.smsAlertsConsent
      ?? existingBusiness?.smsAlertsConsent
      ?? false);
    if (smsAlertsConsent && !ownerPhone) {
      res.status(400).json({ error: "Enter a mobile number before opting in to text alerts." });
      return;
    }
    const smsAlertsConsentAt = !smsAlertsConsent
      ? null
      : body.data.smsAlertsConsent === undefined
        ? existingBusiness?.smsAlertsConsentAt ?? new Date()
        : new Date();
    const result = await saveBusinessWithOptionalPhone({
      ...businessInfo,
      ownerPhone,
      smsAlertsConsent,
      smsAlertsConsentAt,
      chosenPlan: existingBusiness ? existingBusiness.chosenPlan : body.data.chosenPlan,
      startupAgeMonths: existingBusiness ? existingBusiness.startupAgeMonths : body.data.startupAgeMonths ?? null,
      manualPaymentState: existingBusiness ? existingBusiness.manualPaymentState
        : body.data.chosenPlan === "startup" ? "requested" : "invoiced",
      businessWebsiteUrl: websiteUrl,
      websiteEnrichmentAttemptedAt: null,
    });
    await initializeInvoices(result.business.id);
    void runInvoiceCycle();
    if (result.phoneProvisioningPending && result.business.provisioningState !== "awaiting_payment") {
      const provisioningDetails = result.provisioningError instanceof Error
        ? result.provisioningError.message
        : "Unknown Retell provisioning error";
      req.log.warn(
        {
          businessId: result.business.id,
          error: provisioningDetails,
        },
        "Business saved; Retell phone provisioning is pending",
      );
      try {
        const inserted = await recordOperationalFailure({
          eventKey: `phone-provisioning:${result.business.id}:${result.business.provisioningState}`,
          source: "phone_provisioning",
          summary: "Business phone-number provisioning is pending",
          details: provisioningDetails,
          businessId: result.business.id,
          businessName: result.business.businessName,
        });
        if (inserted) {
          void runNotificationOutboxNow().catch((error) => {
            req.log.error(
              { error: error instanceof Error ? error.message : "Unknown outbox error" },
              "Could not deliver the phone-provisioning failure alert immediately",
            );
          });
        }
      } catch (error) {
        req.log.error(
          { businessId: result.business.id, error: error instanceof Error ? error.message : "Unknown persistence error" },
          "Could not record the phone-provisioning failure for admin review",
        );
      }
    }

    res.status(existingBusiness ? 200 : 201).json({
      phoneNumber: result.business.retellPhoneNumber,
      phoneProvisioningPending: result.phoneProvisioningPending,
      isSample: result.business.isSample,
      provisioningState: result.business.provisioningState,
      awaitingPayment: Boolean(result.business.chosenPlan && !result.business.firstInvoicePaidAt && !result.business.isSample),
    });
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("A live business cannot") || error.message.startsWith("Your plan is already saved"))) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown business onboarding error" },
      "Business onboarding failed while saving business",
    );
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to save business setup",
    });
  }
});

router.get("/businesses/me/export", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.sendStatus(401); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business || business.isInternal || business.isSample) { res.sendStatus(404); return; }
    const leads = await pool.query(
      `SELECT id, caller_name AS "callerName", phone_number AS "phoneNumber",
        callback_number AS "callbackNumber", transcript, summary, sentiment,
        private_notes AS "privateNotes", issue_reason AS "issueReason", address,
        urgency_level AS "urgencyLevel", availability, trade_intake_answers AS "tradeIntakeAnswers",
        status, contacted_at AS "contactedAt", contacted_by AS "contactedBy",
        created_at AS "createdAt"
       FROM leads WHERE business_id=$1 ORDER BY created_at DESC, id DESC`,
      [business.id],
    );
    const onboarding = {
      businessName: business.businessName,
      ownerEmail: business.ownerEmail,
      ownerPhone: business.ownerPhone,
      businessHours: business.businessHours,
      timeZone: business.timeZone,
      agentName: business.agentName,
      businessType: business.businessType,
      servicesOffered: business.servicesOffered,
      majorIssueExamples: business.majorIssueExamples,
      personalityToneDescription: business.personalityToneDescription,
      servicesNotOffered: business.servicesNotOffered,
      otherPolicies: business.otherPolicies,
      pricingPolicy: business.pricingPolicy,
      financingPolicy: business.financingPolicy,
      brandsWorkedWith: business.brandsWorkedWith,
      typicalResponseTimeCommitment: business.typicalResponseTimeCommitment,
      warrantyInfo: business.warrantyInfo,
      maintenancePlanOfferings: business.maintenancePlanOfferings,
      credentialsCertifications: business.credentialsCertifications,
      ownerAvailability: business.ownerAvailability,
      emergencyContactInfo: business.emergencyContactInfo,
      emergencyAvailable: business.emergencyAvailable,
      emergencyEscalationPhone: business.emergencyEscalationPhone,
      aiPromisePolicy: business.aiPromisePolicy,
      serviceArea: business.serviceArea,
      businessWebsiteUrl: business.businessWebsiteUrl,
      agreementsAcceptedAt: business.agreementsAcceptedAt,
      agreementsAcceptedVersion: business.agreementsAcceptedVersion,
    };
    res.json({
      exportedAt: new Date().toISOString(),
      businessName: business.businessName,
      onboarding,
      leads: leads.rows,
    });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Owner data export failed");
    res.status(502).json({ error: "Your data export could not be created. Please try again." });
  }
});

router.post("/businesses/me/forwarding-test", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.sendStatus(401); return; }
  try {
    const result = await pool.query<{ id: number; requested_at: Date }>(
      `UPDATE businesses SET forwarding_test_requested_at=now(), updated_at=now()
       WHERE clerk_user_id=$1 AND is_internal=false AND is_sample=false
       RETURNING id, forwarding_test_requested_at AS requested_at`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) { res.sendStatus(404); return; }
    res.json({ requestedAt: row.requested_at.toISOString(), verifiedAt: null, verified: false });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Forwarding test could not start");
    res.status(503).json({ error: "Forwarding verification is temporarily unavailable." });
  }
});

router.get("/businesses/me/forwarding-test", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.sendStatus(401); return; }
  try {
    const result = await pool.query<{ requested_at: Date | null; verified_at: Date | null }>(
      `SELECT b.forwarding_test_requested_at AS requested_at,
        (SELECT max(l.created_at) FROM leads l
          WHERE l.business_id=b.id AND b.forwarding_test_requested_at IS NOT NULL
            AND l.created_at >= b.forwarding_test_requested_at) AS verified_at
       FROM businesses b WHERE b.clerk_user_id=$1 AND b.is_internal=false AND b.is_sample=false`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) { res.sendStatus(404); return; }
    const freshCutoff = Date.now() - 24 * 60 * 60_000;
    const verifiedAt = row.verified_at && row.verified_at.getTime() >= freshCutoff
      ? row.verified_at.toISOString()
      : null;
    res.json({
      requestedAt: row.requested_at?.toISOString() ?? null,
      verifiedAt,
      verified: Boolean(verifiedAt),
    });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Forwarding test status could not load");
    res.status(503).json({ error: "Forwarding verification is temporarily unavailable." });
  }
});

router.post("/businesses/me/support-requests", supportRequestRateLimit, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  setPrivateOwnerResponseHeaders(res);
  if (!userId) { res.sendStatus(401); return; }
  const input = z.object({
    message: z.string().trim().min(5).max(3000),
    urgent: z.boolean().optional(),
  }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Write a message between 5 and 3,000 characters." }); return; }
  try {
    const business = await findBusinessByClerkUserId(userId);
    if (!business || business.isInternal || business.isSample) { res.sendStatus(404); return; }
    const urgent = input.data.urgent === true;
    const [saved] = await db.insert(supportRequestsTable).values({
      businessId: business.id,
      businessName: business.businessName,
      ownerEmail: business.ownerEmail ?? "Not recorded",
      message: input.data.message,
      urgent,
    }).returning({ id: supportRequestsTable.id });
    if (!saved) throw new Error("Support request was not saved");
    let emailSent = false;
    try {
      emailSent = await sendAdminSupportRequestEmail({
        businessName: business.businessName,
        ownerEmail: business.ownerEmail ?? "Not recorded",
        message: input.data.message,
        urgent,
      });
      await db.update(supportRequestsTable).set({ emailStatus: emailSent ? "sent" : "unconfigured" })
        .where(eq(supportRequestsTable.id, saved.id));
    } catch (error) {
      await db.update(supportRequestsTable).set({ emailStatus: "failed" })
        .where(eq(supportRequestsTable.id, saved.id));
      await recordOperationalFailure({
        eventKey: `support-request-email:${saved.id}`,
        source: "support_request_email",
        summary: "Owner support request email delivery failed",
        details: error instanceof Error ? error.message : "Gmail delivery failed",
        businessId: business.id,
        businessName: business.businessName,
        founderPush: {
          eventKey: `support-request-email:${saved.id}`,
          title: "Support request email failed",
          body: `${business.businessName} support request is saved, but email delivery failed.`,
          deepLink: "/admin/activity",
        },
      }).catch(() => false);
    }
    if (urgent) {
      const inserted = await queueFounderPushNotification({
        eventKey: `support-request-urgent:${saved.id}`,
        title: "Urgent owner support request",
        body: `${business.businessName} submitted an urgent support request.`,
        deepLink: "/admin/activity",
      }).catch(() => false);
      if (inserted) void runNotificationOutboxNow().catch(() => undefined);
    }
    res.status(201).json({ id: saved.id, emailSent });
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Owner support request could not be saved");
    res.status(503).json({ error: "Your support request could not be saved. Please try again." });
  }
});

export default router;
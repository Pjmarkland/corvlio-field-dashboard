import { getAuth } from "@clerk/express";
import { z } from "zod";
import { Router, type IRouter, type Response } from "express";
import {
  GetBusinessProfileResponse,
  UpdateBusinessProfileBody,
  UpdateBusinessProfileResponse,
  PreviewBusinessWebsiteBody,
  PreviewBusinessWebsiteResponse,
} from "@workspace/api-zod";
import { saveBusinessWithOptionalPhone } from "../lib/retellProvisioning";
import {
  findBusinessByClerkUserId,
  updateBusiness,
  updateOwnedBusiness,
  WEBSITE_ENRICHMENT_FIELDS,
  type WebsiteEnrichmentField,
} from "../lib/businessDirectory";
import { normalizeWebsiteUrl, previewBusinessWebsite, unavailableWebsitePreview, UnsafeWebsiteUrlError } from "../lib/websiteEnrichment";
import { parseBusinessHours, validTimeZone } from "../lib/businessHours";
import { businessNameValidationError } from "../lib/businessNameValidation";
import { recordOperationalFailure } from "../lib/operationalFailures";
import { runNotificationOutboxNow } from "../lib/notificationService";
import { initializeInvoices } from "../invoicing/service";
import { runInvoiceCycle } from "../invoicing/worker";

const router: IRouter = Router();

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

router.patch("/businesses/me", async (req, res): Promise<void> => {
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
const websitePreviewAttempts = new Map<string, { count: number; expiresAt: number }>();

router.post("/businesses/onboarding/website-preview", async (req, res): Promise<void> => {
  setPrivateOwnerResponseHeaders(res);
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const body = PreviewBusinessWebsiteBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter a valid public business website URL." }); return; }
  const now = Date.now();
  for (const [key, attempt] of websitePreviewAttempts) {
    if (attempt.expiresAt <= now) websitePreviewAttempts.delete(key);
  }
  const attempt = websitePreviewAttempts.get(userId) ?? { count: 0, expiresAt: now + 60_000 };
  if (activeWebsitePreviews.has(userId) || attempt.count >= 5) {
    res.status(429).json({ error: "Please wait a moment before reading the website again." });
    return;
  }
  attempt.count += 1;
  websitePreviewAttempts.set(userId, attempt);
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

const OnboardBusinessBody = z.object({
  chosenPlan: z.enum(["startup","starter","professional","managed"]),
  startupAgeMonths: z.number().int().min(0).max(17).optional(),
  businessHours: z.string().trim().max(500).refine(v => !v || parseBusinessHours(v) !== null).optional(),
  timeZone: z.string().trim().max(100).refine(v => !v || validTimeZone(v)).optional(),
  isSample: z.boolean().optional(),
  businessName: z.string().min(1),
  agentName: z.string().trim().max(40).optional(),
  businessType: z.string().optional(),
  servicesOffered: z.string().max(4000).optional(),
  businessWebsiteUrl: z.string().trim().max(2048).optional().or(z.literal("")),
  ownerEmail: z.string().email(),
  serviceArea: z.string().optional(),
  personalityToneDescription: z.string().optional(),
  servicesNotOffered: z.string().optional(),
  otherPolicies: z.string().trim().max(4000).optional(),
  majorIssueExamples: z.string().optional(),
  pricingPolicy: z.string().optional(),
  financingPolicy: z.string().optional(),
  brandsWorkedWith: z.string().optional(),
  responseTimeCommitment: z.string().optional(),
  warrantyInfo: z.string().optional(),
  maintenancePlanOfferings: z.string().optional(),
  credentials: z.string().optional(),
  ownerAvailability: z.string().optional(),
  emergencyContactInfo: z.string().optional(),
  websiteScrapePreviewed: z.boolean().optional(),
  websiteSuggestionsReviewed: z.boolean().optional(),
  websitePreviewAttempted: z.boolean().optional(),
  servicesOfferedDeferred: z.boolean().optional(),
});

router.post("/businesses/onboard", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = OnboardBusinessBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ error: body.error.flatten() }, "Invalid business onboarding payload");
    res.status(400).json({ error: "Business name and a valid owner email are required" });
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
  if (body.data.websiteScrapePreviewed && body.data.websiteSuggestionsReviewed !== true) {
    res.status(400).json({ error: "Review the website suggestions and missing fields before saving." });
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
    agreementsAcceptedAt: new Date(),
  };
  const rawWebsiteUrl = body.data.businessWebsiteUrl?.trim() || "";
  const websiteUrl = !isSample && rawWebsiteUrl.length <= 2048 ? rawWebsiteUrl || null : null;

  try {
    const existingBusiness = await findBusinessByClerkUserId(userId);
    if (existingBusiness?.chosenPlan && existingBusiness.chosenPlan !== body.data.chosenPlan) {
      res.status(409).json({error:"Your plan is already saved. Please contact support to change it."});return;
    }
    const result = await saveBusinessWithOptionalPhone({
      ...businessInfo,
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

export default router;
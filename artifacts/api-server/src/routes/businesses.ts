import { getAuth } from "@clerk/express";
import { z } from "zod";
import { Router, type IRouter, type Response } from "express";
import {
  GetBusinessProfileResponse,
  UpdateBusinessProfileBody,
  UpdateBusinessProfileResponse,
} from "@workspace/api-zod";
import { saveBusinessWithOptionalPhone } from "../lib/retellProvisioning";
import {
  claimWebsiteEnrichment,
  findBusinessByClerkUserId,
  updateBusiness,
  updateOwnedBusiness,
  WEBSITE_ENRICHMENT_FIELDS,
  type WebsiteEnrichmentField,
} from "../lib/businessDirectory";
import { enrichBusinessFromWebsite } from "../lib/websiteEnrichment";

const router: IRouter = Router();

type OwnedBusiness = NonNullable<Awaited<ReturnType<typeof findBusinessByClerkUserId>>>;
type BusinessProfileUpdate = z.infer<typeof UpdateBusinessProfileBody>;
type BusinessProfileField = keyof BusinessProfileUpdate;

const BUSINESS_PROFILE_COLUMN_BY_FIELD: Record<BusinessProfileField, string> = {
  businessName: "businessName",
  agentName: "agentName",
  businessType: "businessType",
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
    businessName: business.businessName,
    agentName: business.agentName,
    businessType: business.businessType,
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
  if (body.data.businessName !== undefined && !businessName) {
    res.status(400).json({ error: "Business name cannot be empty" });
    return;
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
      const normalizedValue = typeof value === "string" ? value.trim() : null;
      const requiredValue = profileField === "businessName" || profileField === "ownerEmail";
      Object.assign(changes, {
        [databaseField]: requiredValue ? normalizedValue : normalizedValue || null,
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

const OnboardBusinessBody = z.object({
  businessName: z.string().min(1),
  agentName: z.string().trim().max(40).optional(),
  businessType: z.string().optional(),
  businessWebsiteUrl: z.string().trim().max(2048).optional().or(z.literal("")),
  ownerEmail: z.string().email(),
  serviceArea: z.string().optional(),
  personalityToneDescription: z.string().optional(),
  servicesNotOffered: z.string().optional(),
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

  const businessInfo = {
    clerkUserId: userId,
    businessName: body.data.businessName,
    agentName: body.data.agentName?.trim() || null,
    businessType: body.data.businessType,
    ownerEmail: body.data.ownerEmail,
    serviceArea: body.data.serviceArea,
    personalityToneDescription: body.data.personalityToneDescription,
    servicesNotOffered: body.data.servicesNotOffered,
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
  const websiteUrl = rawWebsiteUrl.length <= 2048 ? rawWebsiteUrl || null : null;

  const scheduleWebsiteEnrichment = (businessId: number, url: string) => {
    void enrichBusinessFromWebsite(businessId, url)
      .catch((error: unknown) => {
        req.log.warn(
          {
            businessId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "Optional website enrichment did not complete",
        );
      });
  };

  try {
    const existingBusiness = await findBusinessByClerkUserId(userId);
    if (existingBusiness) {
      const websiteEnrichmentSources = {
        ...(existingBusiness.websiteEnrichmentSources ?? {}),
      };
      for (const field of WEBSITE_ENRICHMENT_FIELDS) {
        if (businessInfo[field] !== undefined) {
          delete websiteEnrichmentSources[field];
        }
      }

      const business = await updateBusiness(existingBusiness.id, {
        ...businessInfo,
        websiteEnrichmentSources,
      });
      if (!business) {
        throw new Error("Existing business could not be updated");
      }

      if (websiteUrl && !existingBusiness.websiteEnrichmentAttemptedAt) {
        void claimWebsiteEnrichment(existingBusiness.id, websiteUrl)
          .then((claimedBusiness) => {
            if (claimedBusiness) {
              scheduleWebsiteEnrichment(claimedBusiness.id, websiteUrl);
            }
          })
          .catch((error: unknown) => {
            req.log.warn(
              {
                businessId: existingBusiness.id,
                errorName: error instanceof Error ? error.name : "UnknownError",
              },
              "Optional website enrichment could not be scheduled",
            );
          });
      }

      res.status(200).json({
        phoneNumber: business.retellPhoneNumber,
        phoneProvisioningPending: !business.retellPhoneNumber,
      });
      return;
    }

    const result = await saveBusinessWithOptionalPhone({
      ...businessInfo,
      businessWebsiteUrl: websiteUrl,
      websiteEnrichmentAttemptedAt: websiteUrl ? new Date() : null,
    });
    if (websiteUrl) {
      scheduleWebsiteEnrichment(result.business.id, websiteUrl);
    }

    if (result.phoneProvisioningPending) {
      req.log.warn(
        {
          error: result.provisioningError instanceof Error
            ? result.provisioningError.message
            : "Unknown Retell provisioning error",
        },
        "Business saved; Retell phone provisioning is pending",
      );
    }

    res.status(201).json({
      phoneNumber: result.business.retellPhoneNumber,
      phoneProvisioningPending: result.phoneProvisioningPending,
    });
  } catch (error) {
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
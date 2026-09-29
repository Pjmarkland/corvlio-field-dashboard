import { getAuth } from "@clerk/express";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { saveBusinessWithOptionalPhone } from "../lib/retellProvisioning";
import {
  claimWebsiteEnrichment,
  findBusinessByClerkUserId,
  updateBusiness,
  WEBSITE_ENRICHMENT_FIELDS,
} from "../lib/businessDirectory";
import { enrichBusinessFromWebsite } from "../lib/websiteEnrichment";

const router: IRouter = Router();

const OnboardBusinessBody = z.object({
  businessName: z.string().min(1),
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
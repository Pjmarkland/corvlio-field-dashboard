import { getAuth } from "@clerk/express";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { provisionBusinessPhoneNumber } from "../lib/retellProvisioning";

const router: IRouter = Router();

const OnboardBusinessBody = z.object({
  businessName: z.string().min(1),
  businessType: z.string().optional(),
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

  try {
    const business = await provisionBusinessPhoneNumber({
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
    });

    res.status(201).json({ phoneNumber: business.retellPhoneNumber });
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.message : "Unknown business onboarding error" },
      "Business onboarding failed",
    );
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to provision business phone number",
    });
  }
});

export default router;
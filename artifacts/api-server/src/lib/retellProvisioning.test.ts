import { describe, expect, it, vi } from "vitest";
import type { Business as DatabaseBusiness } from "@workspace/db";
import {
  saveBusinessWithOptionalPhone,
  type BusinessProvisioningInput,
} from "./retellProvisioning";

const businessInfo: BusinessProvisioningInput = {
  clerkUserId: "user_new_signup",
  businessName: "Fallback Test Business",
  ownerEmail: "owner@example.com",
  agreementsAcceptedAt: new Date("2026-09-18T00:00:00.000Z"),
};

function savedBusiness(
  overrides: Partial<DatabaseBusiness> = {},
): DatabaseBusiness {
  return {
    id: 999,
    businessName: businessInfo.businessName,
    clerkUserId: businessInfo.clerkUserId ?? null,
    ownerEmail: businessInfo.ownerEmail ?? null,
    retellPhoneNumber: null,
    retellAgentId: null,
    serviceArea: null,
    businessType: null,
    majorIssueExamples: null,
    personalityToneDescription: null,
    servicesNotOffered: null,
    pricingPolicy: null,
    financingPolicy: null,
    brandsWorkedWith: null,
    typicalResponseTimeCommitment: null,
    warrantyInfo: null,
    maintenancePlanOfferings: null,
    credentialsCertifications: null,
    ownerAvailability: null,
    emergencyContactInfo: null,
    agreementsAcceptedAt: businessInfo.agreementsAcceptedAt ?? null,
    createdAt: new Date("2026-09-18T00:00:00.000Z"),
    updatedAt: new Date("2026-09-18T00:00:00.000Z"),
    ...overrides,
  };
}

describe("saveBusinessWithOptionalPhone", () => {
  it("saves the business with pending phone provisioning when Retell fails", async () => {
    const provision = vi.fn().mockRejectedValue(
      new Error("Retell phone number provisioning failed (400 Bad Request)"),
    );
    const create = vi.fn().mockResolvedValue(savedBusiness());

    const result = await saveBusinessWithOptionalPhone(businessInfo, {
      provision,
      create,
    });

    expect(provision).toHaveBeenCalledWith(businessInfo);
    expect(create).toHaveBeenCalledWith({
      ...businessInfo,
      retellPhoneNumber: null,
      retellAgentId: null,
    });
    expect(result.phoneProvisioningPending).toBe(true);
    expect(result.provisioningError).toBeInstanceOf(Error);
    expect(result.business.retellPhoneNumber).toBeNull();
    expect(result.business.retellAgentId).toBeNull();
  });

  it("returns the provisioned business without marking it pending", async () => {
    const provisioned = savedBusiness({
      retellPhoneNumber: "+14155550149",
      retellAgentId: "agent_shared",
    });
    const provision = vi.fn().mockResolvedValue(provisioned);
    const create = vi.fn();

    const result = await saveBusinessWithOptionalPhone(businessInfo, {
      provision,
      create,
    });

    expect(result.business).toBe(provisioned);
    expect(result.phoneProvisioningPending).toBe(false);
    expect(result.provisioningError).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
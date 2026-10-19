import { clerkClient } from "@clerk/express";
import {
  GetAdminActivityResponse,
  GetAdminBusinessResponse,
  GetAdminOverviewResponse,
} from "@workspace/api-zod";
import {
  businessesTable,
  db,
  leadsTable,
  notificationDevicesTable,
  retellCallRecordsTable,
  provisioningAttemptsTable,
  operationalFailuresTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { numberActivity } from "./numberActivity";

const ONBOARDING_FIELDS = [
  { key: "businessName", label: "Business name" },
  { key: "agentName", label: "Receptionist name" },
  { key: "serviceArea", label: "Service area" },
  { key: "businessType", label: "Business type" },
  { key: "servicesOffered", label: "Services offered" },
  { key: "majorIssueExamples", label: "Common issues" },
  { key: "personalityToneDescription", label: "Receptionist tone" },
  { key: "servicesNotOffered", label: "Services not offered" },
  { key: "pricingPolicy", label: "Pricing policy" },
  { key: "financingPolicy", label: "Financing policy" },
  { key: "brandsWorkedWith", label: "Brands worked with" },
  { key: "typicalResponseTimeCommitment", label: "Response-time commitment" },
  { key: "warrantyInfo", label: "Warranty information" },
  { key: "maintenancePlanOfferings", label: "Maintenance plans" },
  { key: "credentialsCertifications", label: "Credentials and certifications" },
  { key: "ownerAvailability", label: "Owner availability" },
  { key: "emergencyContactInfo", label: "Emergency contact" },
  { key: "businessWebsiteUrl", label: "Business website" },
] as const;

type OwnerProfile = {
  ownerName: string | null;
  ownerLastSignInAt: Date | null;
};

type AdminLead = typeof leadsTable.$inferSelect;

function ownerName(firstName: string | null, lastName: string | null): string | null {
  const fullName = [firstName, lastName].filter((part) => part?.trim()).join(" ").trim();
  return fullName || null;
}

export async function loadOwnerProfile(clerkUserId: string | null): Promise<OwnerProfile> {
  if (!clerkUserId) return { ownerName: null, ownerLastSignInAt: null };

  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    return {
      ownerName: ownerName(user.firstName, user.lastName),
      ownerLastSignInAt: user.lastSignInAt ? new Date(user.lastSignInAt) : null,
    };
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "status" in error
      && error.status === 404
    ) {
      return { ownerName: null, ownerLastSignInAt: null };
    }
    throw error;
  }
}

function getLeadCounts(leads: AdminLead[], now: number) {
  const staleCutoff = now - 24 * 60 * 60 * 1000;
  const uncontacted = leads.filter((lead) => lead.status !== "contacted");
  const stale = uncontacted.filter((lead) => lead.createdAt.getTime() <= staleCutoff);
  const responseTimes = leads
    .filter((lead) => lead.contactedAt !== null)
    .map((lead) => lead.contactedAt!.getTime() - lead.createdAt.getTime())
    .filter((duration) => Number.isFinite(duration) && duration >= 0);

  return {
    totalLeadCount: leads.length,
    uncontactedLeadCount: uncontacted.length,
    contactedLeadCount: leads.length - uncontacted.length,
    staleLeadCount: stale.length,
    oldestUncontactedAt: uncontacted.length
      ? uncontacted.reduce((oldest, lead) =>
          lead.createdAt.getTime() < oldest.getTime() ? lead.createdAt : oldest,
        uncontacted[0]!.createdAt)
      : null,
    averageResponseTimeMs: responseTimes.length
      ? Math.round(responseTimes.reduce((sum, duration) => sum + duration, 0) / responseTimes.length)
      : null,
  };
}

function summarizeBusiness(
  business: typeof businessesTable.$inferSelect,
  leads: AdminLead[],
  pushDevices: Array<{ platform: string }>,
  profile: OwnerProfile,
  now: number,
  calls: Array<typeof retellCallRecordsTable.$inferSelect> = [],
  assignedAt = business.createdAt,
) {
  const missingOnboardingFields = ONBOARDING_FIELDS
    .filter(({ key }) => {
      const value = business[key];
      return typeof value !== "string" || value.trim().length === 0;
    })
    .map(({ label }) => label);
  const completedOnboardingFieldCount = ONBOARDING_FIELDS.length - missingOnboardingFields.length;
  const leadCounts = getLeadCounts(leads, now);
  const hasPhone = Boolean(business.retellPhoneNumber?.trim());
  const hasAgent = Boolean(business.retellAgentId?.trim());
  const pushPlatforms = [...new Set(
    pushDevices
      .map(({ platform }) => platform)
      .filter((platform): platform is "ios" | "android" => platform === "ios" || platform === "android"),
  )];

  return {
    ...numberActivity(business, calls, now, assignedAt),
    id: business.id,
    businessName: business.businessName,
    ownerEmail: business.ownerEmail,
    ownerName: profile.ownerName,
    ownerLastSignInAt: profile.ownerLastSignInAt,
    retellPhoneNumber: business.retellPhoneNumber,
    provisioningStatus: hasPhone && hasAgent ? "ready" as const : hasPhone || hasAgent ? "partial" as const : "pending" as const,
    createdAt: business.createdAt,
    onboardingFieldCount: ONBOARDING_FIELDS.length,
    completedOnboardingFieldCount,
    onboardingCompletenessPercent: Math.round(completedOnboardingFieldCount / ONBOARDING_FIELDS.length * 100),
    missingOnboardingFields,
    totalLeadCount: leadCounts.totalLeadCount,
    uncontactedLeadCount: leadCounts.uncontactedLeadCount,
    contactedLeadCount: leadCounts.contactedLeadCount,
    averageResponseTimeMs: leadCounts.averageResponseTimeMs,
    pushEnabledDeviceCount: pushDevices.length,
    pushPlatforms,
    agreementsAcceptedAt: business.agreementsAcceptedAt,
    hasNoLeads: leadCounts.totalLeadCount === 0,
    hasUncontactedOver24Hours: leadCounts.staleLeadCount > 0,
    oldestUncontactedAt: leadCounts.oldestUncontactedAt,
  };
}

function toActivityLead(
  lead: AdminLead,
  business: { id: number; businessName: string },
) {
  return {
    id: lead.id,
    businessId: business.id,
    businessName: business.businessName,
    callerName: lead.callerName,
    phoneNumber: lead.phoneNumber,
    issueReason: lead.issueReason,
    address: lead.address,
    urgencyLevel: lead.urgencyLevel,
    availability: lead.availability,
    status: lead.status,
    createdAt: lead.createdAt,
    contactedAt: lead.contactedAt,
  };
}

async function loadWorkspaceData() {
  const [businesses, leads, activeDevices] = await Promise.all([
    db
      .select()
      .from(businessesTable)
      .orderBy(desc(businessesTable.createdAt), desc(businessesTable.id)),
    db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt), desc(leadsTable.id)),
    db
      .select({
        businessId: notificationDevicesTable.businessId,
        platform: notificationDevicesTable.platform,
      })
      .from(notificationDevicesTable)
      .where(and(
        eq(notificationDevicesTable.enabled, true),
        isNull(notificationDevicesTable.invalidatedAt),
      )),
  ]);

  const leadsByBusiness = new Map<number, AdminLead[]>();
  for (const lead of leads) {
    const businessLeads = leadsByBusiness.get(lead.businessId) ?? [];
    businessLeads.push(lead);
    leadsByBusiness.set(lead.businessId, businessLeads);
  }

  const devicesByBusiness = new Map<string, Array<{ platform: string }>>();
  for (const device of activeDevices) {
    const devices = devicesByBusiness.get(device.businessId) ?? [];
    devices.push({ platform: device.platform });
    devicesByBusiness.set(device.businessId, devices);
  }

  return { businesses, leads, leadsByBusiness, devicesByBusiness, activeDevices };
}

async function summarizeBusinesses(
  businesses: Awaited<ReturnType<typeof loadWorkspaceData>>["businesses"],
  leadsByBusiness: Map<number, AdminLead[]>,
  devicesByBusiness: Map<string, Array<{ platform: string }>>,
  now: number,
) {
  const [calls, attempts] = await Promise.all([
    db.select().from(retellCallRecordsTable),
    db.select().from(provisioningAttemptsTable),
  ]);
  const summaries = await Promise.all(businesses.map(async (business) => {
    const profile = await loadOwnerProfile(business.clerkUserId);
    return summarizeBusiness(
      business,
      leadsByBusiness.get(business.id) ?? [],
      devicesByBusiness.get(String(business.id)) ?? [],
      profile,
      now,
      calls.filter((call) => call.businessId === business.id),
      attempts.find((attempt) => attempt.businessId === business.id)?.purchasedAt ?? business.createdAt,
    );
  }));
  return summaries;
}

export async function getAdminOverview() {
  const data = await loadWorkspaceData();
  const businesses = await summarizeBusinesses(
    data.businesses,
    data.leadsByBusiness,
    data.devicesByBusiness,
    Date.now(),
  );
  const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const uncontacted = data.leads.filter((lead) => lead.status !== "contacted");

  return GetAdminOverviewResponse.parse({
    metrics: {
      businessCount: data.businesses.length,
      provisionedBusinessCount: businesses.filter((business) => business.provisioningStatus === "ready").length,
      totalLeadCount: data.leads.length,
      zeroLeadBusinessCount: businesses.filter((business) => business.hasNoLeads).length,
      uncontactedLeadCount: uncontacted.length,
      uncontactedOver24HoursCount: uncontacted
        .filter((lead) => lead.createdAt.getTime() <= staleCutoff).length,
      activePushDeviceCount: data.activeDevices.length,
    },
    businesses,
  });
}

export async function getAdminBusiness(businessId: number) {
  const [business] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId))
    .limit(1);
  if (!business) return undefined;

  const [leads, callRecords, pushDevices] = await Promise.all([
    db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.businessId, businessId))
      .orderBy(desc(leadsTable.createdAt), desc(leadsTable.id)),
    db
      .select()
      .from(retellCallRecordsTable)
      .where(eq(retellCallRecordsTable.businessId, businessId))
      .orderBy(
        sql`${retellCallRecordsTable.callStartedAt} DESC NULLS LAST`,
        desc(retellCallRecordsTable.recordedAt),
      ),
    db
      .select({ platform: notificationDevicesTable.platform })
      .from(notificationDevicesTable)
      .where(and(
        eq(notificationDevicesTable.businessId, String(businessId)),
        eq(notificationDevicesTable.enabled, true),
        isNull(notificationDevicesTable.invalidatedAt),
      )),
  ]);
  const profile = await loadOwnerProfile(business.clerkUserId);
  const [attempt] = await db.select().from(provisioningAttemptsTable)
    .where(eq(provisioningAttemptsTable.businessId, businessId));
  const businessSummary = summarizeBusiness(
    business,
    leads,
    pushDevices,
    profile,
    Date.now(),
    callRecords,
    attempt?.purchasedAt ?? business.createdAt,
  );

  return GetAdminBusinessResponse.parse({
    business: businessSummary,
    onboarding: {
      businessName: business.businessName,
      agentName: business.agentName,
      serviceArea: business.serviceArea,
      businessType: business.businessType,
      servicesOffered: business.servicesOffered ?? null,
      majorIssueExamples: business.majorIssueExamples,
      personalityToneDescription: business.personalityToneDescription,
      servicesNotOffered: business.servicesNotOffered,
      pricingPolicy: business.pricingPolicy,
      financingPolicy: business.financingPolicy,
      brandsWorkedWith: business.brandsWorkedWith,
      typicalResponseTimeCommitment: business.typicalResponseTimeCommitment,
      warrantyInfo: business.warrantyInfo,
      maintenancePlanOfferings: business.maintenancePlanOfferings,
      credentialsCertifications: business.credentialsCertifications,
      ownerAvailability: business.ownerAvailability,
      emergencyContactInfo: business.emergencyContactInfo,
      businessWebsiteUrl: business.businessWebsiteUrl,
      websiteEnrichmentAttemptedAt: business.websiteEnrichmentAttemptedAt,
      websiteEnrichmentSources: business.websiteEnrichmentSources ?? {},
      agreementsAcceptedAt: business.agreementsAcceptedAt,
    },
    leads: leads.map((lead) => toActivityLead(lead, business)),
    calls: callRecords,
  });
}

export async function getAdminActivity() {
  const [businesses, leadCounts, recentLeads, operationalFailures] = await Promise.all([
    db.select({ id: businessesTable.id }).from(businessesTable),
    db.select({
      status: leadsTable.status,
      createdAt: leadsTable.createdAt,
    }).from(leadsTable),
    db
      .select({
        id: leadsTable.id,
        businessId: businessesTable.id,
        businessName: businessesTable.businessName,
        callerName: leadsTable.callerName,
        phoneNumber: leadsTable.phoneNumber,
        issueReason: leadsTable.issueReason,
        address: leadsTable.address,
        urgencyLevel: leadsTable.urgencyLevel,
        availability: leadsTable.availability,
        status: leadsTable.status,
        createdAt: leadsTable.createdAt,
        contactedAt: leadsTable.contactedAt,
      })
      .from(leadsTable)
      .innerJoin(businessesTable, eq(leadsTable.businessId, businessesTable.id))
      .orderBy(desc(leadsTable.createdAt), desc(leadsTable.id))
      .limit(100),
    listRecentOperationalFailures(),
  ]);
  const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const uncontacted = leadCounts.filter((lead) => lead.status !== "contacted");

  return GetAdminActivityResponse.parse({
    businessCount: businesses.length,
    totalLeadCount: leadCounts.length,
    uncontactedLeadCount: uncontacted.length,
    uncontactedOver24HoursCount: uncontacted
      .filter((lead) => lead.createdAt.getTime() <= staleCutoff).length,
    recentLeads,
    operationalFailures,
  });
}

async function listRecentOperationalFailures() {
  const failures = await db
    .select()
    .from(operationalFailuresTable)
    .orderBy(desc(operationalFailuresTable.createdAt), desc(operationalFailuresTable.id))
    .limit(100);
  return failures.map((failure) => ({
    id: failure.id,
    source: failure.source,
    summary: failure.summary,
    details: failure.details,
    businessId: failure.businessId,
    businessName: failure.businessName,
    createdAt: failure.createdAt.toISOString(),
    alertAttempts: failure.alertAttempts,
    alertSentAt: failure.alertSentAt?.toISOString() ?? null,
    alertLastError: failure.alertLastError,
    alertBlocked: failure.alertBlocked,
  }));
}
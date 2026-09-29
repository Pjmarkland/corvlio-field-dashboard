import {
  businessesTable,
  db,
  type Business as DatabaseBusiness,
  type NewBusiness,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export const WEBSITE_ENRICHMENT_FIELDS = [
  "businessType",
  "majorIssueExamples",
  "servicesNotOffered",
  "pricingPolicy",
  "financingPolicy",
  "brandsWorkedWith",
  "typicalResponseTimeCommitment",
  "warrantyInfo",
  "maintenancePlanOfferings",
  "credentialsCertifications",
  "ownerAvailability",
  "emergencyContactInfo",
] as const;

export type WebsiteEnrichmentField = (typeof WEBSITE_ENRICHMENT_FIELDS)[number];
export type WebsiteEnrichmentValues = Partial<Record<WebsiteEnrichmentField, string>>;
export type WebsiteEnrichmentSources = Partial<Record<WebsiteEnrichmentField, string>>;

let businessesByPhone = new Map<string, DatabaseBusiness>();
let cacheRefresh: Promise<void> | null = null;
let cacheInitialized = false;

function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  return phoneNumber?.replace(/\D/g, "") ?? "";
}

export async function refreshBusinessPhoneCache(): Promise<void> {
  if (cacheRefresh) return cacheRefresh;

  cacheRefresh = db
    .select()
    .from(businessesTable)
    .then((businesses) => {
      const nextBusinessesByPhone = new Map<string, DatabaseBusiness>();
      for (const business of businesses) {
        const normalizedPhoneNumber = normalizePhoneNumber(business.retellPhoneNumber);
        if (normalizedPhoneNumber) {
          nextBusinessesByPhone.set(normalizedPhoneNumber, business);
        }
      }
      businessesByPhone = nextBusinessesByPhone;
      cacheInitialized = true;
    })
    .finally(() => {
      cacheRefresh = null;
    });

  return cacheRefresh;
}

export async function findBusinessByPhoneNumber(
  phoneNumber: string,
): Promise<DatabaseBusiness | undefined> {
  if (!cacheInitialized) await refreshBusinessPhoneCache();
  return businessesByPhone.get(normalizePhoneNumber(phoneNumber));
}

export async function findBusinessByClerkUserId(
  clerkUserId: string,
): Promise<DatabaseBusiness | undefined> {
  const matches = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.clerkUserId, clerkUserId))
    .limit(2);

  if (matches.length > 1) {
    throw new Error(`Clerk user is linked to multiple businesses: ${clerkUserId}`);
  }

  return matches[0];
}

export async function createBusiness(input: NewBusiness): Promise<DatabaseBusiness> {
  const [business] = await db.insert(businessesTable).values(input).returning();
  if (!business) throw new Error("Business creation did not return a record");
  await refreshBusinessPhoneCache();
  return business;
}

export async function updateBusiness(
  id: number,
  changes: Partial<Omit<NewBusiness, "id" | "createdAt">>,
): Promise<DatabaseBusiness | undefined> {
  const [business] = await db
    .update(businessesTable)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(businessesTable.id, id))
    .returning();

  if (business) await refreshBusinessPhoneCache();
  return business;
}

export async function claimWebsiteEnrichment(
  id: number,
  websiteUrl: string,
): Promise<DatabaseBusiness | undefined> {
  const [business] = await db
    .update(businessesTable)
    .set({
      businessWebsiteUrl: websiteUrl,
      websiteEnrichmentAttemptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(businessesTable.id, id),
      isNull(businessesTable.websiteEnrichmentAttemptedAt),
    ))
    .returning();

  return business;
}

export async function applyWebsiteEnrichment(
  id: number,
  values: WebsiteEnrichmentValues,
  sources: WebsiteEnrichmentSources,
): Promise<DatabaseBusiness | undefined> {
  const business = await db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, id))
      .for("update");

    if (!current) return undefined;

    const changes: Partial<Pick<NewBusiness, WebsiteEnrichmentField>> = {};
    const nextSources: Record<string, string> = {
      ...(current.websiteEnrichmentSources ?? {}),
    };

    for (const field of WEBSITE_ENRICHMENT_FIELDS) {
      const value = values[field]?.trim();
      const sourceUrl = sources[field]?.trim();
      const currentValue = current[field];

      if (
        !value
        || !sourceUrl
        || (currentValue !== null && currentValue.trim().length > 0)
      ) {
        continue;
      }

      changes[field] = value;
      nextSources[field] = sourceUrl;
    }

    if (Object.keys(changes).length === 0) return current;

    const [updated] = await transaction
      .update(businessesTable)
      .set({
        ...changes,
        websiteEnrichmentSources: nextSources,
        updatedAt: new Date(),
      })
      .where(eq(businessesTable.id, id))
      .returning();

    return updated;
  });

  if (business) await refreshBusinessPhoneCache();
  return business;
}
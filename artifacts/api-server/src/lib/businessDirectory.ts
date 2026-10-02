import {
  businessesTable,
  db,
  type Business as DatabaseBusiness,
  type NewBusiness,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

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

let cacheRefresh: Promise<void> | null = null;

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
          if (nextBusinessesByPhone.has(normalizedPhoneNumber)) {
            console.error("Duplicate business phone mapping", { normalizedPhoneNumber });
            throw new Error("Duplicate assigned phone number; refusing ambiguous business routing");
          }
          nextBusinessesByPhone.set(normalizedPhoneNumber, business);
        }
      }
    })
    .finally(() => {
      cacheRefresh = null;
    });

  return cacheRefresh;
}

export async function findBusinessByPhoneNumber(
  phoneNumber: string,
): Promise<DatabaseBusiness | undefined> {
  // Read fresh on every call: edits are visible across all server instances.
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return undefined;
  const matches = await db.select().from(businessesTable)
    .where(sql`regexp_replace(${businessesTable.retellPhoneNumber}, '[^0-9]', '', 'g') = ${normalized}`)
    .limit(2);
  if (matches.length > 1) {
    console.error("Duplicate business phone mapping", { normalizedPhoneNumber: normalized });
    throw new Error("Duplicate assigned phone number; refusing ambiguous business routing");
  }
  return matches[0];
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

  return business;
}

export async function updateOwnedBusiness(
  id: number,
  clerkUserId: string,
  changes: Partial<Omit<NewBusiness, "id" | "createdAt">>,
): Promise<DatabaseBusiness | undefined> {
  const [business] = await db
    .update(businessesTable)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(
      eq(businessesTable.id, id),
      eq(businessesTable.clerkUserId, clerkUserId),
    ))
    .returning();

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
      eq(businessesTable.isSample, false),
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
    if (current.isSample) return current;

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

  return business;
}

export async function findBusinessById(id: number) {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, id)).limit(1);
  return business;
}
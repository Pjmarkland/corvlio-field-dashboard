import {
  businessesTable,
  db,
  type Business as DatabaseBusiness,
  type NewBusiness,
} from "@workspace/db";
import { eq } from "drizzle-orm";

let businessesByPhone = new Map<string, DatabaseBusiness>();
let cacheRefresh: Promise<void> | null = null;
let cacheInitialized = false;

function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
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
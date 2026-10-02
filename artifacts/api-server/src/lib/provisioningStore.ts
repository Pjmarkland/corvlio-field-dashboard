import { db, advisoryLockPool, businessesTable, provisioningAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { createBusiness, findBusinessByClerkUserId, updateBusiness, WEBSITE_ENRICHMENT_FIELDS } from "./businessDirectory";
import type { ProvisioningStore } from "./provisioningPolicy";

export const provisioningStore: ProvisioningStore = {
  async lock(account, work) {
    const client = await advisoryLockPool.connect();
    let locked = false;
    try {
      await client.query("SELECT pg_advisory_lock(542310, hashtext($1))", [account]);
      locked = true;
      return await work();
    } finally {
      let broken = !locked;
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(542310, hashtext($1))", [account]); }
        catch { broken = true; }
      }
      client.release(broken);
    }
  },
  find: findBusinessByClerkUserId,
  create: createBusiness,
  async update(business, input) {
    const sources = { ...business.websiteEnrichmentSources };
    for (const field of WEBSITE_ENRICHMENT_FIELDS) {
      if (input[field] !== undefined) delete sources[field];
    }
    const isSample = business.isSample || Boolean(input.isSample);
    const updated = await updateBusiness(business.id, {
      ...input,
      isSample,
      websiteEnrichmentSources: sources,
      websiteEnrichmentAttemptedAt: business.websiteEnrichmentAttemptedAt,
      ...(isSample ? { businessWebsiteUrl: null, provisioningState: "sample" } : {}),
    });
    if (!updated) throw new Error("Business setup could not be updated");
    return updated;
  },
  async attempt(account) {
    const [attempt] = await db.select().from(provisioningAttemptsTable)
      .where(eq(provisioningAttemptsTable.clerkUserId, account));
    return attempt;
  },
  async reserve(account, businessId, daily, total) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(542311, 0)`);
      // Outstanding/uncertain purchases count against both caps, including orphan recovery.
      const counts = await tx.execute<{ total: string; today: string }>(sql`
        SELECT count(*)::text AS total,
          count(*) FILTER (WHERE booked_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text AS today
        FROM (
          SELECT reserved_at AS booked_at FROM provisioning_attempts
          UNION ALL
          SELECT created_at AS booked_at FROM businesses
          WHERE retell_phone_number IS NOT NULL AND retell_phone_number <> ''
            AND id NOT IN (SELECT business_id FROM provisioning_attempts WHERE business_id IS NOT NULL)
        ) inventory`);
      const count = counts.rows[0]!;
      if (Number(count.total) >= total || Number(count.today) >= daily) return false;
      const inserted = await tx.insert(provisioningAttemptsTable)
        .values({ clerkUserId: account, businessId }).onConflictDoNothing().returning();
      return inserted.length === 1;
    });
  },
  async state(businessId, provisioningState) {
    await db.update(businessesTable).set({ provisioningState }).where(eq(businessesTable.id, businessId));
  },
  async purchased(account, purchase) {
    await db.update(provisioningAttemptsTable).set({
      purchasedNumber: purchase.phoneNumber, purchasedAt: new Date(), status: "purchased",
    }).where(eq(provisioningAttemptsTable.clerkUserId, account));
  },
  async attach(businessId, account, phoneNumber) {
    const business = await updateBusiness(businessId, {
      retellPhoneNumber: phoneNumber,
      retellAgentId: process.env.RETELL_SHARED_AGENT_ID,
      provisioningState: "ready",
    });
    if (!business) throw new Error("Purchased number could not be attached to its business");
    await db.update(provisioningAttemptsTable).set({ status: "assigned", businessId })
      .where(eq(provisioningAttemptsTable.clerkUserId, account));
    return business;
  },
  async failure(account, businessId, failureReason, purchase) {
    await db.update(provisioningAttemptsTable).set({
      status: purchase ? "purchased" : "uncertain", failureReason,
      ...(purchase ? { purchasedNumber: purchase.phoneNumber, purchasedAt: new Date() } : {}),
    }).where(eq(provisioningAttemptsTable.clerkUserId, account));
    await db.update(businessesTable).set({ provisioningState: purchase ? "recovery" : "uncertain" })
      .where(eq(businessesTable.id, businessId));
  },
};
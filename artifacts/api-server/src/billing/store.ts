import { db, businessesTable, billingAccountsTable, billingEventsTable, billingNoticesTable } from "@workspace/db";
import { and, eq, or, desc, sql } from "drizzle-orm";
import { BillingError, initialBillingState, type BillingState } from "./policy";

export type BillingBusiness = { id: number; businessName: string; ownerEmail: string | null; clerkUserId: string | null };
export type BillingNotice = { key: string; audience: "owner" | "admin"; title: string; body: string };
export interface BillingTransaction {
  state: BillingState;
  claimEvent(id: string, type: string, detail: string, at: Date, actor?: string): Promise<boolean>;
  notice(input: BillingNotice): Promise<void>;
  countCalls(start: string, end: string): Promise<number>;
  prepareStripeBilling(planId: string): Promise<void>;
  markStripeFirstInvoicePaid(planId: string, paidAt: Date): Promise<boolean>;
}
export interface BillingStore {
  transact<T>(businessId: number, work: (tx: BillingTransaction) => Promise<T>): Promise<T>;
  findByStripe(customerId: string, subscriptionId?: string): Promise<number | null>;
  hasEvent(id: string): Promise<boolean>;
  business(id: number): Promise<BillingBusiness | null>;
  businesses(): Promise<BillingBusiness[]>;
  timeline(id: number): Promise<Array<{ id: string; type: string; actor: string | null; detail: string; createdAt: string }>>;
}
export const billingStore: BillingStore = {
  async hasEvent(id) { return !!(await db.select().from(billingEventsTable).where(eq(billingEventsTable.id, id)).limit(1))[0]; },
  async findByStripe(customerId, subscriptionId) {
    const rows = await db.select().from(billingAccountsTable).where(or(
      eq(billingAccountsTable.customerId, customerId),
      ...(subscriptionId ? [eq(billingAccountsTable.subscriptionId, subscriptionId)] : []),
    )).limit(2);
    if (new Set(rows.map(r => r.businessId)).size > 1) throw new Error("Conflicting Stripe tenancy");
    return rows[0]?.businessId ?? null;
  },
  async business(id) { return (await db.select().from(businessesTable)
    .where(and(eq(businessesTable.id, id), eq(businessesTable.isInternal, false), eq(businessesTable.isSample, false))).limit(1))[0] ?? null; },
  async businesses() { return db.select().from(businessesTable)
    .where(and(eq(businessesTable.isInternal, false), eq(businessesTable.isSample, false))); },
  async timeline(id) {
    return (await db.select().from(billingEventsTable).where(eq(billingEventsTable.businessId, id))
      .orderBy(desc(billingEventsTable.createdAt)).limit(50)).map(e => ({ ...e, createdAt: e.createdAt.toISOString() }));
  },
  async transact(businessId, work) {
    const business = await this.business(businessId);
    if (!business) throw new BillingError("Business is unavailable for billing.",404);
    return db.transaction(async tx => {
      // Serializes state, webhook replay claims, threshold flags and action notices.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(62741, ${businessId})`);
      await tx.insert(billingAccountsTable).values({ businessId, state: { ...initialBillingState() } })
        .onConflictDoNothing();
      const row = (await tx.select().from(billingAccountsTable).where(eq(billingAccountsTable.businessId, businessId)))[0]!;
      const state = { ...initialBillingState(), ...row.state } as BillingState;
      const result = await work({
        state,
        async claimEvent(id, type, detail, at, actor) {
          return !!(await tx.insert(billingEventsTable).values({ id, businessId, type, detail, actor, createdAt: at })
            .onConflictDoNothing().returning({ id: billingEventsTable.id }))[0];
        },
        async notice(notice) {
          await tx.insert(billingNoticesTable).values({
            id: `${businessId}:${notice.key}:${notice.audience}`, businessId, audience: notice.audience,
            title: notice.title, body: notice.body, delivery: { email: false, push: false }, nextAttemptAt: new Date(),
          }).onConflictDoNothing();
        },
        async prepareStripeBilling(planId) {
          const locked = await tx.execute(sql`
            SELECT billing_mode, is_internal, is_sample
            FROM businesses WHERE id = ${businessId} FOR UPDATE
          `);
          const current = locked.rows[0] as {
            billing_mode: string; is_internal: boolean; is_sample: boolean;
          } | undefined;
          if (!current || current.is_internal || current.is_sample)
            throw new BillingError("This business is unavailable for Stripe billing.", 404);
          if (current.billing_mode === "square")
            throw new BillingError("This business is assigned to another billing provider.");
          if (current.billing_mode === "manual")
            throw new BillingError("This business is assigned to emailed invoices; automatic conversion to Stripe is disabled.");
          if (current.billing_mode !== "stripe") {
            throw new BillingError("This business has an unsupported billing mode.");
          }
          await tx.update(businessesTable).set({ chosenPlan: planId })
            .where(eq(businessesTable.id, businessId));
        },
        async markStripeFirstInvoicePaid(planId, paidAt) {
          const locked = await tx.execute(sql`
            SELECT billing_mode, first_invoice_paid_at, is_internal, is_sample
            FROM businesses WHERE id = ${businessId} FOR UPDATE
          `);
          const current = locked.rows[0] as {
            billing_mode: string; first_invoice_paid_at: Date | null; is_internal: boolean; is_sample: boolean;
          } | undefined;
          if (!current || current.is_internal || current.is_sample || current.billing_mode !== "stripe")
            throw new BillingError("The paid Stripe subscription is not assigned to this business.", 409);
          if (current.first_invoice_paid_at) return false;
          await tx.update(businessesTable).set({
            firstInvoicePaidAt: paidAt,
            chosenPlan: planId,
          }).where(eq(businessesTable.id, businessId));
          return true;
        },
        async countCalls(start, end) {
          const result = await tx.execute(sql`
            SELECT count(DISTINCT l.retell_call_id)::int AS count
            FROM leads l LEFT JOIN retell_call_records r ON r.retell_call_id = l.retell_call_id AND r.business_id = l.business_id
            WHERE l.business_id = ${businessId} AND nullif(trim(l.retell_call_id), '') IS NOT NULL
            AND coalesce(r.call_started_at, l.created_at) >= ${start}::timestamptz
            AND coalesce(r.call_started_at, l.created_at) < ${end}::timestamptz
            AND (r.id IS NULL OR r.analysis_complete OR r.duration_ms > 0)
            AND (nullif(trim(l.transcript), '') IS NOT NULL OR nullif(trim(l.summary), '') IS NOT NULL
                 OR nullif(trim(l.issue_reason), '') IS NOT NULL)`);
          return Number(result.rows[0]?.count ?? 0);
        },
      });
      await tx.update(billingAccountsTable).set({
        state: { ...state }, customerId: state.customerId, subscriptionId: state.subscriptionId,
      }).where(eq(billingAccountsTable.businessId, businessId));
      return result;
    });
  },
};

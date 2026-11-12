import { makeDemoLeads, SEED_MARKER, TARGET_EMAIL } from "./appReviewOwnerDemoData.mjs";

export interface ReviewSeedClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}

interface ReviewUser {
  id: string;
  emailAddresses: {
    emailAddress: string;
    verification: { status: string } | null;
  }[];
}

interface Dependencies {
  getUser(id: string): Promise<ReviewUser>;
  connect(): Promise<ReviewSeedClient>;
  log(outcome: "inserted" | "failed"): void;
  now?: () => Date;
  identityTimeoutMs?: number;
}

export interface ReviewSeedBusiness {
  id: number;
  clerkUserId: string | null;
  isInternal: boolean;
}

async function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Review identity lookup timed out")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort, insert-only request hook. It never changes the ordinary leads response.
export function createAppReviewOwnerDemoSeed(deps: Dependencies) {
  const nonReviewUsers = new Map<string, number>();
  const logged = new Set<"inserted" | "failed">();
  const logOnce = (outcome: "inserted" | "failed") => {
    if (logged.has(outcome)) return;
    logged.add(outcome);
    try { deps.log(outcome); } catch { /* Logging cannot break the owner response. */ }
  };

  return async function maybeSeed(
    userId: string,
    business: ReviewSeedBusiness | null | undefined,
  ): Promise<"inserted" | "skipped" | "failed"> {
    let client: ReviewSeedClient | undefined;
    let inTransaction = false;
    let discardClient = false;
    try {
      if (!userId || !business || business.isInternal !== false
        || business.clerkUserId !== userId || !Number.isSafeInteger(business.id) || business.id <= 0) {
        return "skipped";
      }
      const now = deps.now?.() ?? new Date();
      if ((nonReviewUsers.get(userId) ?? 0) > now.getTime()) return "skipped";
      const user = await withTimeout(deps.getUser(userId), deps.identityTimeoutMs ?? 2_000);
      const matches = user.id === userId && user.emailAddresses.some((email) =>
        email.emailAddress.trim().toLowerCase() === TARGET_EMAIL
        && email.verification?.status === "verified");
      if (!matches) {
        // Avoid a Clerk API call on every dashboard refresh for ordinary accounts.
        if (nonReviewUsers.size >= 1_000) nonReviewUsers.delete(nonReviewUsers.keys().next().value!);
        nonReviewUsers.set(userId, now.getTime() + 60_000);
        return "skipped";
      }

      client = await deps.connect();
      // READ COMMITTED sees any real lead committed while the business lock was awaited.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      inTransaction = true;
      await client.query("SET LOCAL lock_timeout = '1500ms'");
      await client.query("SET LOCAL statement_timeout = '2500ms'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [SEED_MARKER]);
      const owned = await client.query(
        `SELECT id, clerk_user_id, is_internal FROM businesses
         WHERE clerk_user_id = $1 FOR UPDATE`,
        [userId],
      );
      const current = owned.rows[0];
      if (owned.rows.length !== 1 || Number(current?.id) !== business.id
        || current?.clerk_user_id !== userId || current?.is_internal !== false) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return "skipped";
      }
      // This also skips partial/complete tagged seeds. Never fill or modify nonempty businesses.
      // The business FOR UPDATE lock blocks concurrent FK-backed lead inserts until commit.
      const existing = await client.query("SELECT id FROM leads WHERE business_id = $1 LIMIT 1", [business.id]);
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return "skipped";
      }
      const leads = makeDemoLeads(now);
      const collisions = await client.query(
        "SELECT id FROM leads WHERE retell_call_id = ANY($1::text[]) LIMIT 1",
        [leads.map((lead) => lead.retellCallId)],
      );
      if (collisions.rows.length > 0) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return "skipped";
      }

      const values: unknown[] = [];
      const tuples = leads.map((lead) => {
        const row = [
          business.id, lead.callerName, lead.retellCallId, lead.phoneNumber,
          lead.callerId, lead.callbackNumber, lead.issueReason, lead.address,
          lead.urgencyLevel, lead.availability, lead.status, lead.contactedAt,
          lead.contactedBy, lead.summary, lead.createdAt,
        ];
        const offset = values.length;
        values.push(...row);
        return `(${row.map((_, index) => `$${offset + index + 1}`).join(", ")})`;
      });
      const inserted = await client.query(
        `INSERT INTO leads
          (business_id, caller_name, retell_call_id, phone_number, caller_id,
           callback_number, issue_reason, address, urgency_level, availability,
           status, contacted_at, contacted_by, summary, created_at)
         VALUES ${tuples.join(", ")} RETURNING id`,
        values,
      );
      if (inserted.rows.length !== leads.length) throw new Error("Incomplete review seed insert");
      await client.query("COMMIT");
      inTransaction = false;
      logOnce("inserted");
      return "inserted";
    } catch {
      if (client && inTransaction) {
        try { await client.query("ROLLBACK"); } catch { discardClient = true; }
      }
      logOnce("failed");
      return "failed";
    } finally {
      try { client?.release(discardClient); } catch { /* The normal owner response must continue. */ }
    }
  };
}

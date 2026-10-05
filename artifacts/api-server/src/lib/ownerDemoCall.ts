import { randomUUID } from "node:crypto";
import { businessesTable, db, ownerDemoCallsTable, type Business } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { dynamicVariables } from "./retellVariables";
import { collectRetellListItems } from "./retellListPagination.mjs";

export class DemoCallError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateDemoConfirmation(business: Business, number: string, confirmed: boolean) {
  if (business.isSample || !business.retellPhoneNumber) {
    throw new DemoCallError(400, "Your business doesn't have a live receptionist number yet. No number will be purchased.");
  }
  if (!business.ownerPhone || !/^\+[1-9]\d{7,14}$/.test(business.ownerPhone)) {
    throw new DemoCallError(400, "Save your own phone number with its country code in Settings first.");
  }
  if (!confirmed || number !== business.ownerPhone) {
    throw new DemoCallError(400, "Confirm your saved owner number before requesting a test call.");
  }
  if (business.retellPhoneNumber === business.ownerPhone) {
    throw new DemoCallError(400, "Your owner number must be different from the receptionist number.");
  }
}

async function retell<T>(path: string, body?: unknown): Promise<T> {
  if (!process.env.RETELL_API_KEY) throw new DemoCallError(502, "Retell isn't configured. No call was placed.");
  const response = await fetch(`https://api.retellai.com${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new DemoCallError(502, `Retell could not accept this request (${response.status}). No numbers or services were purchased. Don't retry immediately if your phone is ringing.`);
  return await response.json() as T;
}

export async function placeOwnerDemoCall(business: Business, number: string, confirmed: boolean, scenario: "current" | "after_hours" = "current") {
  validateDemoConfirmation(business, number, confirmed);
  const agentId = business.retellAgentId || process.env.RETELL_SHARED_AGENT_ID;
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (process.env.NODE_ENV === "production" || !devDomain || !agentId) {
    throw new DemoCallError(404, "Test calling is available in the development app only.");
  }
  // Read-only provider checks. No outbound-agent assignment or number mutation.
  const phone = await retell<{ phone_number_type: string }>(`/get-phone-number/${encodeURIComponent(business.retellPhoneNumber!)}`);
  if (!["retell-twilio", "retell-telnyx"].includes(phone.phone_number_type)) {
    throw new DemoCallError(400, "This existing number isn't a Retell-managed outbound number. No replacement will be purchased. You can review the greeting and hours below.");
  }
  type Version = { version: number; is_published: boolean };
  const versions = await collectRetellListItems<Version>((paginationKey) => {
    const query = paginationKey === undefined ? "" : `?${new URLSearchParams({ pagination_key: paginationKey })}`;
    return retell<unknown>(`/list-agent-versions/${encodeURIComponent(agentId)}${query}`);
  }, { allowLegacyArray: true });
  const version = versions.filter((v: { is_published: boolean }) => v.is_published === false)
    .sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]?.version;
  if (!Number.isSafeInteger(version)) throw new DemoCallError(400, "There is no unpublished receptionist draft available to test.");
  const agent = await retell<{ is_published: boolean; response_engine: { type: string; llm_id: string; version?: number } }>(`/get-agent/${encodeURIComponent(agentId)}?version=${version}`);
  if (agent.is_published !== false || agent.response_engine?.type !== "retell-llm") {
    throw new DemoCallError(400, "The selected draft isn't safe to test.");
  }
  const llm = await retell<{ is_published: boolean }>(`/get-retell-llm/${encodeURIComponent(agent.response_engine.llm_id)}?version=${agent.response_engine.version ?? version}`);
  if (llm.is_published !== false) throw new DemoCallError(400, "The draft references a published language model; test calling is disabled.");
  const attemptId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(542315, ${business.id})`);
    const [current] = await tx.select().from(businessesTable).where(and(
      eq(businessesTable.id, business.id), eq(businessesTable.clerkUserId, business.clerkUserId!),
    )).for("update");
    if (!current || current.ownerPhone !== number || current.retellPhoneNumber !== business.retellPhoneNumber) {
      throw new DemoCallError(400, "Your saved number changed. Reload and confirm it again.");
    }
    validateDemoConfirmation(current, number, confirmed);
    const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(ownerDemoCallsTable).where(and(
      eq(ownerDemoCallsTable.businessId, business.id),
      sql`(${ownerDemoCallsTable.createdAt} AT TIME ZONE ${current.timeZone})::date = (now() AT TIME ZONE ${current.timeZone})::date`,
    ));
    if (used >= 3) throw new DemoCallError(429, "You've used today's 3 test-call attempts. Try again tomorrow in your business's time zone.");
    await tx.insert(ownerDemoCallsTable).values({ id: attemptId, businessId: business.id, confirmedNumber: number });
  });
  try {
    const call = await retell<{ call_id: string }>("/v2/create-phone-call", {
      from_number: business.retellPhoneNumber, to_number: number,
      override_agent_id: agentId, override_agent_version: version,
      agent_override: { agent: {
        webhook_url: `https://${devDomain}/api/webhooks/retell/post-call`,
        webhook_events: ["call_ended", "call_analyzed"], max_call_duration_ms: 300_000,
      } },
      metadata: { corvlio_call_type: "owner_test", demo_attempt_id: attemptId, scenario },
      retell_llm_dynamic_variables: {
        ...dynamicVariables(business),
        ...(scenario === "after_hours" ? {
          business_is_open: "false", next_opening: "", current_local_time: "After-hours TEST simulation",
        } : {}),
      },
    });
    if (!call.call_id) throw new Error("Missing call ID");
    await db.update(ownerDemoCallsTable).set({ callId: call.call_id, status: "requested" })
      .where(eq(ownerDemoCallsTable.id, attemptId));
    return { callId: String(call.call_id), message: "Your receptionist is calling your confirmed number. This TEST call creates no lead or alerts." };
  } catch (error) {
    // Count failed/uncertain attempts as well: automatic retries can double-call.
    await db.update(ownerDemoCallsTable).set({ status: "failed_or_uncertain" }).where(eq(ownerDemoCallsTable.id, attemptId));
    if (error instanceof DemoCallError) throw error;
    throw new DemoCallError(502, "We couldn't confirm the test call. If your phone rings, answer it; don't retry immediately. This attempt counts toward today's limit.");
  }
}
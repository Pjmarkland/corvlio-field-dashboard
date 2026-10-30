import { businessesTable, db, leadsTable, retellCallRecordsTable, type RetellCallRecord } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { GetAdminCallQualityResponse } from "@workspace/api-zod";

export function scoreCall(record: RetellCallRecord, businessName: string, leadCreated: boolean) {
  const fields = [
    ["Name", record.nameCaptured], ["Callback number", record.callbackCaptured],
    ["Issue", record.issueCaptured], ["Address", record.addressCaptured],
  ] as const;
  const coreComplete = fields.slice(0, 3).every(([, value]) => value === true);
  const reason = record.outcome?.toLowerCase();
  const ending = reason === "agent_hangup" ? "Clean end"
    : reason === "user_hangup" ? coreComplete ? "Caller ended after core intake" : record.analysisComplete ? "Caller hung up before core intake was complete" : "Caller ended — intake not yet verified"
    : reason === "successful" ? "Successful — disconnect reason unavailable"
    : !reason ? "Unknown" : `Interrupted / other: ${record.outcome}`;
  const reviewReasons: string[] = [];
  for (const [label, value] of fields) {
    if (value === false) reviewReasons.push(`${label} not captured`);
    if (value == null) reviewReasons.push(`${label} capture unknown`);
  }
  if (!record.analysisComplete) reviewReasons.push("Awaiting analysis / historical call");
  if (!leadCreated) reviewReasons.push("No linked lead");
  if (reason === "user_hangup" && !coreComplete && record.analysisComplete) reviewReasons.push("Caller ended with incomplete core intake");
  if (!["agent_hangup", "user_hangup", "successful"].includes(reason || "")) reviewReasons.push(reason ? `Disconnect: ${record.outcome}` : "Ending unknown");
  if (record.durationMs == null) reviewReasons.push("Call length unknown");
  return {
    id: record.retellCallId, businessName, startedAt: (record.callStartedAt || record.recordedAt).toISOString(),
    durationMs: record.durationMs, nameCaptured: record.nameCaptured, callbackCaptured: record.callbackCaptured,
    issueCaptured: record.issueCaptured, addressCaptured: record.addressCaptured, analysisComplete: record.analysisComplete,
    ending, leadCreated, needsReview: reviewReasons.length > 0, reviewReasons,
  };
}

export async function getAdminCallQuality() {
  const rows = await db.select({ record: retellCallRecordsTable, businessName: businessesTable.businessName, leadId: leadsTable.id })
    .from(retellCallRecordsTable)
    .innerJoin(businessesTable, eq(businessesTable.id, retellCallRecordsTable.businessId))
    .leftJoin(leadsTable, eq(leadsTable.id, retellCallRecordsTable.leadId))
    .orderBy(desc(sql`COALESCE(${retellCallRecordsTable.callStartedAt}, ${retellCallRecordsTable.recordedAt})`)).limit(100);
  const calls = rows.map(row => scoreCall(row.record, row.businessName, row.leadId != null));
  const completeCalls = calls.filter(call => call.nameCaptured && call.callbackCaptured && call.issueCaptured && call.addressCaptured).length;
  return GetAdminCallQualityResponse.parse({
    totalCalls: calls.length, completeCalls,
    completePercent: calls.length ? Math.round(completeCalls * 1000 / calls.length) / 10 : null, calls,
  });
}
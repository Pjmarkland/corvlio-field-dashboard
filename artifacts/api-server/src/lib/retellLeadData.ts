import type { RetellCall } from "@workspace/api-zod";
const key = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");
function text(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return !result || /^(unknown|n\/a|none|null|not (provided|captured|available))$/i.test(result) ? null : result;
}
export function analysisValue(analysis: Record<string, unknown> | null | undefined, ...aliases: string[]) {
  if (!analysis) return null;
  for (const alias of aliases) {
    for (const [name, value] of Object.entries(analysis)) {
      if (key(name) === key(alias)) {
        const result = text(value);
        if (result) return result;
      }
    }
  }
  return null;
}
export function extractRetellLead(call: RetellCall) {
  const data = call.call_analysis?.custom_analysis_data;
  const callerId = text(call.from_number);
  let callbackNumber = analysisValue(data, "callback_number", "phone_number", "caller_phone_number", "User_phone");
  if (callbackNumber && /^(same|this|the) (number|phone)|calling from|caller.?id/i.test(callbackNumber)) {
    callbackNumber = callerId;
  }
  const transcript = text(call.transcript)
    ?? text(call.transcript_object?.map(turn => `${turn.role}: ${turn.content}`).join("\n"));
  const userContent = call.transcript_object?.filter(turn => turn.role.toLowerCase() === "user")
    .map(turn => turn.content.trim()).filter(Boolean).join(" ");
  const summary = text(call.call_analysis?.call_summary)
    ?? analysisValue(data, "call_summary", "summary")
    ?? (transcript ? `Partial call — ${userContent || transcript}`.slice(0, 1000) : null);
  return {
    callerName: analysisValue(data, "caller_name", "customer_name", "name", "User name"),
    callerId, callbackNumber, phoneNumber: callbackNumber ?? callerId,
    issueReason: analysisValue(data, "issue_reason", "issue", "reason", "call_reason") ?? summary,
    address: analysisValue(data, "address", "service_address"),
    urgencyLevel: analysisValue(data, "urgency_level", "urgency"),
    availability: analysisValue(data, "availability", "preferred_availability", "preferred_time"),
    transcript, summary,
  };
}
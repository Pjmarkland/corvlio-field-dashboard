import type { RetellCall } from "@workspace/api-zod";
const key = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");
function text(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return !result || /^(unknown|n\/a|none|null|declined|refused|not (provided|captured|available|given|shared))$/i.test(result) ? null : result;
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
    issueReason: analysisValue(data, "issue_reason", "issue", "reason", "call_reason", "reason_for_call") ?? summary,
    address: analysisValue(data, "address", "service_address"),
    urgencyLevel: analysisValue(data, "urgency_level", "urgency"),
    availability: analysisValue(data, "availability", "preferred_availability", "preferred_time"),
    tradeIntakeAnswers: analysisValue(data, "trade_intake_answers", "trade_questions", "intake_answers")
      ?.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 2).join("\n").slice(0, 2000) || null,
    transcript, summary,
    sentiment: text(call.call_analysis?.user_sentiment) ?? analysisValue(data, "user_sentiment"),
    recordingUrl: safeRecordingUrl(call.recording_url),
  };
}

function safeRecordingUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function capturedInfo(call: RetellCall, analysisComplete: boolean) {
  const data = call.call_analysis?.custom_analysis_data;
  // A transcript summary and automatic caller ID are not proof of captured fields.
  if (!data && !analysisComplete) return {
    nameCaptured: null, callbackCaptured: null, issueCaptured: null, addressCaptured: null,
  };
  const lead = extractRetellLead(call);
  const explicitCallback = analysisValue(data, "callback_number");
  const legacyPhone = analysisValue(data, "phone_number", "caller_phone_number", "User_phone");
  return {
    nameCaptured: !!lead.callerName,
    // Legacy "phone" fields may simply repeat caller ID; keep their capture unknown.
    callbackCaptured: explicitCallback
      ? !!lead.callbackNumber && lead.callbackNumber.replace(/\D/g, "").length >= 7
      : legacyPhone ? null : false,
    issueCaptured: !!analysisValue(data, "issue_reason", "issue", "reason", "call_reason", "reason_for_call"),
    addressCaptured: !!lead.address,
  };
}
import type { Business } from "@workspace/db";
import { businessClock } from "./businessHours";
import { intakeTrade, toneGuidance, toneStyle, tradeQuestions } from "./receptionistStyle";

const NO_PROMISES = "Not provided. Do not make any promises about this; say the owner will cover it when they call back.";
const PASS_TO_OWNER = "Not provided. Do not claim or deny anything about this; offer to pass the question to the owner.";
const NOTIFY_OWNER = "Not provided. Take the caller's details and tell them the owner will be notified.";

export function dynamicVariables(business: Business | null) {
  // Preserve saved text verbatim and keep the no-business generic case unchanged.
  const detail = (value: string | null | undefined, fallback: string) =>
    business ? (value?.trim() ? value : fallback) : "";
  const savedName = business?.agentName?.trim();
  const agentName = savedName && !/^(agent_name|\{\{.*\}\})$/i.test(savedName) ? savedName : null;
  const hours = business?.businessHours ?? "";
  const timeZone = business?.timeZone ?? "";
  const style = toneStyle(business?.personalityToneDescription);
  const trade = intakeTrade(business?.businessType);
  return {
    receptionist_tone_style: style, receptionist_tone_guidance: toneGuidance[style],
    intake_trade: trade, trade_question_1: tradeQuestions[trade][0], trade_question_2: tradeQuestions[trade][1],
    business_hours: business ? hours : "", time_zone: business ? timeZone : "",
    ...(business && hours.trim() && timeZone.trim() ? businessClock(hours, timeZone) : { current_local_time: "", business_is_open: "unknown", next_opening: "" }),
    transfer_available: "false", agent_name: agentName || "Aria",
    business_name: business?.businessName ?? "our team", business_type: business?.businessType ?? "",
    service_area: detail(business?.serviceArea, "Not provided. Do not guess whether an address is covered; take the caller's location and ask the owner to confirm."),
    services_offered: detail(business?.servicesOffered, PASS_TO_OWNER),
    major_issue_examples: detail(business?.majorIssueExamples, "Not provided. Do not guess which issues the business handles; record the caller's issue and pass it to the owner."),
    pricing_policy: detail(business?.pricingPolicy, "Not provided. Do not quote or estimate prices; say the owner will follow up with a quote."),
    personality_tone_description: business?.personalityToneDescription ?? "Friendly and professional",
    services_not_offered: detail(business?.servicesNotOffered, PASS_TO_OWNER),
    financing_policy: detail(business?.financingPolicy, NO_PROMISES),
    brands_worked_with: detail(business?.brandsWorkedWith, PASS_TO_OWNER),
    response_time_commitment: detail(business?.typicalResponseTimeCommitment, "Not provided. Say the owner will call back as soon as they can, without promising a specific time."),
    warranty_info: detail(business?.warrantyInfo, NO_PROMISES),
    maintenance_plan_offerings: detail(business?.maintenancePlanOfferings, PASS_TO_OWNER),
    credentials: detail(business?.credentialsCertifications, PASS_TO_OWNER),
    owner_availability: detail(business?.ownerAvailability, NOTIFY_OWNER),
    emergency_contact_info: detail(business?.emergencyContactInfo, NOTIFY_OWNER),
  };
}
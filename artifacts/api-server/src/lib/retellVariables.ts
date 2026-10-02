import type { Business } from "@workspace/db";
import { businessClock, DEFAULT_BUSINESS_HOURS, DEFAULT_TIME_ZONE } from "./businessHours";
import { intakeTrade, toneGuidance, toneStyle, tradeQuestions } from "./receptionistStyle";

export function dynamicVariables(business: Business | null) {
  const savedName = business?.agentName?.trim();
  const agentName = savedName && !/^(agent_name|\{\{.*\}\})$/i.test(savedName) ? savedName : null;
  const hours = business?.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const timeZone = business?.timeZone ?? DEFAULT_TIME_ZONE;
  const style = toneStyle(business?.personalityToneDescription);
  const trade = intakeTrade(business?.businessType);
  return {
    receptionist_tone_style: style, receptionist_tone_guidance: toneGuidance[style],
    intake_trade: trade, trade_question_1: tradeQuestions[trade][0], trade_question_2: tradeQuestions[trade][1],
    business_hours: business ? hours : "", time_zone: business ? timeZone : "",
    ...(business ? businessClock(hours, timeZone) : { current_local_time: "", business_is_open: "unknown", next_opening: "" }),
    transfer_available: "false", agent_name: agentName || "Aria",
    business_name: business?.businessName ?? "", business_type: business?.businessType ?? "",
    service_area: business?.serviceArea ?? "", major_issue_examples: business?.majorIssueExamples ?? "",
    pricing_policy: business?.pricingPolicy ?? "", personality_tone_description: business?.personalityToneDescription ?? "Friendly and professional",
    services_not_offered: business?.servicesNotOffered ?? "", financing_policy: business?.financingPolicy ?? "",
    brands_worked_with: business?.brandsWorkedWith ?? "", response_time_commitment: business?.typicalResponseTimeCommitment ?? "",
    warranty_info: business?.warrantyInfo ?? "", maintenance_plan_offerings: business?.maintenancePlanOfferings ?? "",
    credentials: business?.credentialsCertifications ?? "", owner_availability: business?.ownerAvailability ?? "",
    emergency_contact_info: business?.emergencyContactInfo ?? "",
  };
}
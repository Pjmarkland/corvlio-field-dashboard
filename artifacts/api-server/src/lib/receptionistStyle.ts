// Only fixed, reviewed guidance becomes instructions. Saved free text remains data.
export function toneStyle(value?: string | null) {
  const v = (value ?? "").toLowerCase();
  if (/no[- ]nonsense|direct|straightforward/.test(v)) return "no-nonsense";
  if (/friendly|warm|neighborly|upbeat/.test(v) && !/professional/.test(v)) return "friendly";
  if (/professional|concise|formal/.test(v) && !/friendly|warm/.test(v)) return "professional";
  return "friendly-professional";
}
export const toneGuidance = {
  friendly: "Be warm and approachable. Use brief, natural acknowledgments; no excessive enthusiasm or small talk.",
  professional: "Be courteous and composed. Use clear, concise sentences and minimal casual phrasing.",
  "no-nonsense": "Be direct, calm and efficient, never curt. Avoid filler; ask concise questions and move on.",
  "friendly-professional": "Be friendly and professional: warm, calm, courteous and concise, without unnecessary small talk.",
};
export function intakeTrade(value?: string | null): "hvac" | "plumbing" | "electrical" | "generic" {
  const v = (value ?? "").toLowerCase();
  if (/hvac|heating|cooling|air conditioning/.test(v)) return "hvac";
  if (/plumb|drain|pipe/.test(v)) return "plumbing";
  if (/electri/.test(v)) return "electrical";
  return "generic";
}
export const tradeQuestions = {
  hvac: ["Is the problem no heat, no cooling, or something else?", "What type of system do you have, or about how old is it?"],
  plumbing: ["Is there an active leak, or has the water been shut off?", "Is there any flooding?"],
  electrical: ["Is a breaker tripping?", "Have you noticed a burning smell or sparks?"],
  generic: ["How long has this been happening?", "Is there anything else the team should know before calling back?"],
};
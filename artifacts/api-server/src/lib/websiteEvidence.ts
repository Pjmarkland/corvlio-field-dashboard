import { parseBusinessHours } from "./businessHours";

export const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fullDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayPattern = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Mo|Tu|We|Th|Fr|Sa|Su)";
function dayName(value: string) {
  return days.find((day, index) => value.toLowerCase() === day.toLowerCase()
    || value.toLowerCase() === fullDays[index].toLowerCase()
    || value.toLowerCase() === day.slice(0, 2).toLowerCase()) ?? value;
}
function clock(hour: string, minute: string | undefined, suffix: string | undefined) {
  let h = Number(hour);
  const m = Number(minute ?? 0);
  if (m > 59 || (suffix ? h < 1 || h > 12 : h > 23)) return null;
  if (suffix) h = h % 12 + (suffix.toLowerCase().startsWith("p") ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Only explicit day/time schedules; never transform emergency/24/7 marketing into hours. */
export function readableHours(text: string): { value: string; evidence: string } | null {
  const time = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?";
  const expression = new RegExp(`(${dayPattern}(?:\\s*(?:-|–|—|to|through|,|&)\\s*${dayPattern})*)\\s*:?\\s*${time}\\s*(?:-|–|—|to)\\s*${time}`, "gi");
  const schedules: string[] = [], quotes: string[] = [];
  for (const match of text.matchAll(expression)) {
    // Bare "8 to 5" is ambiguous. 24-hour notation or both am/pm markers are required.
    if ((!match[4] || !match[7]) && (!match[3] || !match[6])) continue;
    const start = clock(match[2], match[3], match[4]), end = clock(match[5], match[6], match[7]);
    if (!start || !end) continue;
    const names = match[1].replace(new RegExp(dayPattern, "gi"), dayName)
      .replace(/\s*(?:–|—|to|through)\s*/gi, "-").replace(/\s*&\s*/g, ",").replace(/\s*-\s*/g, "-");
    const value = `${names} ${start}-${end}`;
    if (!parseBusinessHours(value) || schedules.includes(value)) continue;
    schedules.push(value); quotes.push(normalizeText(match[0]));
  }
  if (!schedules.length) return null;
  return { value: schedules.join("; "), evidence: quotes.join(" […] ") };
}

export function isWorkRefusal(quote: string): boolean {
  if (/\b(?:billing|payment|payments|credit card|financing|warranty|warranties|scheduling|appointment|fee|fees|process payment|insurance provider)\b/i.test(quote)) return false;
  return /\b(?:no|not|never|don't|doesn't|cannot|can't|only)\b/i.test(quote)
    && /\b(?:commercial|residential|work|services?|repairs?|install\w*|roof\w*|plumb\w*|electri\w*|heating|cooling|hvac|garage|doors?|septic|cleaning|landscap\w*|pools?|appliances?)\b/i.test(quote);
}

export function exclusiveWork(quote: string): string | null {
  if (/\bresidential(?:\s+services?|\s+work)?\s+only\b|\bonly\s+(?:do|offer|service)\s+residential\b/i.test(quote)) return "Commercial work";
  if (/\bcommercial(?:\s+services?|\s+work)?\s+only\b|\bonly\s+(?:do|offer|service)\s+commercial\b/i.test(quote)) return "Residential work";
  return null;
}

/** Every quote must belong to ONE cited page. Keep the public evidence/sourceUrl contract. */
export function evidenceQuotes(input: unknown): string[] {
  const values = Array.isArray(input) ? input : typeof input === "string" ? input.split(" […] ") : [];
  return values.filter((value): value is string => typeof value === "string")
    .map(normalizeText).filter(value => value.length > 0);
}

/** Values are verbatim facts, not an unchecked AI paraphrase. */
export function faithfulValue(value: string, quotes: string[]): string {
  const evidence = quotes.join(" […] ");
  const text = normalizeText(evidence).toLowerCase();
  const parts = value.split(/\s*;\s*/).filter(Boolean);
  return parts.length && parts.every(part => text.includes(normalizeText(part).toLowerCase()))
    ? value : evidence;
}

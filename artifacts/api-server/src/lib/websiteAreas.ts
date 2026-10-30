import type { CheerioAPI } from "cheerio";
import { normalizeText } from "./websiteEvidence";

export type AreaFact = { value: string; evidence: string };
const cue = /\b(?:serving|serve|service areas?|areas we serve|proudly serving|county|counties|cities)\b/i;
const notPlaces = /\b(?:repair|installation|plumbing|roofing|doors?|warranty|pricing|privacy|terms|financing|contact|about|careers|services?|navigation|copyright|reserved|quality|professional|reliable|email|phone|home|blog|news|facebook|instagram|linkedin)\b/i;

/** Explicit coverage statements only: no office-address or trade-based inference. */
export function visibleServiceArea(text: string): AreaFact | undefined {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const evidence = normalizeText(sentence);
    if (!cue.test(evidence) || evidence.length > 400) continue;
    // Explicit county-labelled footer city lists need not repeat "we serve".
    if (/\b[A-Z][a-z]+(?: [A-Z][a-z]+){0,2} County:\s*[A-Z]/.test(evidence)
      && /^[A-Za-z\s.,:'’&-]+$/.test(evidence) && !notPlaces.test(evidence)) {
      return { value: evidence.replace(/[.!?]$/, ""), evidence };
    }
    const match = /\b(?:proudly\s+)?(?:serving|serve|service areas?\s*(?:include|:)|areas we serve\s*:?)\s+(.+)/i.exec(evidence);
    if (!match) continue;
    const value = match[1].replace(/[.!?]$/, "").split(/\s+(?:with|where|offering|providing|for all|since)\b/i)[0].trim();
    if (!value || value.length > 300 || /^(?:you|your|customers|homeowners|businesses|the community|all your)\b/i.test(value)) continue;
    if (notPlaces.test(value)) continue;
    const geographic = /\b(?:count(?:y|ies)|Florida|[A-Z]{2}|miles?)\b/.test(value)
      || /^[A-Z][a-z]+(?: [A-Z][a-z]+)*(?:,\s*|\s+and\s+)[A-Z]/.test(value)
      || /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,3}\b/.test(value);
    if (geographic) return { value, evidence };
  }
  return undefined;
}

export function visibleAreaFacts($: CheerioAPI): AreaFact | undefined {
  const blocks: string[] = [];
  $("p,footer,[role=contentinfo],section,footer div,[role=contentinfo] div").each((_, element) => {
    const node = $(element);
    if (cue.test(node.text())) blocks.push(normalizeText(node.text()));
  });
  // Short statements first, so unrelated footer links do not enter the value.
  for (const text of blocks.sort((a, b) => a.length - b.length)) {
    const fact = visibleServiceArea(text);
    if (fact) return fact;
  }
  let result: AreaFact | undefined;
  $("h2,h3,h4,strong").each((_, element) => {
    if (result) return;
    const heading = $(element), label = normalizeText(heading.text());
    if (!/\b(?:service areas?|areas we serve|cities we serve|counties we serve|coverage area)\b/i.test(label)) return;
    const list = heading.nextAll("ul,ol").first();
    const scope = list.length ? list : heading.parent();
    const nodes = scope.find("li");
    const items = (nodes.length ? nodes : scope.find("a,p")).toArray()
      .map(item => normalizeText($(item).text()));
    if (!items.length || items.some(item => notPlaces.test(item) || !/^[A-Z][A-Za-z .,'’&-]{1,65}$/.test(item))) return;
    const evidence = normalizeText(`${label} ${items.join(" ")}`);
    if (evidence.length <= 400) result = { value: items.join("; "), evidence };
  });
  return result;
}

/** Keep a targeted retry small while preserving whole coverage sentences. */
export function areaExcerpts(text: string): string {
  const chunks: string[] = [];
  const expression = /\b(?:serving|serve|areas|counties|cities|coverage)\b/gi;
  for (const match of text.matchAll(expression)) {
    chunks.push(text.slice(Math.max(0, match.index! - 120), match.index! + 650));
    if (chunks.join("\n").length > 6000) break;
  }
  return chunks.join("\n").slice(0, 7000) || text.slice(0, 7000);
}

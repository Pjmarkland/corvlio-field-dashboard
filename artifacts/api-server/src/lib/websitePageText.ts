import type { CheerioAPI } from "cheerio";
import { normalizeText, readableHours } from "./websiteEvidence";

export type StructuredFact = { value: string; evidence: string };
export type PageFacts = { hours?: StructuredFact; area?: StructuredFact; services?: StructuredFact };

/** Extract only the business properties needed here; no execution or linked resource loading. */
export function websitePageText($: CheerioAPI, url: string) {
  const facts: PageFacts = {};
  const structured: string[] = [];
  function visit(value: unknown, depth = 0) {
    if (depth > 10 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach(item => visit(item, depth + 1)); return; }
    const item = value as Record<string, unknown>;
    if (item.openingHours) {
      const hours = (Array.isArray(item.openingHours) ? item.openingHours : [item.openingHours])
        .filter((hour): hour is string => typeof hour === "string").join("; ");
      structured.push(hours);
      facts.hours ??= readableHours(hours) ?? undefined;
    }
    if (item.openingHoursSpecification) {
      const specs = Array.isArray(item.openingHoursSpecification) ? item.openingHoursSpecification : [item.openingHoursSpecification];
      const lines: string[] = [];
      for (const spec of specs.slice(0, 14)) {
        if (!spec || typeof spec !== "object") continue;
        const s = spec as Record<string, unknown>;
        const names = (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek])
          .filter((day): day is string => typeof day === "string")
          .map(day => day.replace(/^https?:\/\/schema\.org\//, ""));
        if (typeof s.opens === "string" && typeof s.closes === "string") {
          lines.push(`${names.join(",")} ${s.opens}-${s.closes}`);
        }
      }
      const hours = lines.join("; ");
      const evidence = JSON.stringify(item.openingHoursSpecification);
      structured.push(evidence);
      const schedule = readableHours(hours);
      if (schedule && evidence.length <= 400) facts.hours ??= { value: schedule.value, evidence };
    }
    if (item.areaServed) {
      const areas = (Array.isArray(item.areaServed) ? item.areaServed : [item.areaServed])
        .map(area => typeof area === "string" ? area : area && typeof area === "object"
          && typeof (area as Record<string, unknown>).name === "string" ? (area as { name: string }).name : "")
        .filter(Boolean).slice(0, 30).join("; ");
      if (areas && areas.length <= 400) {
        structured.push(areas);
        facts.area ??= { value: areas, evidence: areas.split("; ").join(" […] ") };
      }
    }
    // Follow containers, not unrelated reviews/articles that could carry misleading schedules.
    for (const key of ["@graph", "mainEntity", "department", "subOrganization"]) visit(item[key], depth + 1);
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* malformed schema is optional */ }
  });
  $("script, style, noscript, svg, iframe, template, form").remove();
  // Block boundaries prevent adjacent service cards becoming "RoofRepairRoofInstallation".
  $("h1,h2,h3,h4,h5,h6,p,li,div,section,br,td").after(" ");
  const snippets = (selector: string, cap: number) => {
    const values: string[] = [];
    $(selector).each((_, element) => {
      const text = normalizeText($(element).text());
      if (text && !values.includes(text)) values.push(text);
    });
    return values.join("\n").slice(0, cap);
  };
  const serviceText = snippets("h1,h2,h3,h4,h5,h6,li,.card-title,.service-title,.elementor-heading-title", 18000);
  // A final recall fallback uses only literal work titles in explicit services contexts.
  // Never use a company name/title or infer an offered service from the site's trade.
  const servicePage = /\/[^/?]*(?:services|repair|installation|what-we-do)[^/?]*(?:\/|$)/i.test(new URL(url).pathname)
    && !/\/(?:blog|news|about)/i.test(new URL(url).pathname);
  const work = /\b(?:repair|installation|replacement|cleaning|testing|inspection|detection|roofing|repip\w*|tune.up|backflow|fixture|water heater|garage door openers?|garage door screens?|motorized screens?)\b/i;
  const titles: string[] = [];
  $("h2,h3,h4,li,.card-title,.service-title,.elementor-heading-title").each((_, element) => {
    const node = $(element), title = normalizeText(node.text());
    const serviceContext = servicePage || node.closest('[class*="service"],[id*="service"]').length > 0
      || node.closest("section").find("h2,h3").toArray().some(heading => /our services|services we|what we do/i.test($(heading).text()));
    if (!serviceContext || !work.test(title) || title.length < 8 || title.length > 90
      || titles.length >= 8 || node.find("ul,ol").length
      || /^(?:installation|repair|replacement|services?|maintenance)$/i.test(title)
      || /[?]|why |when |how |tips|signs |benefits|24\/7|same.day|choose|welcome|\b(?:best|experts?|professional|reliable|trusted|quality|our|we|your|problems|materials)\b/i.test(title)) return;
    if (!titles.includes(title) && titles.join(" […] ").length + title.length + 5 <= 400) titles.push(title);
  });
  if (titles.length) facts.services = { value: titles.join("; "), evidence: titles.join(" […] ") };
  const focused = [snippets("footer,[role=contentinfo]", 10000), snippets("header", 6000),
    serviceText, ...structured].filter(Boolean);
  const body = normalizeText($("body").text() || $.text());
  const text = [normalizeText($("title").first().text()), $('meta[name="description"]').attr("content") ?? "",
    ...focused, body.slice(0, 16000)].join("\n").slice(0, 40000);
  facts.hours ??= readableHours(focused.join("\n") + "\n" + body) ?? undefined;
  return { text, serviceText, facts };
}

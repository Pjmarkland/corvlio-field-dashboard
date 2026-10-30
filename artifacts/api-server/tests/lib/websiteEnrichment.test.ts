import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

const fixture = vi.hoisted(() => ({
  lookup: vi.fn(), request: vi.fn(), createExtraction: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: fixture.lookup }));
vi.mock("node:http", () => ({ request: fixture.request }));
vi.mock("node:https", () => ({ request: fixture.request }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  getOpenAIClient: () => ({ chat: { completions: { create: fixture.createExtraction } } }),
}));
import {
  extractBusinessDetails, fetchWebsitePage, isPublicIpAddress, normalizeWebsiteUrl,
  previewBusinessWebsite, UnsafeWebsiteUrlError,
} from "../../src/lib/websiteEnrichment";
import { extractionDiagnostic, redactExtractionLog, type ExtractionDiagnostic } from "../../src/lib/websiteDiagnostics";

type Page = { html?: string; status?: number; headers?: Record<string, string> };
let pages: Record<string, Page>;
const savedHtml = (name: string) => readFileSync(new URL(`../fixtures/websites/${name}.html`, import.meta.url), "utf8");
const extraction = (fields: Record<string, unknown>) => ({ choices: [{ message: { content: JSON.stringify(fields) } }] });
beforeEach(() => {
  vi.clearAllMocks();
  pages = {
    "/": { html: '<body>We provide heating and cooling repairs.<a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a><a href="/blog">Blog</a><a href="https://outside.com/services">Services</a></body>' },
    "/about": { html: "<body>We are licensed and insured.</body>" },
    "/services": { html: "<body>Every installation includes a one-year labor warranty.</body>" },
    "/contact": { html: "<body>We serve Oakland and Berkeley.</body>" },
  };
  fixture.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fixture.request.mockImplementation((options, onResponse) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const page = pages[options.path] ?? { html: "<body>Not found</body>" };
      let destroyed = false;
      const response = Object.assign(new EventEmitter(), {
        statusCode: page.status ?? 200,
        headers: { "content-type": "text/html", ...page.headers },
        destroy: (error?: Error) => {
          destroyed = true;
          if (error) queueMicrotask(() => response.emit("error", error));
        },
      });
      onResponse(response);
      queueMicrotask(() => {
        if (!destroyed) {
          response.emit("data", Buffer.from(page.html ?? ""));
          response.emit("end");
        }
      });
    };
    return request;
  });
  fixture.createExtraction.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      servicesOffered: { value: "Heating and cooling repairs", evidence: "We provide heating and cooling repairs." },
      serviceArea: { value: "Oakland and Berkeley", evidence: "We serve Oakland and Berkeley." },
      pricingPolicy: { value: "Free estimates", evidence: "Free estimates are available." },
      warrantyInfo: { value: "One-year labor warranty on installations", evidence: "Every installation includes a one-year labor warranty." },
    }) } }],
  });
});

describe("public-only website requests", () => {
  it.each([
    "http://127.0.0.1", "http://2130706433", "http://0x7f000001",
    "http://10.0.0.1", "http://169.254.169.254", "http://[::1]",
    "http://[::ffff:127.0.0.1]", "http://localhost.", "http://box.internal",
    "file:///etc/passwd", "https://user:pass@example.com", "https://example.com:8080",
  ])("rejects unsafe URL %s before a connection", (url) => {
    expect(() => normalizeWebsiteUrl(url)).toThrow(UnsafeWebsiteUrlError);
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it.each(["100.64.0.1", "172.16.0.1", "192.168.0.1", "198.18.0.1", "2001:db8::1", "2002:7f00:1::1", "fe80::1", "fc00::1"])("blocks non-public IP %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
  it("pins the validated public IP while preserving the website host and TLS name", async () => {
    await fetchWebsitePage("https://example.com");
    expect(fixture.request.mock.calls[0][0]).toMatchObject({
      hostname: "93.184.216.34", servername: "example.com", agent: false,
      headers: { host: "example.com" },
    });
    expect(fixture.lookup).toHaveBeenCalledOnce();
  });
  it("preserves the owner's actual page query while dropping the fragment", async () => {
    await fetchWebsitePage("https://example.com/services?location=oakland#hours");
    expect(fixture.request.mock.calls[0][0].path).toBe("/services?location=oakland");
  });
  it("rejects DNS records with even one private address", async () => {
    fixture.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(fetchWebsitePage("https://example.com")).rejects.toBeInstanceOf(UnsafeWebsiteUrlError);
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it("rechecks redirects and never connects when the next DNS answer is private", async () => {
    pages["/"] = { status: 302, headers: { location: "/about" } };
    fixture.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchWebsitePage("https://example.com")).rejects.toBeInstanceOf(UnsafeWebsiteUrlError);
    expect(fixture.request).toHaveBeenCalledOnce();
  });
  it("does not follow cross-site redirects", async () => {
    pages["/"] = { status: 302, headers: { location: "https://outside.com/" } };
    await expect(fetchWebsitePage("https://example.com")).rejects.toBeInstanceOf(UnsafeWebsiteUrlError);
    expect(fixture.request).toHaveBeenCalledOnce();
  });
  it("limits redirect loops and truncates oversized bodies", async () => {
    pages["/"] = { status: 302, headers: { location: "/" } };
    await expect(fetchWebsitePage("https://example.com")).rejects.toThrow("redirected too many");
    expect(fixture.request).toHaveBeenCalledTimes(4);
    pages["/"] = { html: "<body>Readable services</body>" + "x".repeat(2_000_001), headers: { "content-length": "3000000" } };
    expect((await fetchWebsitePage("https://example.com")).truncated).toBe(true);
  });
});

describe("review-only extraction", () => {
  it("reads at most the submitted page and obvious same-site about/services/contact pages", async () => {
    const preview = await previewBusinessWebsite("https://example.com");
    expect(fixture.request.mock.calls.map(([options]) => options.path)).toEqual(["/", "/about", "/services", "/contact"]);
    expect(preview.fields.servicesOffered.value).toBe("Heating and cooling repairs");
    expect(preview.fields.serviceArea.sourceUrl).toBe("https://example.com/contact");
    expect(preview.fields.warrantyInfo.sourceUrl).toBe("https://example.com/services");
    expect(preview.fields.pricingPolicy.value).toBeNull();
    expect(preview.missingFields).toContain("pricingPolicy");
    expect(preview.missingFields).toContain("servicesNotOffered");
    expect(preview.status).toBe("partial");
  });
  it("leaves invalid schedules and facts without matching evidence blank", async () => {
    fixture.createExtraction.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      businessHours: { value: "Always open", evidence: "Our business hours are listed below." },
      credentials: { value: "Licensed", evidence: "A quote that is not on the page." },
    }) } }] });
    const fields = await extractBusinessDetails([{ url: "https://example.com/", text: "Our business hours are listed below.", links: [] }]);
    expect(fields.businessHours.value).toBeNull();
    expect(fields.credentials.value).toBeNull();
  });
  it("treats website content as untrusted data in extraction instructions", async () => {
    await previewBusinessWebsite("https://example.com");
    const request = fixture.createExtraction.mock.calls[0][0];
    expect(request.messages[0].content).toContain("untrusted data");
    expect(request.messages[0].content).toContain("Do not guess");
  });
});

describe("saved HTML quality and recovery (no live requests)", () => {
  it("discovers repair/install nav/footer links on a second services-only pass", async () => {
    pages = { "/": { html: savedHtml("services-home") }, "/what-we-do/repairs": { html: savedHtml("services-repairs") } };
    fixture.createExtraction.mockResolvedValueOnce(extraction({})).mockResolvedValueOnce(extraction({
      servicesOffered: { value: "Drain cleaning; Water heater repair; Leak detection; Fixture installation",
        evidence: ["Drain cleaning", "Water heater repair", "Leak detection", "Fixture installation"] },
    }));
    const result = await previewBusinessWebsite("https://example.com");
    expect(fixture.request.mock.calls.map(([options]) => options.path)).toContain("/what-we-do/repairs");
    expect(fixture.request.mock.calls.map(([options]) => options.headers.host)).not.toContain("external.example");
    expect(result.fields.servicesOffered.value).toBe("Drain cleaning; Water heater repair; Leak detection; Fixture installation");
    expect(result.fields.servicesOffered.sourceUrl).toBe("https://example.com/what-we-do/repairs");
    expect(fixture.createExtraction.mock.calls[1][0].messages[1].content).toContain('"requestedFields":{"servicesOffered"');
  });
  it("retains literal service-card/list titles after AI timeout on the second pass", async () => {
    pages = { "/": { html: savedHtml("services-home") }, "/what-we-do/repairs": { html: savedHtml("services-repairs") } };
    fixture.createExtraction.mockRejectedValue(new Error("AI timed out"));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.fields.servicesOffered.value).toContain("Water heater repair");
    expect(result.fields.servicesOffered.evidence).toContain("Water heater repair");
    expect(result.fields.servicesOffered.sourceUrl).toBe("https://example.com/what-we-do/repairs");
    expect(result.status).toBe("partial");
  });
  it("retries a paraphrased services paragraph as a short literal work list", async () => {
    pages = { "/": { html: savedHtml("services-home") }, "/what-we-do/repairs": { html: savedHtml("services-repairs") } };
    fixture.createExtraction.mockResolvedValueOnce(extraction({
      servicesOffered: { value: "We provide local plumbing solutions.", evidence: "Welcome to our local team." },
    })).mockResolvedValueOnce(extraction({
      servicesOffered: { value: "Drain cleaning; Water heater repair", evidence: ["Drain cleaning", "Water heater repair"] },
    }));
    expect((await previewBusinessWebsite("https://example.com")).fields.servicesOffered.value).toBe("Drain cleaning; Water heater repair");
  });
  it("reads explicit weekday hours and city lists in the footer", async () => {
    pages = { "/": { html: savedHtml("footer-hours") } };
    fixture.createExtraction.mockResolvedValue(extraction({
      serviceArea: { value: "Fort Myers; Estero; Naples", evidence: "Areas we serve Fort Myers Estero Naples" },
    }));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.fields.businessHours).toMatchObject({ value: "Mon-Fri 08:00-17:00", sourceUrl: "https://example.com/" });
    expect(result.fields.businessHours.evidence).toContain("Monday - Friday 8:00am to 5:00pm");
    expect(result.fields.serviceArea.value).toBe("Fort Myers; Estero; Naples");
  });
  it("reads JSON-LD hours specifications and areaServed even when AI fails", async () => {
    pages = { "/": { html: savedHtml("structured-hours") } };
    fixture.createExtraction.mockRejectedValue(new Error("Model timeout"));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.fields.businessHours.value).toBeNull();
    expect(result.fields.businessHoursSuggestion?.value).toBe("Mon,Tue,Wed,Thu,Fri 08:00-17:00");
    expect(result.fields.serviceArea.value).toBe("Fort Myers; Estero");
    expect(result.status).toBe("partial");
    expect(result.message).toBe("We couldn't read this site automatically. Type your answers below.");
  });
  it("reads the schema.org openingHours string without executing scripts", async () => {
    pages = { "/": { html: '<script type="application/ld+json">{"@type":"LocalBusiness","openingHours":"Mo-Fr 08:00-17:00"}</script><body>Welcome</body>' } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    const preview = await previewBusinessWebsite("https://example.com");
    expect(preview.fields.businessHours.value).toBeNull();
    expect(preview.fields.businessHoursSuggestion?.value).toBe("Mon-Fri 08:00-17:00");
  });
  it("rejects AI attempts to accept JSON-LD-only hours and warns about implausible hidden hours", async () => {
    pages = { "/": { html: savedHtml("hidden-hours-unusual") } };
    fixture.createExtraction.mockResolvedValue(extraction({
      businessHours: { value: "Mon-Sun 12:00-23:59", evidence: "12:00-23:59" },
    }));
    const preview = await previewBusinessWebsite("https://example.com");
    expect(preview.fields.businessHours.value).toBeNull();
    expect(preview.fields.businessHoursSuggestion).toMatchObject({
      value: "Mon,Tue,Wed,Thu,Fri,Sat,Sun 12:00-23:59",
      warning: "These hours look unusual. Please confirm.", sourceUrl: "https://example.com/",
    });
    expect(preview.fields.businessHoursSuggestion?.evidence).toContain('"opens":"12:00"');
  });
  it("rejects a quote that matches only the hidden openingHours string, not visible text", async () => {
    pages = { "/": { html: savedHtml("structured-string-hours") } };
    fixture.createExtraction.mockResolvedValue(extraction({
      businessHours: { value: "Mon-Fri 09:00-18:00", evidence: "Mo-Fr 09:00-18:00" },
    }));
    const events: ExtractionDiagnostic[] = [];
    const preview = await previewBusinessWebsite("https://example.com", event => events.push(event));
    expect(preview.fields.businessHours.value).toBeNull();
    expect(preview.fields.businessHoursSuggestion?.value).toBe("Mon-Fri 09:00-18:00");
    expect(events).toContainEqual(expect.objectContaining({ field: "businessHours", accepted: false, reason: "hours_not_in_visible_text" }));
  });
  it("prefills visible hours even when metadata agrees, without an unconfirmed duplicate", async () => {
    pages = { "/": { html: savedHtml("structured-hours") + savedHtml("footer-hours") } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    const preview = await previewBusinessWebsite("https://example.com");
    expect(preview.fields.businessHours).toMatchObject({ value: "Mon-Fri 08:00-17:00", sourceUrl: "https://example.com/" });
    expect(preview.fields.businessHours.evidence).toContain("Monday - Friday 8:00am to 5:00pm");
    expect(preview.fields.businessHoursSuggestion?.value).toBeNull();
  });
  it("finds the visible Lee, Collier and Charlotte counties sentence even if all model calls fail", async () => {
    pages = { "/": { html: savedHtml("visible-counties") } };
    fixture.createExtraction.mockRejectedValue(new Error("Model timed out"));
    const preview = await previewBusinessWebsite("https://example.com");
    expect(preview.fields.serviceArea).toEqual({
      value: "Lee, Collier and Charlotte counties",
      evidence: "Locally owned, licensed and insured plumbing service serving Lee, Collier and Charlotte counties.",
      sourceUrl: "https://example.com/",
    });
  });
  it("finds explicit county-labelled footer city lists without AI", async () => {
    pages = { "/": { html: savedHtml("footer-counties") } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    const preview = await previewBusinessWebsite("https://example.com");
    expect(preview.fields.serviceArea.value).toContain("Lee County: Cape Coral, Fort Myers, Estero");
    expect(preview.fields.serviceArea.evidence).toContain("Lee County:");
    expect(preview.fields.serviceArea.sourceUrl).toBe("https://example.com/");
  });
  it("finds footer city links beneath an explicit areas-we-serve heading", async () => {
    pages = { "/": { html: savedHtml("footer-city-links") } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    const preview = await previewBusinessWebsite("https://example.com");
    expect(preview.fields.serviceArea).toEqual({
      value: "Fort Myers Estero Naples", evidence: "Areas we serve Fort Myers Estero Naples", sourceUrl: "https://example.com/",
    });
  });
  it("runs a second targeted area pass after null and discovers same-site coverage links", async () => {
    pages = { "/": { html: savedHtml("areas-home") }, "/coverage": { html: savedHtml("areas-coverage") } };
    fixture.createExtraction.mockImplementation(async (request) => {
      const payload = JSON.parse(request.messages[1].content);
      return extraction(payload.requestedFields.serviceArea && Object.keys(payload.requestedFields).length === 1
        ? { serviceArea: { value: "Oakland; Berkeley", evidence: "We serve Oakland and Berkeley." } } : {});
    });
    const events: ExtractionDiagnostic[] = [];
    const preview = await previewBusinessWebsite("https://example.com", event => events.push(event));
    expect(preview.fields.serviceArea).toMatchObject({ value: "Oakland; Berkeley", sourceUrl: "https://example.com/coverage" });
    expect(fixture.request.mock.calls.map(([options]) => options.path)).toContain("/coverage");
    expect(events).toContainEqual(expect.objectContaining({ reason: "null_with_visible_cue_targeted_retry" }));
    expect(fixture.createExtraction.mock.calls.some(([request]) =>
      Object.keys(JSON.parse(request.messages[1].content).requestedFields).join() === "serviceArea")).toBe(true);
  });
  it("retries invalid JSON once with a shorter prompt and records rejection reasons", async () => {
    fixture.createExtraction.mockResolvedValueOnce({ choices: [{ message: { content: "not JSON" } }] })
      .mockResolvedValueOnce(extraction({ credentials: { value: "Licensed", evidence: "Not on this page." } }));
    const events: ExtractionDiagnostic[] = [];
    await extractBusinessDetails([{ url: "https://example.com/", text: "A public page. ".repeat(1500), links: [] }], false,
      Date.now() + 10000, event => events.push(event));
    expect(fixture.createExtraction).toHaveBeenCalledTimes(2);
    expect(fixture.createExtraction.mock.calls[1][0].messages[1].content.length)
      .toBeLessThan(fixture.createExtraction.mock.calls[0][0].messages[1].content.length);
    expect(events).toContainEqual(expect.objectContaining({ kind: "ai_failure", reason: "invalid_json", attempt: 1 }));
    expect(events).toContainEqual(expect.objectContaining({ field: "credentials", accepted: false, reason: "evidence_not_found_on_one_page" }));
  });
  it("redacts diagnostics and never prints raw extraction logs in production", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const secret = "sk-sensitive-example";
      vi.stubEnv("NODE_ENV", "development");
      extractionDiagnostic({ kind: "model_response", target: "full", reason: "received", rawResponse: `{"password":"unsafe","value":"${secret}"}` });
      expect(info).toHaveBeenCalledOnce();
      expect(info.mock.calls[0][0]).not.toContain(secret);
      expect(info.mock.calls[0][0]).not.toContain("unsafe");
      expect(redactExtractionLog("https://example.com/?token=unsafe")).not.toContain("unsafe");
      info.mockClear();
      vi.stubEnv("NODE_ENV", "production");
      extractionDiagnostic({ kind: "model_response", target: "full", reason: "received", rawResponse: secret });
      expect(info).not.toHaveBeenCalled();
    } finally { info.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("never converts 24/7 emergency marketing to business hours", async () => {
    pages = { "/": { html: savedHtml("emergency-and-policies") } };
    fixture.createExtraction.mockResolvedValue(extraction({
      businessHours: { value: "24/7", evidence: "24/7 same-day emergency service available." },
      emergencyContactInfo: { value: "24/7 same-day emergency service available.", evidence: "24/7 same-day emergency service available." },
    }));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.fields.businessHours.value).toBeNull();
    expect(result.fields.emergencyContactInfo.value).not.toBeNull();
  });
  it("moves insurance billing into notes, never refused work", async () => {
    pages = { "/": { html: savedHtml("emergency-and-policies") } };
    fixture.createExtraction.mockResolvedValue(extraction({
      servicesNotOffered: { value: "Insurance claims", evidence: "We do not process payment through the insurance provider." },
    }));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.fields.servicesNotOffered.value).toBeNull();
    expect(result.fields.otherPolicies?.value).toBe("We do not process payment through the insurance provider.");
  });
  it("retains explicit work refusals and does not invert residential-only into refusing residential", async () => {
    for (const evidence of ["We do not service commercial buildings.", "Residential only."]) {
      pages = { "/": { html: `<body>${evidence}</body>` } };
      fixture.createExtraction.mockResolvedValue(extraction({ servicesNotOffered: { value: "Commercial work", evidence } }));
      expect((await previewBusinessWebsite("https://example.com")).fields.servicesNotOffered.value).not.toBeNull();
    }
  });
  it("removes a processing fee unsupported by the quote; permits two sourced quotes", async () => {
    const text = "Free estimates are available. Card payments have a 3.5% processing fee.";
    fixture.createExtraction.mockResolvedValueOnce(extraction({
      pricingPolicy: { value: "Free estimates; 3.5% fee", evidence: "Free estimates are available." },
    }));
    const result = await extractBusinessDetails([{ url: "https://example.com", text, links: [] }]);
    expect(result.pricingPolicy.value).not.toContain("3.5%");
    fixture.createExtraction.mockResolvedValueOnce(extraction({
      pricingPolicy: { value: "Free estimates; 3.5% processing fee", evidence: ["Free estimates are available.", "Card payments have a 3.5% processing fee."] },
    }));
    const supported = await extractBusinessDetails([{ url: "https://example.com", text, links: [] }]);
    expect(supported.pricingPolicy.value).toContain("3.5%");
    expect(supported.pricingPolicy.evidence).toContain("3.5%");
  });
  it("does not treat page-builder placeholder pricing as an actual maintenance plan", async () => {
    const evidence = "Best Maintenance Plans Lorem ipsum dolor sit amet $49 / Sessions";
    fixture.createExtraction.mockResolvedValue(extraction({ maintenancePlanOfferings: { value: "$49", evidence } }));
    const fields = await extractBusinessDetails([{ url: "https://example.com", text: evidence, links: [] }]);
    expect(fields.maintenancePlanOfferings.value).toBeNull();
  });
  it("rejects a template plan heading even when its quote leaves out adjacent filler", async () => {
    fixture.createExtraction.mockResolvedValue(extraction({
      maintenancePlanOfferings: { value: "Best Maintenance Plans", evidence: "Pricing Plan Best Maintenance Plans" },
    }));
    const fields = await extractBusinessDetails([{
      url: "https://example.com", links: [],
      text: "Pricing Plan Best Maintenance Plans Lorem ipsum dolor sit amet. Home Service $49 / Sessions",
    }]);
    expect(fields.maintenancePlanOfferings.value).toBeNull();
  });
  it("returns partial rather than an error for oversized HTML, keeping extracted facts", async () => {
    pages = { "/": { html: savedHtml("footer-hours") + " ".repeat(2_000_001), headers: { "content-length": "3000000" } } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.status).toBe("partial");
    expect(result.fields.businessHours.value).toBe("Mon-Fri 08:00-17:00");
    expect(result.message).toBe("We couldn't read this site automatically. Type your answers below.");
  });
  it("returns partial/manual entry on timeout without invoking the AI", async () => {
    fixture.lookup.mockRejectedValue(new Error("Website request timed out"));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.status).toBe("partial");
    expect(result.message).toBe("We couldn't read this site automatically. Type your answers below.");
    expect(result.fields.servicesOffered.value).toBeNull();
    expect(fixture.createExtraction).not.toHaveBeenCalled();
  });
  it("preserves readable pages when another page fails", async () => {
    pages = { "/": { html: savedHtml("footer-hours") + '<a href="/contact">Contact</a>' }, "/contact": { status: 503 } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    const result = await previewBusinessWebsite("https://example.com");
    expect(result.status).toBe("partial");
    expect(result.fields.businessHours.value).toBe("Mon-Fri 08:00-17:00");
  });
  it("returns empty services when no work is listed; never infers from the company name", async () => {
    pages = { "/": { html: "<body><h1>Example Plumbing</h1><p>Welcome. Call our team.</p></body>" } };
    fixture.createExtraction.mockResolvedValue(extraction({}));
    expect((await previewBusinessWebsite("https://example.com")).fields.servicesOffered.value).toBeNull();
  });
});

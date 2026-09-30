const fixture = vi.hoisted(() => ({
  applyWebsiteEnrichment: vi.fn(),
  createExtraction: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34" }]),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        create: fixture.createExtraction,
      },
    },
  }),
}));

vi.mock("../../src/lib/businessDirectory", () => ({
  applyWebsiteEnrichment: fixture.applyWebsiteEnrichment,
  WEBSITE_ENRICHMENT_FIELDS: [
    "businessType",
    "majorIssueExamples",
    "servicesNotOffered",
    "pricingPolicy",
    "financingPolicy",
    "brandsWorkedWith",
    "typicalResponseTimeCommitment",
    "warrantyInfo",
    "maintenancePlanOfferings",
    "credentialsCertifications",
    "ownerAvailability",
    "emergencyContactInfo",
  ],
}));

import { enrichBusinessFromWebsite } from "../../src/lib/websiteEnrichment";

describe("website detail extraction", () => {
  beforeEach(() => {
    fixture.applyWebsiteEnrichment.mockResolvedValue(undefined);
    fixture.createExtraction.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            businessType: {
              value: "HVAC contractor",
              evidence: "We provide heating and cooling repairs.",
            },
            pricingPolicy: {
              value: "Free estimates",
              evidence: "Free estimates are available for replacement projects.",
            },
            warrantyInfo: {
              value: "Lifetime workmanship warranty",
              evidence: "Every installation includes a lifetime workmanship warranty.",
            },
          }),
        },
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      const html = url === "https://example.com/"
        ? '<html><head><title>Example HVAC</title></head><body><p>We provide heating and cooling repairs.</p><a href="/about">About us</a></body></html>'
        : '<html><body><p>Every installation includes a lifetime workmanship warranty.</p></body></html>';
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts only values backed by a matching quote and records the quote's page URL", async () => {
    await enrichBusinessFromWebsite(12, "https://example.com");

    expect(fixture.applyWebsiteEnrichment).toHaveBeenCalledWith(
      12,
      {
        businessType: "HVAC contractor",
        warrantyInfo: "Lifetime workmanship warranty",
      },
      {
        businessType: "https://example.com/",
        warrantyInfo: "https://example.com/about",
      },
    );
  });
});
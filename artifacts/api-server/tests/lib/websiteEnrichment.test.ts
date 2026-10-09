import { EventEmitter } from "node:events";

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

type Page = { html?: string; status?: number; headers?: Record<string, string> };
let pages: Record<string, Page>;
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
  it("limits redirect loops and oversized bodies", async () => {
    pages["/"] = { status: 302, headers: { location: "/" } };
    await expect(fetchWebsitePage("https://example.com")).rejects.toThrow("redirected too many");
    expect(fixture.request).toHaveBeenCalledTimes(4);
    pages["/"] = { html: "x".repeat(700_001) };
    await expect(fetchWebsitePage("https://example.com")).rejects.toThrow("too large");
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

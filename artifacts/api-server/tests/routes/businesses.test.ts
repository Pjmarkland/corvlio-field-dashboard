import { createServer, type Server } from "node:http";
import express from "express";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  saveBusinessWithOptionalPhone: vi.fn(),
  findBusinessByClerkUserId: vi.fn(),
  updateBusiness: vi.fn(),
  updateOwnedBusiness: vi.fn(),
  claimWebsiteEnrichment: vi.fn(),
  enrichBusinessFromWebsite: vi.fn(),
  previewBusinessWebsite: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: mocks.getAuth,
}));

vi.mock("../../src/lib/retellProvisioning", () => ({
  saveBusinessWithOptionalPhone: mocks.saveBusinessWithOptionalPhone,
}));

vi.mock("../../src/lib/businessDirectory", () => ({
  claimWebsiteEnrichment: mocks.claimWebsiteEnrichment,
  findBusinessByClerkUserId: mocks.findBusinessByClerkUserId,
  updateBusiness: mocks.updateBusiness,
  updateOwnedBusiness: mocks.updateOwnedBusiness,
  WEBSITE_ENRICHMENT_FIELDS: [
    "businessType",
    "servicesOffered",
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

vi.mock("../../src/lib/websiteEnrichment", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/websiteEnrichment")>(),
  previewBusinessWebsite: mocks.previewBusinessWebsite,
}));

import businessesRouter from "../../src/routes/businesses";
import { unavailableWebsitePreview } from "../../src/lib/websiteEnrichment";

let server: Server;
let baseUrl: string;
let business: Record<string, any> | undefined;

const validBody = {
  businessName: "Example Heating",
  ownerEmail: "business-owner@example.test",
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { log: { warn: typeof vi.fn; error: typeof vi.fn } }).log = {
      warn: mocks.logWarn,
      error: mocks.logError,
    };
    next();
  });
  app.use(businessesRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  business = {
    id: 44,
    businessName: "Example Heating",
    agentName: null,
    businessType: "HVAC",
    businessWebsiteUrl: "https://example.com",
    ownerEmail: "owner@example.com",
    serviceArea: "Northside",
    personalityToneDescription: null,
    servicesNotOffered: null,
    majorIssueExamples: null,
    pricingPolicy: null,
    financingPolicy: null,
    brandsWorkedWith: null,
    typicalResponseTimeCommitment: null,
    warrantyInfo: null,
    maintenancePlanOfferings: null,
    credentialsCertifications: null,
    ownerAvailability: null,
    emergencyContactInfo: null,
    retellPhoneNumber: null,
    websiteEnrichmentAttemptedAt: null,
    websiteEnrichmentSources: {},
  };
  mocks.getAuth.mockReturnValue({ userId: "clerk-user-44" });
  mocks.findBusinessByClerkUserId.mockImplementation(async () => business);
  mocks.updateBusiness.mockImplementation(async (_id: number, changes: Record<string, unknown>) => {
    business = { ...business, ...changes };
    return business;
  });
  mocks.updateOwnedBusiness.mockImplementation(async (
    _id: number,
    _clerkUserId: string,
    changes: Record<string, unknown>,
  ) => {
    if (!business) return undefined;
    business = { ...business, ...changes };
    return business;
  });
  mocks.claimWebsiteEnrichment.mockImplementation(async () => {
    if (!business || business.websiteEnrichmentAttemptedAt) return undefined;
    business = { ...business, websiteEnrichmentAttemptedAt: new Date() };
    return business;
  });
  mocks.enrichBusinessFromWebsite.mockResolvedValue(undefined);
  mocks.previewBusinessWebsite.mockResolvedValue(unavailableWebsitePreview());
  mocks.saveBusinessWithOptionalPhone.mockImplementation(async (input: Record<string, unknown>) => {
    const old = business;
    business = {
      ...old, ...input, id: old?.id ?? 45,
      retellPhoneNumber: old?.retellPhoneNumber ?? null,
      isSample: Boolean(old?.isSample || input.isSample),
      websiteEnrichmentAttemptedAt: old?.websiteEnrichmentAttemptedAt ?? null,
    };
    return {
      business,
      phoneProvisioningPending: !business.isSample && !business.retellPhoneNumber,
      provisioningError: null,
    };
  });
});

async function onboard(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/businesses/onboard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getMyBusiness() {
  return fetch(`${baseUrl}/businesses/me`);
}

async function updateMyBusiness(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/businesses/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("owner business profile API", () => {
  it.each(["Fuck Plumbing", "F u c k Plumbing", "N1gg3r Services"])("rejects unsafe names through direct create/edit APIs: %s", async businessName => {
    const before = structuredClone(business);
    const created = await onboard({ ...validBody, businessName });
    const edited = await updateMyBusiness({ businessName, serviceArea: "Must not save" });
    for (const response of [created, edited]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Please use your real business name without offensive language." });
    }
    expect(business).toEqual(before);
    expect(mocks.saveBusinessWithOptionalPhone).not.toHaveBeenCalled();
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
    expect(mocks.findBusinessByClerkUserId).not.toHaveBeenCalled();
    expect(mocks.claimWebsiteEnrichment).not.toHaveBeenCalled();
    expect(mocks.enrichBusinessFromWebsite).not.toHaveBeenCalled();
  });
  it.each(["Scunthorpe Plumbing", "Dickson Electric", "Penistone Builders"])("allows legitimate names in both APIs: %s", async businessName => {
    const original = structuredClone(business);
    expect((await onboard({ ...validBody, businessName })).status).toBe(200);
    // Exercise PATCH with its complete profile fixture, independently of the
    // provisioning mock's partial onboarding record (no real DB is involved).
    business = original;
    expect((await updateMyBusiness({ businessName })).status).toBe(200);
    expect(business?.businessName).toBe(businessName);
  });
  it("does not rewrite or reject an existing name when unrelated settings are edited", async () => {
    business = { ...business, businessName: "Fuck Legacy Name" };
    expect((await updateMyBusiness({ leadAlertsEnabled: false })).status).toBe(200);
    expect(business?.businessName).toBe("Fuck Legacy Name");
    expect(mocks.updateOwnedBusiness.mock.calls[0][2]).toEqual({ leadAlertsEnabled: false });
  });
  it("saves validated hours/timezone and rejects malformed schedules/zones without updating", async () => {
    const good = await updateMyBusiness({ businessHours: "Mon-Fri 08:00-18:00; Sat 09:00-13:00", timeZone: "America/Chicago" });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ businessHours: "Mon-Fri 08:00-18:00; Sat 09:00-13:00", timeZone: "America/Chicago" });
    mocks.updateOwnedBusiness.mockClear();
    expect((await updateMyBusiness({ businessHours: "Mon-Fri 99:00-99:00" })).status).toBe(400);
    expect((await updateMyBusiness({ timeZone: "Mars/Unknown" })).status).toBe(400);
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
  });
  it("returns the signed-in owner's business profile without cacheable data", async () => {
    const response = await getMyBusiness();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      businessName: "Example Heating",
      businessType: "HVAC",
      ownerEmail: "owner@example.com",
      retellPhoneNumber: null,
    });
    expect(mocks.findBusinessByClerkUserId).toHaveBeenCalledWith("clerk-user-44");
  });

  it("requires a signed-in owner for profile reads and updates", async () => {
    mocks.getAuth.mockReturnValue({ userId: null });

    const getResponse = await getMyBusiness();
    const updateResponse = await updateMyBusiness({ businessName: "New name" });

    expect(getResponse.status).toBe(401);
    expect(updateResponse.status).toBe(401);
    expect(mocks.findBusinessByClerkUserId).not.toHaveBeenCalled();
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
  });

  it("does not update a profile when the signed-in user has no business", async () => {
    business = undefined;

    const response = await updateMyBusiness({ businessName: "Someone else's business" });

    expect(response.status).toBe(404);
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
  });

  it("rejects client-supplied business ownership identifiers", async () => {
    const response = await updateMyBusiness({
      businessName: "Attempted takeover",
      businessId: 99,
      clerkUserId: "another-owner",
    });

    expect(response.status).toBe(400);
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
  });

  it("validates owner email and website URLs before saving", async () => {
    const invalidEmail = await updateMyBusiness({ ownerEmail: "not-an-email" });
    const invalidWebsite = await updateMyBusiness({
      businessWebsiteUrl: "javascript:alert(1)",
    });

    expect(invalidEmail.status).toBe(400);
    expect(invalidWebsite.status).toBe(400);
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
  });

  it("updates the Clerk-owned business and clears sources only for edited enriched fields", async () => {
    business = {
      ...business,
      websiteEnrichmentSources: {
        businessType: "https://example.com/about",
        typicalResponseTimeCommitment: "https://example.com/service",
        pricingPolicy: "https://example.com/pricing",
      },
    };

    const response = await updateMyBusiness({
      businessName: "  Example Heating and Cooling  ",
      businessType: "  Heating & cooling  ",
      businessWebsiteUrl: null,
      responseTimeCommitment: "Same-day service",
      credentials: "NATE certified",
    });

    expect(response.status).toBe(200);
    const profile = await response.json();
    expect(profile).toMatchObject({
      businessName: "Example Heating and Cooling",
      businessType: "Heating & cooling",
      businessWebsiteUrl: null,
      responseTimeCommitment: "Same-day service",
      credentials: "NATE certified",
    });

    const [businessId, clerkUserId, changes] = mocks.updateOwnedBusiness.mock.calls[0];
    expect(businessId).toBe(44);
    expect(clerkUserId).toBe("clerk-user-44");
    expect(changes).toMatchObject({
      businessName: "Example Heating and Cooling",
      businessType: "Heating & cooling",
      businessWebsiteUrl: null,
      typicalResponseTimeCommitment: "Same-day service",
      credentialsCertifications: "NATE certified",
      websiteEnrichmentSources: {
        pricingPolicy: "https://example.com/pricing",
      },
    });
    expect(changes).not.toHaveProperty("id");
    expect(changes).not.toHaveProperty("clerkUserId");
  });
});

describe("business onboarding website enrichment", () => {
  it("passes owner-entered details to the account-locked setup service", async () => {
    business = {
      ...business,
      businessType: "Website-suggested plumber",
      websiteEnrichmentSources: {
        businessType: "https://example.com/about",
      },
    };

    const response = await onboard({
      ...validBody,
      businessType: "Owner-entered HVAC contractor",
      businessWebsiteUrl: "https://example.com",
    });

    expect(response.status).toBe(200);
    const [changes] = mocks.saveBusinessWithOptionalPhone.mock.calls[0];
    expect(changes.businessType).toBe("Owner-entered HVAC contractor");
    expect(mocks.updateBusiness).not.toHaveBeenCalled();
  });

  it("trims and saves an optional receptionist name", async () => {
    const response = await onboard({
      ...validBody,
      agentName: "  Aria  ",
    });

    expect(response.status).toBe(200);
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0]?.[0].agentName).toBe("Aria");
  });

  it("allows the receptionist name to be omitted and stores null", async () => {
    const response = await onboard(validBody);

    expect(response.status).toBe(200);
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0]?.[0].agentName).toBeNull();
  });

  it("passes a trimmed receptionist name through initial business provisioning", async () => {
    business = undefined;

    const response = await onboard({
      ...validBody,
      agentName: "  Nova  ",
      businessWebsiteUrl: "https://example.com",
    });

    expect(response.status).toBe(201);
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0]?.[0].agentName).toBe("Nova");
    expect(mocks.enrichBusinessFromWebsite).not.toHaveBeenCalled();
  });

  it("saves successfully without a website and does not schedule enrichment", async () => {
    business = undefined;

    const response = await onboard(validBody);

    expect(response.status).toBe(201);
    expect(mocks.saveBusinessWithOptionalPhone).toHaveBeenCalledOnce();
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0][0].websiteEnrichmentAttemptedAt)
      .toBeNull();
    expect(mocks.enrichBusinessFromWebsite).not.toHaveBeenCalled();
  });
  it.each([
    { isSample: true, businessName: "Edited demo" },
    { businessName: "Demo Pipeworks (Fictional Sample)" },
    { ownerEmail: "owner@example.com" },
  ])("saves sample inputs as demos and never schedules website scraping: %j", async (sample) => {
    business = undefined;
    const response = await onboard({ ...validBody, ...sample, businessWebsiteUrl: "https://example.com" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ isSample: true, phoneNumber: null, phoneProvisioningPending: false });
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0][0]).toMatchObject({ isSample: true, businessWebsiteUrl: null });
    expect(mocks.claimWebsiteEnrichment).not.toHaveBeenCalled();
    expect(mocks.enrichBusinessFromWebsite).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable website", new TypeError("fetch failed")],
    ["website timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
    ["extraction failure", new Error("website detail extraction returned invalid JSON")],
  ])("keeps the business save successful after %s", async (_failure, error) => {
    business = undefined;
    mocks.enrichBusinessFromWebsite.mockRejectedValue(error);

    const response = await onboard({
      ...validBody,
      businessWebsiteUrl: "https://example.com",
    });

    expect(response.status).toBe(201);
    expect(mocks.saveBusinessWithOptionalPhone).toHaveBeenCalledOnce();
    expect(mocks.previewBusinessWebsite).not.toHaveBeenCalled();
  });

  it("never schedules background scraping for concurrent or repeated onboarding requests", async () => {
    const body = {
      ...validBody,
      businessWebsiteUrl: "https://example.com",
    };
    let claimed = false;
    mocks.claimWebsiteEnrichment.mockImplementation(async () => {
      if (claimed) return undefined;
      claimed = true;
      return { ...business, websiteEnrichmentAttemptedAt: new Date() };
    });

    const responses = await Promise.all([
      onboard(body),
      onboard(body),
      onboard(body),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(mocks.enrichBusinessFromWebsite).not.toHaveBeenCalled();
    expect(mocks.claimWebsiteEnrichment).not.toHaveBeenCalled();
  });
  it("rejects saving website suggestions without review and saves edited services after review", async () => {
    const body = { ...validBody, servicesOffered: "Owner-reviewed HVAC repair and installation", websiteScrapePreviewed: true };
    expect((await onboard(body)).status).toBe(400);
    expect(mocks.saveBusinessWithOptionalPhone).not.toHaveBeenCalled();
    expect((await onboard({ ...body, websiteSuggestionsReviewed: true, businessHours: "", timeZone: "" })).status).toBe(200);
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0][0]).toMatchObject({
      servicesOffered: body.servicesOffered, businessHours: "", timeZone: "",
    });
  });
  it("requires services or explicit deferral after preview, including an empty failed preview", async () => {
    const body = { ...validBody, websitePreviewAttempted: true, servicesOffered: "" };
    expect((await onboard(body)).status).toBe(400);
    expect(mocks.saveBusinessWithOptionalPhone).not.toHaveBeenCalled();
    expect((await onboard({ ...body, servicesOfferedDeferred: true })).status).toBe(200);
  });
  it("saves reviewed otherPolicies separately from refused work", async () => {
    const otherPolicies = "We do not process payment through the insurance provider.";
    expect((await onboard({ ...validBody, otherPolicies, servicesNotOffered: "",
      servicesOffered: "Roof repair", websitePreviewAttempted: true,
      websiteScrapePreviewed: true, websiteSuggestionsReviewed: true })).status).toBe(200);
    expect(mocks.saveBusinessWithOptionalPhone.mock.calls[0][0]).toMatchObject({ otherPolicies, servicesNotOffered: "" });
    expect(mocks.enrichBusinessFromWebsite).not.toHaveBeenCalled();
  });
});

describe("website preview endpoint", () => {
  async function preview(websiteUrl: string) {
    return fetch(`${baseUrl}/businesses/onboarding/website-preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl }),
    });
  }
  it("requires authentication", async () => {
    mocks.getAuth.mockReturnValue({ userId: null });
    expect((await preview("https://example.com")).status).toBe(401);
    expect(mocks.previewBusinessWebsite).not.toHaveBeenCalled();
  });
  it("returns suggestions without saving or provisioning anything", async () => {
    const result = unavailableWebsitePreview();
    result.status = "partial";
    result.fields.servicesOffered = { value: "Heating repairs", evidence: "We provide heating repairs.", sourceUrl: "https://example.com/" };
    result.missingFields = result.missingFields.filter(key => key !== "servicesOffered");
    mocks.previewBusinessWebsite.mockResolvedValue(result);
    const response = await preview("example.com");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fields: { servicesOffered: { value: "Heating repairs" } } });
    expect(mocks.saveBusinessWithOptionalPhone).not.toHaveBeenCalled();
    expect(mocks.updateBusiness).not.toHaveBeenCalled();
    expect(mocks.updateOwnedBusiness).not.toHaveBeenCalled();
  });
  it("rejects private URLs before starting a scrape", async () => {
    expect((await preview("http://169.254.169.254")).status).toBe(400);
    expect(mocks.previewBusinessWebsite).not.toHaveBeenCalled();
  });
  it("returns a non-blocking manual fallback on fetch or extraction failure", async () => {
    mocks.previewBusinessWebsite.mockRejectedValue(new Error("fetch timed out"));
    const response = await preview("https://example.com");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "partial" });
    expect(mocks.saveBusinessWithOptionalPhone).not.toHaveBeenCalled();
  });
  it("never scrapes an existing sample business", async () => {
    business = { ...business, isSample: true };
    expect((await preview("https://example.com")).status).toBe(200);
    expect(mocks.previewBusinessWebsite).not.toHaveBeenCalled();
  });
});
import { createServer, type Server } from "node:http";
import express from "express";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  saveBusinessWithOptionalPhone: vi.fn(),
  findBusinessByClerkUserId: vi.fn(),
  updateBusiness: vi.fn(),
  claimWebsiteEnrichment: vi.fn(),
  enrichBusinessFromWebsite: vi.fn(),
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

vi.mock("../../src/lib/websiteEnrichment", () => ({
  enrichBusinessFromWebsite: mocks.enrichBusinessFromWebsite,
}));

import businessesRouter from "../../src/routes/businesses";

let server: Server;
let baseUrl: string;
let business: Record<string, any> | undefined;

const validBody = {
  businessName: "Example Heating",
  ownerEmail: "owner@example.com",
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
  mocks.claimWebsiteEnrichment.mockImplementation(async () => {
    if (!business || business.websiteEnrichmentAttemptedAt) return undefined;
    business = { ...business, websiteEnrichmentAttemptedAt: new Date() };
    return business;
  });
  mocks.enrichBusinessFromWebsite.mockResolvedValue(undefined);
  mocks.saveBusinessWithOptionalPhone.mockImplementation(async (input: Record<string, unknown>) => ({
    business: {
      ...input,
      id: 45,
      retellPhoneNumber: null,
    },
    phoneProvisioningPending: true,
    provisioningError: null,
  }));
});

async function onboard(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/businesses/onboard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("business onboarding website enrichment", () => {
  it("keeps owner-entered details and clears their website source marker", async () => {
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
    const [, changes] = mocks.updateBusiness.mock.calls[0];
    expect(changes.businessType).toBe("Owner-entered HVAC contractor");
    expect(changes.websiteEnrichmentSources.businessType).toBeUndefined();
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
    await vi.waitFor(() => expect(mocks.logWarn).toHaveBeenCalled());
  });

  it("schedules website enrichment only once for concurrent and repeated onboarding requests", async () => {
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
    await vi.waitFor(() => expect(mocks.enrichBusinessFromWebsite).toHaveBeenCalledOnce());
    expect(mocks.claimWebsiteEnrichment).toHaveBeenCalledTimes(3);
  });
});
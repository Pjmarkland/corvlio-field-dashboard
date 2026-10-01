import { createServer, type Server } from "node:http";
import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findBusinessByPhoneNumber: vi.fn(),
  sendLeadNotificationEmail: vi.fn(),
  runNotificationOutboxNow: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  leadsTable: {},
  notificationEventsTable: {},
  retellCallRecordsTable: { retellCallId: "retell_call_id" },
}));

vi.mock("../../src/lib/businessDirectory", () => ({
  findBusinessByPhoneNumber: mocks.findBusinessByPhoneNumber,
}));

vi.mock("../../src/lib/gmail", () => ({
  sendLeadNotificationEmail: mocks.sendLeadNotificationEmail,
}));

vi.mock("../../src/lib/notificationService", () => ({
  runNotificationOutboxNow: mocks.runNotificationOutboxNow,
}));

import retellRouter from "../../src/routes/retell";

let server: Server;
let baseUrl: string;

const OTHER_DYNAMIC_VARIABLE_KEYS = [
  "business_name",
  "business_type",
  "service_area",
  "major_issue_examples",
  "pricing_policy",
  "personality_tone_description",
  "services_not_offered",
  "financing_policy",
  "brands_worked_with",
  "response_time_commitment",
  "warranty_info",
  "maintenance_plan_offerings",
  "credentials",
  "owner_availability",
  "emergency_contact_info",
] as const;

function makeBusiness(overrides: Record<string, unknown> = {}) {
  return {
    businessName: "Example Heating",
    agentName: null,
    businessType: null,
    serviceArea: null,
    majorIssueExamples: null,
    pricingPolicy: null,
    personalityToneDescription: null,
    servicesNotOffered: null,
    financingPolicy: null,
    brandsWorkedWith: null,
    typicalResponseTimeCommitment: null,
    warrantyInfo: null,
    maintenancePlanOfferings: null,
    credentialsCertifications: null,
    ownerAvailability: null,
    emergencyContactInfo: null,
    ...overrides,
  };
}

async function requestPreCall(toNumber = "+14155550123") {
  const response = await fetch(`${baseUrl}/webhooks/retell/pre-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ call_inbound: { to_number: toNumber } }),
  });
  return {
    status: response.status,
    body: await response.json() as {
      call_inbound: { dynamic_variables: Record<string, string> };
    },
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & {
      log: { warn: typeof vi.fn; error: typeof vi.fn; info: typeof vi.fn };
    }).log = {
      warn: mocks.logWarn,
      error: mocks.logError,
      info: mocks.logInfo,
    };
    next();
  });
  app.use(retellRouter);

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
  mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness());
});

describe("Retell pre-call dynamic variables", () => {
  it("defaults an explicitly blank receptionist name to Aria", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ agentName: "   " }));

    const response = await requestPreCall();

    expect(response.status).toBe(200);
    expect(response.body.call_inbound.dynamic_variables.agent_name).toBe("Aria");
  });

  it("passes through a saved receptionist name", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ agentName: "Maya" }));

    const response = await requestPreCall();

    expect(response.status).toBe(200);
    expect(response.body.call_inbound.dynamic_variables.agent_name).toBe("Maya");
  });

  it("defaults existing businesses with a null receptionist name to Aria", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ agentName: null }));

    const response = await requestPreCall();

    expect(response.body.call_inbound.dynamic_variables.agent_name).toBe("Aria");
  });

  it("returns every existing dynamic-variable key with empty-string fallbacks", async () => {
    const response = await requestPreCall();
    const dynamicVariables = response.body.call_inbound.dynamic_variables;

    expect(Object.keys(dynamicVariables).sort()).toEqual(
      ["agent_name", ...OTHER_DYNAMIC_VARIABLE_KEYS].sort(),
    );
    expect(dynamicVariables).toEqual({
      agent_name: "Aria",
      business_name: "Example Heating",
      business_type: "",
      service_area: "",
      major_issue_examples: "",
      pricing_policy: "",
      personality_tone_description: "",
      services_not_offered: "",
      financing_policy: "",
      brands_worked_with: "",
      response_time_commitment: "",
      warranty_info: "",
      maintenance_plan_offerings: "",
      credentials: "",
      owner_availability: "",
      emergency_contact_info: "",
    });
  });

  it("returns Aria and the full fallback-key set for an unknown number", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(null);

    const response = await requestPreCall("+14155550999");
    const dynamicVariables = response.body.call_inbound.dynamic_variables;

    expect(response.status).toBe(200);
    expect(dynamicVariables.agent_name).toBe("Aria");
    expect(Object.keys(dynamicVariables).sort()).toEqual(
      ["agent_name", ...OTHER_DYNAMIC_VARIABLE_KEYS].sort(),
    );
    expect(dynamicVariables.business_name).toBe("");
    expect(mocks.findBusinessByPhoneNumber).toHaveBeenCalledWith("+14155550999");
  });
});
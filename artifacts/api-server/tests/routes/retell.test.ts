import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findBusinessByPhoneNumber: vi.fn(),
  sendLeadNotificationEmail: vi.fn(),
  runNotificationOutboxNow: vi.fn(),
  persistAnalyzedCall: vi.fn(),
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
vi.mock("../../src/lib/retellPersistence", () => ({
  persistAnalyzedCall: mocks.persistAnalyzedCall,
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
  app.use(express.json({ verify: (req, _res, body) => {
    (req as express.Request).rawBody = body;
  } }));
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
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RETELL_API_KEY", "retell-unit-test-key");
  mocks.persistAnalyzedCall.mockResolvedValue({ id: 101, notify: true });
  mocks.sendLeadNotificationEmail.mockResolvedValue(undefined);
  mocks.runNotificationOutboxNow.mockResolvedValue(undefined);
  mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness());
});

const signedRequest = (path: string, body: string, timestamp = Date.now(), signedBody = body) => {
  const digest = createHmac("sha256", "retell-unit-test-key").update(signedBody).update(String(timestamp)).digest("hex");
  return fetch(`${baseUrl}/webhooks/retell/${path}`, {
    method: "POST", body,
    headers: { "content-type": "application/json", "x-retell-signature": `v=${timestamp},d=${digest}` },
  });
};

describe("Retell webhook safety", () => {
  it("allows missing pre-call signatures during the compatibility rollout and logs them", async () => {
    expect((await requestPreCall()).status).toBe(200);
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("allowing during compatibility"));
  });
  it("verifies valid pre-call signatures against the exact raw bytes", async () => {
    const raw = '{ "call_inbound": { "to_number" : "+14155550123" } }';
    expect((await signedRequest("pre-call", raw)).status).toBe(200);
  });
  it("rejects tampered and expired pre-call signatures before any business lookup", async () => {
    const raw = '{"call_inbound":{"to_number":"+14155550123"}}';
    expect((await signedRequest("pre-call", raw, Date.now(), raw + " ")).status).toBe(401);
    expect((await signedRequest("pre-call", raw, Date.now() - 6 * 60_000)).status).toBe(401);
    expect(mocks.findBusinessByPhoneNumber).not.toHaveBeenCalled();
  });
  it("does not send repeat alerts when an analyzed-call retry is already persisted", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 1, ownerEmail: "test@example.com" }));
    mocks.persistAnalyzedCall.mockResolvedValueOnce({ id: 101, notify: true }).mockResolvedValueOnce({ id: 101, notify: false });
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "call-test-1", to_number: "+14155550123", from_number: "+15551234567",
      call_analysis: { custom_analysis_data: { caller_name: "Test caller", issue_reason: "Test issue" } },
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.persistAnalyzedCall).toHaveBeenCalledTimes(2);
    expect(mocks.sendLeadNotificationEmail).toHaveBeenCalledOnce();
    expect(mocks.runNotificationOutboxNow).toHaveBeenCalledOnce();
  });
  it("keeps post-call signature verification mandatory", async () => {
    const response = await fetch(`${baseUrl}/webhooks/retell/post-call`, {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"event":"call_analyzed"}',
    });
    expect(response.status).toBe(401);
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
  });
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
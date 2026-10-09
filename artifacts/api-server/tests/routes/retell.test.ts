import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicVariables } from "../../src/lib/retellVariables";

const mocks = vi.hoisted(() => ({
  findBusinessByPhoneNumber: vi.fn(),
  sendLeadNotificationEmail: vi.fn(),
  runNotificationOutboxNow: vi.fn(),
  persistAnalyzedCall: vi.fn(),
  recordOperationalFailure: vi.fn(),
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
vi.mock("../../src/lib/operationalFailures", () => ({
  recordOperationalFailure: mocks.recordOperationalFailure,
}));

import retellRouter from "../../src/routes/retell";

let server: Server;
let baseUrl: string;

const OTHER_DYNAMIC_VARIABLE_KEYS = [
  "receptionist_tone_style", "receptionist_tone_guidance", "intake_trade", "trade_question_1", "trade_question_2",
  "business_hours", "time_zone", "current_local_time", "business_is_open", "next_opening", "transfer_available",
  "business_name",
  "business_type",
  "service_area",
  "major_issue_examples",
  "pricing_policy",
  "personality_tone_description",
  "services_not_offered",
  "services_offered",
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
  const response = await signedRequest(
    "pre-call",
    JSON.stringify({ call_inbound: { to_number: toNumber } }),
  );
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
  mocks.recordOperationalFailure.mockResolvedValue(true);
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
  it.each(["rejection", "synchronous error"])("answers generically when pre-call lookup has a %s", async kind => {
    if (kind === "rejection") mocks.findBusinessByPhoneNumber.mockRejectedValueOnce(new Error("Database unavailable"));
    else mocks.findBusinessByPhoneNumber.mockImplementationOnce(() => { throw new Error("Database unavailable"); });
    const result = await requestPreCall();
    expect(result).toEqual({ status: 200, body: { call_inbound: { dynamic_variables: dynamicVariables(null) } } });
    expect(mocks.logError).toHaveBeenCalledWith(
      { error: "Database unavailable" },
      expect.stringContaining("answering with generic"),
    );
    expect(mocks.recordOperationalFailure).toHaveBeenCalledWith(expect.objectContaining({
      source: "pre_call_fallback",
      summary: "Inbound business lookup failed; generic fallback used",
      details: expect.stringMatching(/Database unavailable|3500ms/),
    }));
  });

  it("bounds a stalled lookup to 3.5 seconds, returns generic variables, and handles a late rejection", async () => {
    let rejectLookup!: (error: Error) => void;
    mocks.findBusinessByPhoneNumber.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLookup = reject; }));
    const started = Date.now();
    const result = await requestPreCall();
    expect(Date.now() - started).toBeLessThan(6000);
    expect(result).toEqual({ status: 200, body: { call_inbound: { dynamic_variables: dynamicVariables(null) } } });
    expect(mocks.logError).toHaveBeenCalledWith(
      { error: expect.stringContaining("3500ms pre-call deadline") },
      expect.stringContaining("answering with generic"),
    );
    rejectLookup(new Error("Late database error"));
    await new Promise(resolve => setImmediate(resolve));
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("ignores an early empty call-ended event, then persists the analyzed call and callback", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 1, ownerEmail: "test@example.test" }));
    mocks.persistAnalyzedCall.mockResolvedValue({ id: 101, notify: false });
    const call = { call_id: "call-partial", to_number: "+14155550123", from_number: "+15559990000",
      transcript: "user: My pipe is leaking. I'm Sam.",
    };
    expect((await signedRequest("post-call", JSON.stringify({ event: "call_ended", call }))).status).toBe(204);
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
    expect((await signedRequest("post-call", JSON.stringify({ event: "call_analyzed", call: {
      ...call, call_analysis: { call_summary: "Sam has a leaking pipe.", custom_analysis_data: {
        "USER NAME": "Sam", ISSUE: "Leaking pipe", ADDRESS: "12 Test St", URGENCY: "today", AVAILABILITY: "afternoon",
        callback_number: "+15551230000",
      } },
    } }))).status).toBe(204);
    expect(mocks.persistAnalyzedCall.mock.calls[0]).toEqual([
      "call-partial", expect.objectContaining({ callerName: "Sam", issueReason: "Leaking pipe", address: "12 Test St",
        urgencyLevel: "today", availability: "afternoon", callerId: "+15559990000", callbackNumber: "+15551230000",
        phoneNumber: "+15551230000", transcript: call.transcript, summary: "Sam has a leaking pipe." }),
      expect.any(Object), true, true,
    ]);
  });
  it.each([
    { status: "error", duration_ms: 1500, call_analysis: { call_summary: "Some analysis" } },
    { status: "ended", duration_ms: 0, call_analysis: { call_summary: "Some analysis" } },
    { status: "ended", duration_ms: 1500, call_analysis: {} },
    { status: "ended", duration_ms: 1500, call_analysis: { call_summary: "   " } },
  ])("does not persist blank or failed calls %#", async state => {
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "blank-call", to_number: "+14155550123", ...state,
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.findBusinessByPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
    expect(mocks.recordOperationalFailure).not.toHaveBeenCalled();
  });
  it.each([
    { direction: "outbound" },
    { metadata: { corvlio_call_type: "owner_test" } },
  ])("never creates leads, call counts or alerts for signed test/outbound calls", async extra => {
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "test", to_number: "+15551230000", from_number: "+14155550123", ...extra,
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.findBusinessByPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
    expect(mocks.runNotificationOutboxNow).not.toHaveBeenCalled();
  });
  it("passes the saved disabled alert preference into persistence", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 1, leadAlertsEnabled: false }));
    mocks.persistAnalyzedCall.mockResolvedValue({ id: 101, notify: false });
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "real", to_number: "+14155550123", from_number: "+15551230000",
      call_analysis: { call_summary: "The caller has a leaking pipe." },
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.persistAnalyzedCall.mock.calls[0][4]).toBe(false);
    expect(mocks.runNotificationOutboxNow).not.toHaveBeenCalled();
  });
  it("rejects missing pre-call signatures before looking up a business", async () => {
    const response = await fetch(`${baseUrl}/webhooks/retell/pre-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call_inbound: { to_number: "+14155550123" } }),
    });
    expect(response.status).toBe(401);
    expect(mocks.findBusinessByPhoneNumber).not.toHaveBeenCalled();
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
    expect(mocks.sendLeadNotificationEmail).not.toHaveBeenCalled();
    expect(mocks.runNotificationOutboxNow).toHaveBeenCalledOnce();
  });
  it("keeps post-call signature verification mandatory", async () => {
    const response = await fetch(`${baseUrl}/webhooks/retell/post-call`, {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"event":"call_analyzed"}',
    });
    expect(response.status).toBe(401);
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
  });
  it("records authenticated post-call processing failures for admin alerting", async () => {
    mocks.findBusinessByPhoneNumber.mockRejectedValueOnce(new Error("Database unavailable"));
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "call-failure", to_number: "+14155550123",
      call_analysis: { call_summary: "The caller has a leaking pipe." },
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(500);
    expect(mocks.recordOperationalFailure).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: expect.stringMatching(/^retell-post-call:/),
      source: "post_call_webhook",
      summary: "Post-call webhook processing failed",
      details: "Database unavailable",
    }));
    expect(mocks.runNotificationOutboxNow).toHaveBeenCalledOnce();
  });
});

describe("Retell pre-call dynamic variables", () => {
  it("supplies current saved hours/timezone/policies and disables unsafe shared transfer", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({
      businessHours: "24/7", timeZone: "America/Phoenix", servicesNotOffered: "Electrical", emergencyContactInfo: "Call emergency services for danger",
    }));
    const vars = (await requestPreCall()).body.call_inbound.dynamic_variables;
    expect(vars).toMatchObject({ business_hours: "24/7", time_zone: "America/Phoenix", business_is_open: "true",
      services_not_offered: "Electrical", emergency_contact_info: "Call emergency services for danger", transfer_available: "false" });
    expect(vars.current_local_time).toBeTruthy();
  });
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

  it("passes reviewed services and preserves unknown hours rather than claiming the business is open", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({
      servicesOffered: "Heating repair and installation",
      businessHours: "",
      timeZone: "",
    }));
    const response = await requestPreCall();
    expect(response.body.call_inbound.dynamic_variables).toMatchObject({
      services_offered: "Heating repair and installation",
      business_hours: "", time_zone: "", business_is_open: "unknown", next_opening: "",
    });
  });

  it("returns every existing dynamic-variable key with safe optional-detail fallbacks", async () => {
    const response = await requestPreCall();
    const dynamicVariables = response.body.call_inbound.dynamic_variables;

    expect(Object.keys(dynamicVariables).sort()).toEqual(
      ["agent_name", ...OTHER_DYNAMIC_VARIABLE_KEYS].sort(),
    );
    expect(dynamicVariables).toMatchObject({
      agent_name: "Aria",
      business_name: "Example Heating",
      business_type: "",
      service_area: "Not provided. Do not guess whether an address is covered; take the caller's location and ask the owner to confirm.",
      major_issue_examples: "Not provided. Do not guess which issues the business handles; record the caller's issue and pass it to the owner.",
      pricing_policy: "Not provided. Do not quote or estimate prices; say the owner will follow up with a quote.",
      personality_tone_description: "Friendly and professional",
      services_not_offered: "Not provided. Do not claim or deny anything about this; offer to pass the question to the owner.",
      financing_policy: "Not provided. Do not make any promises about this; say the owner will cover it when they call back.",
      brands_worked_with: "Not provided. Do not claim or deny anything about this; offer to pass the question to the owner.",
      response_time_commitment: "Not provided. Say the owner will call back as soon as they can, without promising a specific time.",
      warranty_info: "Not provided. Do not make any promises about this; say the owner will cover it when they call back.",
      maintenance_plan_offerings: "Not provided. Do not claim or deny anything about this; offer to pass the question to the owner.",
      credentials: "Not provided. Do not claim or deny anything about this; offer to pass the question to the owner.",
      owner_availability: "Not provided. Take the caller's details and tell them the owner will be notified.",
      emergency_contact_info: "Not provided. Take the caller's details and tell them the owner will be notified.",
      business_hours: "",
      time_zone: "",
      transfer_available: "false",
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
    expect(dynamicVariables.business_name).toBe("our team");
    expect(mocks.findBusinessByPhoneNumber).toHaveBeenCalledWith("+14155550999");
  });
});
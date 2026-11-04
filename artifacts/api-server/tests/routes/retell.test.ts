import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicVariables } from "../../src/lib/retellVariables";
import { retellMalformedJsonAlertHandler } from "../../src/lib/retellWebhookAlerts";

const mocks = vi.hoisted(() => ({
  findBusinessByPhoneNumber: vi.fn(),
  getDefaultFallbackPhoneNumber: vi.fn(),
  sendLeadNotificationEmail: vi.fn(),
  runNotificationOutboxNow: vi.fn(),
  persistAnalyzedCall: vi.fn(),
  persistBlankCall: vi.fn(),
  recordOperationalFailure: vi.fn(),
  queueFounderPushNotification: vi.fn(),
  recordRetellSystemAlert: vi.fn(),
  recordRetellWebhookSuccess: vi.fn(),
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
vi.mock("../../src/lib/fallbackPhoneSettings", () => ({
  DEFAULT_FALLBACK_PHONE_NUMBER: "+18634463029",
  getDefaultFallbackPhoneNumber: mocks.getDefaultFallbackPhoneNumber,
}));

vi.mock("../../src/lib/gmail", () => ({
  sendLeadNotificationEmail: mocks.sendLeadNotificationEmail,
}));

vi.mock("../../src/lib/notificationService", () => ({
  runNotificationOutboxNow: mocks.runNotificationOutboxNow,
}));
vi.mock("../../src/lib/retellPersistence", () => ({
  persistAnalyzedCall: mocks.persistAnalyzedCall,
  persistBlankCall: mocks.persistBlankCall,
}));
vi.mock("../../src/lib/operationalFailures", () => ({
  recordOperationalFailure: mocks.recordOperationalFailure,
  queueFounderPushNotification: mocks.queueFounderPushNotification,
}));
vi.mock("../../src/lib/retellSystemAlerts", () => ({
  recordRetellSystemAlert: mocks.recordRetellSystemAlert,
  recordRetellWebhookSuccess: mocks.recordRetellWebhookSuccess,
}));

import retellRouter from "../../src/routes/retell";

let server: Server;
let baseUrl: string;

const OTHER_DYNAMIC_VARIABLE_KEYS = [
  "allowed_promise_policy",
  "receptionist_tone_style", "receptionist_tone_guidance", "intake_trade", "trade_question_1", "trade_question_2",
  "business_hours", "time_zone", "current_local_time", "business_is_open", "next_opening", "transfer_available",
  "business_name",
  "fallback_phone_number",
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
  "emergency_escalation_phone",
  "emergency_services_available",
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
  app.use(retellMalformedJsonAlertHandler);

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
  mocks.persistBlankCall.mockResolvedValue({ inserted: true, triggerStreakAlert: false, streakStartCallId: null });
  mocks.sendLeadNotificationEmail.mockResolvedValue(undefined);
  mocks.runNotificationOutboxNow.mockResolvedValue(undefined);
  mocks.recordOperationalFailure.mockResolvedValue(true);
  mocks.queueFounderPushNotification.mockResolvedValue(true);
  mocks.recordRetellSystemAlert.mockResolvedValue(undefined);
  mocks.recordRetellWebhookSuccess.mockResolvedValue(undefined);
  mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness());
  mocks.getDefaultFallbackPhoneNumber.mockResolvedValue("+18634463029");
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
      expect.objectContaining({ databaseError: expect.objectContaining({ message: "Database unavailable" }) }),
      expect.stringContaining("answering with generic"),
    );
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "pre-call",
      category: "pre_call_error",
      summary: "Inbound business lookup failed; generic fallback used",
      details: "Database unavailable",
    }));
  });

  it("includes the per-business resolved fallback number in pre-call variables", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValueOnce(makeBusiness({
      fallbackPhoneNumber: "+16505550123",
    }));
    const result = await requestPreCall();
    expect(result.status).toBe(200);
    expect(result.body.call_inbound.dynamic_variables.fallback_phone_number).toBe("+16505550123");
    expect(mocks.recordRetellWebhookSuccess).toHaveBeenCalledWith("pre-call");
  });

  it("uses the configured global fallback when the business has no override", async () => {
    mocks.getDefaultFallbackPhoneNumber.mockResolvedValueOnce("+12025550123");
    const result = await requestPreCall();
    expect(result.body.call_inbound.dynamic_variables.fallback_phone_number).toBe("+12025550123");
  });

  it("bounds a stalled lookup to 3.5 seconds, returns generic variables, and handles a late rejection", async () => {
    let rejectLookup!: (error: Error) => void;
    mocks.findBusinessByPhoneNumber.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLookup = reject; }));
    const started = Date.now();
    const result = await requestPreCall();
    expect(Date.now() - started).toBeLessThan(6000);
    expect(result).toEqual({ status: 200, body: { call_inbound: { dynamic_variables: dynamicVariables(null) } } });
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.objectContaining({ databaseError: expect.objectContaining({ message: expect.stringContaining("3500ms pre-call deadline") }) }),
      expect.stringContaining("answering with generic"),
    );
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: "retell:pre-call:business-lookup-timeout",
      category: "pre_call_timeout",
    }));
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
    expect(mocks.persistBlankCall).not.toHaveBeenCalled();
    expect(mocks.recordOperationalFailure).not.toHaveBeenCalled();
    expect(mocks.findBusinessByPhoneNumber).not.toHaveBeenCalled();
    expect((await signedRequest("post-call", JSON.stringify({ event: "call_analyzed", call: {
      ...call, recording_url: "https://recordings.example.test/call-partial.wav",
      call_analysis: { call_summary: "Sam has a leaking pipe.", custom_analysis_data: {
        "USER NAME": "Sam", ISSUE: "Leaking pipe", ADDRESS: "12 Test St", URGENCY: "today", AVAILABILITY: "afternoon",
        callback_number: "+15551230000",
      } },
    } }))).status).toBe(204);
    expect(mocks.persistAnalyzedCall.mock.calls[0]).toEqual([
      "call-partial", expect.objectContaining({ callerName: "Sam", issueReason: "Leaking pipe", address: "12 Test St",
        urgencyLevel: "today", availability: "afternoon", callerId: "+15559990000", callbackNumber: "+15551230000",
        phoneNumber: "+15551230000", transcript: call.transcript, summary: "Sam has a leaking pipe.",
        recordingUrl: "https://recordings.example.test/call-partial.wav" }),
      expect.any(Object), true, true,
    ]);
  });
  it.each([
    { status: "error", duration_ms: 1500, call_analysis: { call_summary: "Some analysis" } },
    { status: "ended", duration_ms: 0, call_analysis: { call_summary: "Some analysis" } },
    { status: "ended", duration_ms: 1500, call_analysis: {} },
    { status: "ended", duration_ms: 1500, call_analysis: { call_summary: "   " } },
  ])("does not persist blank or failed calls %#", async state => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 1, businessName: "Example Heating" }));
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "blank-call", to_number: "+14155550123", ...state,
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.findBusinessByPhoneNumber).toHaveBeenCalledWith("+14155550123");
    expect(mocks.persistBlankCall).toHaveBeenCalledWith("blank-call", expect.objectContaining({
      businessId: 1, callStartedAt: null,
    }));
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
    expect(mocks.recordOperationalFailure).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: "retell-blank:blank-call",
      summary: "Blank or failed call",
      businessId: 1,
      businessName: "Example Heating",
      suppressAlert: true,
    }));
  });
  it("records unmatched post-call incidents without storing the full number or transcript", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValueOnce(undefined);
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "unmatched-call-42", to_number: "+14155550999", start_timestamp: 1_800_000_000_000,
      duration_ms: 12000, transcript: "Never include this transcript in an alert",
      call_analysis: { call_summary: "An intake summary" },
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "post-call",
      category: "unmatched_business",
      summary: "Post-call event did not match a business",
      details: expect.stringContaining("destination ends in 0999"),
    }));
    const alert = mocks.recordRetellSystemAlert.mock.calls[0][0];
    expect(alert.details).not.toContain("+14155550999");
    expect(alert.details).not.toContain("Never include this transcript");
    expect(mocks.recordRetellWebhookSuccess).not.toHaveBeenCalled();
  });
  it("alerts once when the third consecutive blank call is recorded", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 7, businessName: "Oak Plumbing" }));
    mocks.persistBlankCall.mockResolvedValue({
      inserted: true, triggerStreakAlert: true, streakStartCallId: "blank-1",
    });
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "blank-3", to_number: "+14155550123", duration_ms: 0, call_analysis: {},
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.recordOperationalFailure).toHaveBeenCalledTimes(2);
    expect(mocks.recordOperationalFailure).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventKey: "retell-blank:blank-3", suppressAlert: true,
    }));
    expect(mocks.recordOperationalFailure).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventKey: "retell-blank-streak:7:blank-1",
      summary: "Three consecutive blank or failed calls",
    }));
    expect(mocks.queueFounderPushNotification).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: "retell-blank-streak:7:blank-1",
    }));
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
  it("allows missing pre-call signatures during rollout and logs them", async () => {
    const response = await fetch(`${baseUrl}/webhooks/retell/pre-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call_inbound: { to_number: "+14155550123" } }),
    });
    expect(response.status).toBe(200);
    expect(mocks.findBusinessByPhoneNumber).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("without a signature"));
    expect(mocks.recordRetellSystemAlert).not.toHaveBeenCalled();
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
  it("keeps the saved lead and acknowledges the webhook when notification delivery rejects", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 1, ownerEmail: "test@example.com" }));
    mocks.persistAnalyzedCall.mockResolvedValueOnce({ id: 101, notify: true });
    mocks.runNotificationOutboxNow.mockRejectedValueOnce(new Error("Gmail API disabled"));
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "call-email-failure", to_number: "+14155550123", from_number: "+15551234567",
      call_analysis: { custom_analysis_data: { caller_name: "Test caller", issue_reason: "Test issue" } },
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(204);
    expect(mocks.persistAnalyzedCall).toHaveBeenCalledOnce();
    expect(mocks.runNotificationOutboxNow).toHaveBeenCalledOnce();
    expect(mocks.persistAnalyzedCall.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.runNotificationOutboxNow.mock.invocationCallOrder[0]);
  });
  it("allows missing post-call signatures during rollout and logs them", async () => {
    mocks.findBusinessByPhoneNumber.mockResolvedValue(makeBusiness({ id: 1, ownerEmail: "test@example.com" }));
    mocks.persistAnalyzedCall.mockResolvedValueOnce({ id: 101, notify: false });
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "call-missing-signature", to_number: "+14155550123", from_number: "+15551234567",
      call_analysis: { custom_analysis_data: { caller_name: "Test caller", issue_reason: "Test issue" } },
    } });
    const response = await fetch(`${baseUrl}/webhooks/retell/post-call`, {
      method: "POST", headers: { "content-type": "application/json" }, body: raw,
    });
    expect(response.status).toBe(204);
    expect(mocks.persistAnalyzedCall).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("without a signature"));
    expect(mocks.recordRetellSystemAlert).not.toHaveBeenCalled();
  });
  it("rejects present invalid post-call signatures", async () => {
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "call-invalid-signature", to_number: "+14155550123", from_number: "+15551234567",
    } });
    const response = await fetch(`${baseUrl}/webhooks/retell/post-call`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-retell-signature": "invalid" },
      body: raw,
    });
    expect(response.status).toBe(401);
    expect(mocks.persistAnalyzedCall).not.toHaveBeenCalled();
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: "retell:post-call:invalid_signature",
      endpoint: "post-call",
      summary: expect.stringContaining("invalid signature"),
    }));
  });
  it("uses a stable issue key for repeated webhook rejections", async () => {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${baseUrl}/webhooks/retell/post-call`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-retell-signature": "invalid" },
        body: '{"event":"call_analyzed"}',
      });
      expect(response.status).toBe(401);
    }
    const alertCalls = mocks.recordRetellSystemAlert.mock.calls.map(([input]) => input);
    expect(alertCalls).toHaveLength(2);
    expect(alertCalls[0].issueKey).toBe(alertCalls[1].issueKey);
  });
  it("records malformed signed payloads and malformed JSON through the rate-limited alert path", async () => {
    const invalidPayload = await signedRequest("post-call", JSON.stringify({ event: "call_analyzed" }));
    expect(invalidPayload.status).toBe(400);
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: "retell:post-call:malformed_payload",
      endpoint: "post-call",
      summary: expect.stringContaining("malformed payload"),
    }));

    const malformedJson = await fetch(`${baseUrl}/webhooks/retell/pre-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"call_inbound":',
    });
    expect(malformedJson.status).toBe(400);
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: "retell:pre-call:malformed_payload",
      endpoint: "pre-call",
      summary: expect.stringContaining("malformed payload"),
    }));
  });
  it("records authenticated post-call processing failures for admin alerting", async () => {
    mocks.findBusinessByPhoneNumber.mockRejectedValueOnce(new Error("Database unavailable"));
    const raw = JSON.stringify({ event: "call_analyzed", call: {
      call_id: "call-failure", to_number: "+14155550123",
      call_analysis: { call_summary: "The caller has a leaking pipe." },
    } });
    expect((await signedRequest("post-call", raw)).status).toBe(500);
    expect(mocks.recordRetellSystemAlert).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: "retell:post-call:processing-error:unknown",
      endpoint: "post-call",
      source: "post_call_webhook",
      summary: "Post-call webhook processing failed",
      details: "Database unavailable",
    }));
    expect(mocks.runNotificationOutboxNow).not.toHaveBeenCalled();
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
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ownerSmsRouter from "../../src/routes/ownerSms";

const services = vi.hoisted(() => ({
  getAdminSmsDeliveryFailures: vi.fn(),
  getOwnerSmsReadiness: vi.fn(),
  isConfiguredTwilioAccount: vi.fn(),
  sendTrackedSms: vi.fn(),
  updateOwnerSmsConsentByPhone: vi.fn(),
  updateSmsStatusFromWebhook: vi.fn(),
  validateTwilioWebhook: vi.fn(),
}));

vi.mock("../../src/lib/ownerSms", () => services);
vi.mock("../../src/middlewares/requireAdmin", () => ({
  requireAdmin: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.adminEmail = "admin@example.test";
    next();
  },
}));

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl = "";

beforeEach(async () => {
  vi.clearAllMocks();
  services.getOwnerSmsReadiness.mockReturnValue({ ready: false });
  services.isConfiguredTwilioAccount.mockReturnValue(true);
  services.validateTwilioWebhook.mockReturnValue(true);
  services.sendTrackedSms.mockResolvedValue({
    id: 17,
    status: "queued",
    twilioMessageSid: "SM-test",
    errorCode: null,
  });
  services.getAdminSmsDeliveryFailures.mockResolvedValue([]);

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(ownerSmsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function postForm(path: string, params: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "signed-test-request",
    },
    body: new URLSearchParams(params),
  });
}

describe("owner SMS webhook and admin routes", () => {
  it.each([
    ["STOP", false],
    ["UNSUBSCRIBE", false],
    ["START", true],
    ["UNSTOP", true],
    ["YES", true],
  ])("updates owner consent for %s", async (command, enabled) => {
    const response = await postForm("/sms/twilio/inbound", {
      AccountSid: "AC-test",
      From: "+15551234567",
      Body: command,
      MessageSid: "SM-inbound",
    });
    expect(response.status).toBe(200);
    expect(services.validateTwilioWebhook).toHaveBeenCalledWith(
      "signed-test-request",
      expect.objectContaining({ Body: command }),
      "inbound",
    );
    expect(services.updateOwnerSmsConsentByPhone).toHaveBeenCalledWith("+15551234567", enabled);
    expect(services.sendTrackedSms).not.toHaveBeenCalled();
  });

  it("does not process unsigned inbound messages", async () => {
    services.validateTwilioWebhook.mockReturnValue(false);
    const response = await postForm("/sms/twilio/inbound", {
      AccountSid: "AC-test",
      From: "+15551234567",
      Body: "STOP",
    });
    expect(response.status).toBe(403);
    expect(services.updateOwnerSmsConsentByPhone).not.toHaveBeenCalled();
  });

  it("sends a tracked HELP reply only when SMS is ready", async () => {
    services.getOwnerSmsReadiness.mockReturnValue({ ready: true });
    const response = await postForm("/sms/twilio/inbound", {
      AccountSid: "AC-test",
      From: "+15551234567",
      Body: "HELP",
    });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(services.sendTrackedSms).toHaveBeenCalledWith(expect.objectContaining({
      category: "help_reply",
      to: "+15551234567",
      body: expect.stringContaining("hello@corvlio.com"),
    }));
  });

  it("records signed delivery callbacks against their message row", async () => {
    const response = await postForm("/sms/twilio/status?messageId=42", {
      AccountSid: "AC-test",
      MessageSid: "SM-test",
      MessageStatus: "undelivered",
      ErrorCode: "30003",
    });
    expect(response.status).toBe(204);
    expect(services.validateTwilioWebhook).toHaveBeenCalledWith(
      "signed-test-request",
      expect.objectContaining({ MessageStatus: "undelivered" }),
      "status",
      42,
    );
    expect(services.updateSmsStatusFromWebhook).toHaveBeenCalledWith(42, "SM-test", "undelivered", "30003");
  });

  it("blocks admin test texts while SMS is off", async () => {
    const response = await fetch(`${baseUrl}/admin/sms/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "c38d4fb5-1b0f-4bb0-9318-9d3d3a5fa08a", to: "+15551234567" }),
    });
    expect(response.status).toBe(409);
    expect(services.sendTrackedSms).not.toHaveBeenCalled();
  });

  it("sends one admin test text to the entered mobile number when ready", async () => {
    services.getOwnerSmsReadiness.mockReturnValue({ ready: true });
    const response = await fetch(`${baseUrl}/admin/sms/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "c38d4fb5-1b0f-4bb0-9318-9d3d3a5fa08a", to: "+15551234567" }),
    });
    expect(response.status).toBe(200);
    expect(services.sendTrackedSms).toHaveBeenCalledTimes(1);
    expect(services.sendTrackedSms).toHaveBeenCalledWith(expect.objectContaining({
      category: "test",
      to: "+15551234567",
      requestId: "c38d4fb5-1b0f-4bb0-9318-9d3d3a5fa08a",
      adminEmail: "admin@example.test",
    }));
  });
});

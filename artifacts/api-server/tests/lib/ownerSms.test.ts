import { afterEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";

vi.mock("@workspace/db", () => ({
  db: {},
  businessesTable: {},
  leadsTable: {},
  ownerSmsMessagesTable: {},
}));

import {
  getOwnerSmsReadiness,
  isConfiguredTwilioAccount,
  validateTwilioWebhook,
} from "../../src/lib/ownerSms";

afterEach(() => {
  vi.unstubAllEnvs();
});

const authToken = "not-a-real-token-used-only-for-signature-tests";
const inboundUrl = "https://api.example.test/api/sms/twilio/inbound";
const completeEnv = {
  SMS_ENABLED: "true",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_API_KEY_SID: `SK${"b".repeat(32)}`,
  TWILIO_API_KEY_SECRET: "test-api-secret",
  TWILIO_MESSAGING_SERVICE_SID: `MG${"c".repeat(32)}`,
  TWILIO_AUTH_TOKEN: authToken,
  TWILIO_INBOUND_WEBHOOK_URL: inboundUrl,
} as NodeJS.ProcessEnv;

describe("owner SMS readiness and webhook validation", () => {
  it("is off and not ready when no configuration is present", () => {
    expect(getOwnerSmsReadiness({} as NodeJS.ProcessEnv)).toMatchObject({
      smsEnabled: false,
      ready: false,
      accountSidPresent: false,
      apiKeySidPresent: false,
      apiKeySecretPresent: false,
      messagingServiceSidPresent: false,
      authTokenPresent: false,
      inboundWebhookUrlSet: false,
    });
  });

  it("requires the enable flag, every secret, and a valid HTTPS inbound URL", () => {
    expect(getOwnerSmsReadiness(completeEnv).ready).toBe(true);
    expect(getOwnerSmsReadiness({ ...completeEnv, SMS_ENABLED: "false" }).ready).toBe(false);
    expect(getOwnerSmsReadiness({ ...completeEnv, TWILIO_AUTH_TOKEN: "" }).ready).toBe(false);
    expect(getOwnerSmsReadiness({
      ...completeEnv,
      TWILIO_INBOUND_WEBHOOK_URL: "http://api.example.test/api/sms/twilio/inbound",
    }).ready).toBe(false);
  });

  it("validates inbound signatures against the configured URL and account token", () => {
    const params = {
      AccountSid: completeEnv.TWILIO_ACCOUNT_SID!,
      From: "+15551234567",
      Body: "STOP",
      MessageSid: "SM123",
    };
    const signature = twilio.getExpectedTwilioSignature(authToken, inboundUrl, params);
    expect(validateTwilioWebhook(signature, params, "inbound", undefined, completeEnv)).toBe(true);
    expect(validateTwilioWebhook(signature, params, "inbound", undefined, {
      ...completeEnv,
      TWILIO_AUTH_TOKEN: "different-token",
    })).toBe(false);
  });

  it("signs delivery callbacks with the per-message callback URL", () => {
    const callbackUrl = `${inboundUrl.replace(/\/inbound$/, "/status")}?messageId=42`;
    const params = {
      AccountSid: completeEnv.TWILIO_ACCOUNT_SID!,
      MessageSid: "SM123",
      MessageStatus: "delivered",
    };
    const signature = twilio.getExpectedTwilioSignature(authToken, callbackUrl, params);
    expect(validateTwilioWebhook(signature, params, "status", 42, completeEnv)).toBe(true);
    expect(validateTwilioWebhook(signature, params, "status", 43, completeEnv)).toBe(false);
  });

  it("requires callbacks to belong to the configured Twilio account", () => {
    expect(isConfiguredTwilioAccount(completeEnv.TWILIO_ACCOUNT_SID, completeEnv)).toBe(true);
    expect(isConfiguredTwilioAccount("ACdifferent", completeEnv)).toBe(false);
  });
});

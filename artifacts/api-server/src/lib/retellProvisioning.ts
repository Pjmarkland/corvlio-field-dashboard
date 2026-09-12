import {
  type Business as DatabaseBusiness,
  type NewBusiness,
} from "@workspace/db";
import { createBusiness } from "./businessDirectory";

const PRE_CALL_WEBHOOK_PATH = "/api/webhooks/retell/pre-call";

export type BusinessProvisioningInput = Omit<
  NewBusiness,
  "id" | "retellPhoneNumber" | "retellAgentId" | "createdAt" | "updatedAt"
>;

export type RetellPhoneNumberOptions = {
  areaCode?: number;
  countryCode?: string;
  tollFree?: boolean;
  nickname?: string;
};

type RetellPhoneNumberResponse = {
  phone_number?: unknown;
};

function requireEnvironment() {
  const apiBaseUrl = process.env.RETELL_API_BASE_URL;
  const apiKey = process.env.RETELL_API_KEY;
  const sharedAgentId = process.env.RETELL_SHARED_AGENT_ID;
  const publicApiBaseUrl =
    process.env.PUBLIC_API_BASE_URL ?? process.env.VITE_NATIVE_API_BASE_URL;

  if (!apiBaseUrl) {
    throw new Error("RETELL_API_BASE_URL is not configured");
  }
  if (!apiKey) {
    throw new Error("RETELL_API_KEY is not configured");
  }
  if (!sharedAgentId) {
    throw new Error("RETELL_SHARED_AGENT_ID is not configured");
  }
  if (!publicApiBaseUrl) {
    throw new Error(
      "PUBLIC_API_BASE_URL is not configured; it is required for the Retell inbound webhook URL",
    );
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    apiKey,
    sharedAgentId,
    publicApiBaseUrl: publicApiBaseUrl.replace(/\/+$/, ""),
  };
}

function buildCreatePhoneNumberPayload(
  sharedAgentId: string,
  inboundWebhookUrl: string,
  options: RetellPhoneNumberOptions,
) {
  return {
    inbound_agents: [
      {
        agent_id: sharedAgentId,
        weight: 1,
        agent_version: "latest_published",
      },
    ],
    inbound_webhook_url: inboundWebhookUrl,
    ...(options.areaCode === undefined ? {} : { area_code: options.areaCode }),
    ...(options.countryCode === undefined ? {} : { country_code: options.countryCode }),
    ...(options.tollFree === undefined ? {} : { toll_free: options.tollFree }),
    ...(options.nickname === undefined ? {} : { nickname: options.nickname }),
  };
}

export async function provisionBusinessPhoneNumber(
  businessInfo: BusinessProvisioningInput,
  options: RetellPhoneNumberOptions = {},
): Promise<DatabaseBusiness> {
  const {
    apiBaseUrl,
    apiKey,
    sharedAgentId,
    publicApiBaseUrl,
  } = requireEnvironment();
  const inboundWebhookUrl = `${publicApiBaseUrl}${PRE_CALL_WEBHOOK_PATH}`;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/create-phone-number`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildCreatePhoneNumberPayload(sharedAgentId, inboundWebhookUrl, options),
      ),
    });
  } catch (error) {
    throw new Error(
      `Retell phone number provisioning request failed: ${
        error instanceof Error ? error.message : "Unknown network error"
      }`,
    );
  }

  const responseText = await response.text();
  let responseBody: RetellPhoneNumberResponse = {};
  try {
    responseBody = JSON.parse(responseText) as RetellPhoneNumberResponse;
  } catch {
    // The response text is included in the error below when Retell does not
    // return JSON, but is never used to create a business record.
  }

  if (!response.ok) {
    throw new Error(
      `Retell phone number provisioning failed (${response.status} ${response.statusText}): ${
        responseText || "No response body"
      }`,
    );
  }

  if (typeof responseBody.phone_number !== "string" || !responseBody.phone_number.trim()) {
    throw new Error(
      "Retell phone number provisioning succeeded without returning a phone number",
    );
  }

  return createBusiness({
    ...businessInfo,
    retellPhoneNumber: responseBody.phone_number,
    retellAgentId: sharedAgentId,
  });
}
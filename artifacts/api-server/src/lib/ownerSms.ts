import { and, desc, eq, inArray, sql } from "drizzle-orm";
import twilio from "twilio";
import {
  businessesTable,
  db,
  leadsTable,
  ownerSmsMessagesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { recordOperationalFailure } from "./operationalFailures";
import { runNotificationOutboxNow } from "./notificationService";

export type OwnerSmsCategory = "lead_alert" | "test" | "help_reply";
export type OwnerSmsStatus = "queued" | "sent" | "delivered" | "failed" | "undelivered";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
const API_KEY_SID_PATTERN = /^SK[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_RANK: Record<OwnerSmsStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  failed: 2,
  undelivered: 2,
};

export class SmsNotReadyError extends Error {
  constructor() {
    super("SMS is disabled or missing required configuration.");
    this.name = "SmsNotReadyError";
  }
}

function isHttpsWebhookUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname.replace(/\/+$/, "").endsWith("/api/sms/twilio/inbound");
  } catch {
    return false;
  }
}

export function getOwnerSmsReadiness(env: NodeJS.ProcessEnv = process.env) {
  const accountSidPresent = Boolean(env.TWILIO_ACCOUNT_SID);
  const accountSidValid = ACCOUNT_SID_PATTERN.test(env.TWILIO_ACCOUNT_SID ?? "");
  const apiKeySidPresent = Boolean(env.TWILIO_API_KEY_SID);
  const apiKeySidValid = API_KEY_SID_PATTERN.test(env.TWILIO_API_KEY_SID ?? "");
  const apiKeySecretPresent = Boolean(env.TWILIO_API_KEY_SECRET);
  const messagingServiceSidPresent = Boolean(env.TWILIO_MESSAGING_SERVICE_SID);
  const messagingServiceSidValid = MESSAGING_SERVICE_SID_PATTERN.test(env.TWILIO_MESSAGING_SERVICE_SID ?? "");
  const authTokenPresent = Boolean(env.TWILIO_AUTH_TOKEN);
  const inboundWebhookUrlSet = Boolean(env.TWILIO_INBOUND_WEBHOOK_URL);
  const inboundWebhookUrlValid = isHttpsWebhookUrl(env.TWILIO_INBOUND_WEBHOOK_URL);
  const smsEnabled = env.SMS_ENABLED === "true";
  const credentialsValid = accountSidValid
    && apiKeySidValid
    && apiKeySecretPresent
    && messagingServiceSidValid
    && authTokenPresent;

  return {
    smsEnabled,
    ready: smsEnabled && credentialsValid && inboundWebhookUrlValid,
    accountSidPresent,
    accountSidValid,
    apiKeySidPresent,
    apiKeySidValid,
    apiKeySecretPresent,
    messagingServiceSidPresent,
    messagingServiceSidValid,
    authTokenPresent,
    inboundWebhookUrlSet,
    inboundWebhookUrlValid,
  };
}

function createTwilioClient(env: NodeJS.ProcessEnv = process.env) {
  const readiness = getOwnerSmsReadiness(env);
  if (!readiness.ready) throw new SmsNotReadyError();
  return twilio(env.TWILIO_API_KEY_SID!, env.TWILIO_API_KEY_SECRET!, {
    accountSid: env.TWILIO_ACCOUNT_SID!,
  });
}

function makeStatusCallbackUrl(messageId: number, env: NodeJS.ProcessEnv = process.env): string {
  if (!isHttpsWebhookUrl(env.TWILIO_INBOUND_WEBHOOK_URL)) throw new SmsNotReadyError();
  const url = new URL(env.TWILIO_INBOUND_WEBHOOK_URL!);
  url.pathname = url.pathname.replace(/\/inbound\/?$/, "/status");
  url.searchParams.set("messageId", String(messageId));
  return url.toString();
}

function makeWebhookUrl(kind: "inbound" | "status", messageId?: number, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isHttpsWebhookUrl(env.TWILIO_INBOUND_WEBHOOK_URL)) return null;
  const url = new URL(env.TWILIO_INBOUND_WEBHOOK_URL!);
  if (kind === "status") {
    if (!messageId || !Number.isInteger(messageId) || messageId < 1) return null;
    url.pathname = url.pathname.replace(/\/inbound\/?$/, "/status");
    url.searchParams.set("messageId", String(messageId));
  }
  return url.toString();
}

export function validateTwilioWebhook(
  signature: string | undefined,
  params: Record<string, unknown>,
  kind: "inbound" | "status",
  messageId?: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const authToken = env.TWILIO_AUTH_TOKEN;
  const url = makeWebhookUrl(kind, messageId, env);
  if (!authToken || !signature || !url) return false;
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch {
    return false;
  }
}

export function isConfiguredTwilioAccount(accountSid: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof accountSid === "string"
    && Boolean(env.TWILIO_ACCOUNT_SID)
    && accountSid === env.TWILIO_ACCOUNT_SID;
}

function canonicalStatus(value: unknown): OwnerSmsStatus | null {
  if (typeof value !== "string") return null;
  const status = value.toLowerCase();
  if (status === "accepted" || status === "scheduled" || status === "canceled") return "queued";
  if (status === "sending") return "sent";
  if (status === "queued" || status === "sent" || status === "delivered"
    || status === "failed" || status === "undelivered") return status;
  return null;
}

async function updateMessageStatus(
  id: number,
  messageSid: string | null,
  status: OwnerSmsStatus,
  errorCode: string | null,
): Promise<OwnerSmsStatus | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(ownerSmsMessagesTable)
      .where(eq(ownerSmsMessagesTable.id, id))
      .for("update")
      .limit(1);
    if (!current) return null;
    if (messageSid && current.twilioMessageSid && current.twilioMessageSid !== messageSid) {
      return current.status;
    }

    const currentIsFinal = current.status === "delivered"
      || current.status === "failed"
      || current.status === "undelivered";
    const nextStatus = currentIsFinal || STATUS_RANK[status] < STATUS_RANK[current.status]
      ? current.status
      : status;
    const sidChanged = Boolean(messageSid && !current.twilioMessageSid);
    const statusChanged = nextStatus !== current.status;
    await tx.update(ownerSmsMessagesTable)
      .set({
        twilioMessageSid: messageSid ?? current.twilioMessageSid,
        status: nextStatus,
        errorCode: errorCode ?? current.errorCode,
        statusUpdatedAt: sidChanged || statusChanged ? new Date() : current.statusUpdatedAt,
      })
      .where(eq(ownerSmsMessagesTable.id, id));
    return nextStatus;
  });
}

function getProviderErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return String(code).slice(0, 64);
  }
  return "SEND_FAILED";
}

export interface SendTrackedSmsInput {
  category: OwnerSmsCategory;
  to: string;
  body: string;
  businessId?: number | null;
  leadId?: number | null;
  adminEmail?: string | null;
  requestId?: string;
}

export interface SendTrackedSmsResult {
  id: number;
  status: OwnerSmsStatus;
  twilioMessageSid: string | null;
  errorCode: string | null;
  alreadySent?: boolean;
}

export async function sendTrackedSms(input: SendTrackedSmsInput): Promise<SendTrackedSmsResult> {
  if (!getOwnerSmsReadiness().ready || !E164_PATTERN.test(input.to)) throw new SmsNotReadyError();
  if (input.category === "test" && !input.requestId) {
    throw new Error("An idempotency ID is required for an admin test text.");
  }
  if (input.requestId && !UUID_PATTERN.test(input.requestId)) {
    throw new Error("Invalid SMS request ID.");
  }

  const [message] = await db.insert(ownerSmsMessagesTable).values({
    businessId: input.businessId ?? null,
    leadId: input.leadId ?? null,
    category: input.category,
    recipientPhone: input.to,
    adminEmail: input.adminEmail ?? null,
    requestId: input.requestId ?? null,
    status: "queued",
  }).onConflictDoNothing().returning();

  if (!message) {
    if (input.requestId) {
      const [existing] = await db.select().from(ownerSmsMessagesTable)
        .where(eq(ownerSmsMessagesTable.requestId, input.requestId))
        .limit(1);
      if (existing) {
        return {
          id: existing.id,
          status: existing.status,
          twilioMessageSid: existing.twilioMessageSid,
          errorCode: existing.errorCode,
          alreadySent: true,
        };
      }
    }
    if (input.category === "lead_alert" && input.businessId != null && input.leadId != null) {
      const [existing] = await db.select().from(ownerSmsMessagesTable).where(and(
        eq(ownerSmsMessagesTable.businessId, input.businessId),
        eq(ownerSmsMessagesTable.leadId, input.leadId),
        eq(ownerSmsMessagesTable.category, "lead_alert"),
      )).limit(1);
      if (existing) {
        return {
          id: existing.id,
          status: existing.status,
          twilioMessageSid: existing.twilioMessageSid,
          errorCode: existing.errorCode,
          alreadySent: true,
        };
      }
    }
    throw new Error("SMS message could not be logged; no text was sent.");
  }

  try {
    const sent = await createTwilioClient().messages.create({
      to: input.to,
      body: input.body.slice(0, 1500),
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID!,
      statusCallback: makeStatusCallbackUrl(message.id),
    });
    const status = canonicalStatus(sent.status) ?? "queued";
    const savedStatus = await updateMessageStatus(
      message.id,
      sent.sid,
      status,
      sent.errorCode == null ? null : String(sent.errorCode),
    );
    return {
      id: message.id,
      status: savedStatus ?? status,
      twilioMessageSid: sent.sid,
      errorCode: sent.errorCode == null ? null : String(sent.errorCode),
    };
  } catch (error) {
    const errorCode = getProviderErrorCode(error);
    await updateMessageStatus(message.id, null, "failed", errorCode);
    return {
      id: message.id,
      status: "failed",
      twilioMessageSid: null,
      errorCode,
    };
  }
}

function compact(value: string | null | undefined, maxLength: number): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return "Not captured";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export async function sendOwnerLeadSms(businessId: number, leadId: number): Promise<void> {
  if (!getOwnerSmsReadiness().ready) return;

  const [[business], [lead]] = await Promise.all([
    db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1),
    db.select().from(leadsTable).where(and(
      eq(leadsTable.id, leadId),
      eq(leadsTable.businessId, businessId),
    )).limit(1),
  ]);
  if (!business || !lead || business.isInternal || business.isSample
    || !business.smsAlertsConsent || !business.leadAlertsEnabled) return;

  const recipient = business.ownerPhone?.trim() ?? "";
  if (!E164_PATTERN.test(recipient)) return;

  const body = [
    `New lead: ${compact(lead.callerName, 80)}.`,
    `Issue: ${compact(lead.issueReason, 240)}.`,
    `Urgency: ${compact(lead.urgencyLevel, 40)}.`,
    `Call back: ${compact(lead.callbackNumber || lead.phoneNumber, 32)}.`,
  ].join(" ");

  const result = await sendTrackedSms({
    category: "lead_alert",
    businessId,
    leadId,
    to: recipient,
    body,
  });
  if (result.status === "failed" || result.status === "undelivered") {
    const eventKey = `twilio-delivery:${result.id}:${result.status}`;
    const inserted = await recordOperationalFailure({
      eventKey,
      source: "twilio_delivery",
      summary: "Owner lead SMS delivery failed",
      details: "Twilio reported that an owner lead alert was not delivered.",
      businessId,
      businessName: business.businessName,
      founderPush: {
        eventKey,
        title: "Text alert delivery failed",
        body: `${business.businessName} owner text alert was not delivered. Review SMS status.`,
        deepLink: "/admin/activity",
      },
    }).catch(() => false);
    if (inserted) void runNotificationOutboxNow().catch(() => undefined);
    logger.warn(
      { businessId, leadId, messageId: result.id, errorCode: result.errorCode },
      "Owner lead SMS was not delivered",
    );
  }
}

export async function updateOwnerSmsConsentByPhone(phone: string, enabled: boolean): Promise<void> {
  if (!E164_PATTERN.test(phone)) return;
  const digits = phone.replace(/\D/g, "");
  const now = new Date();
  await db.execute(sql`UPDATE businesses
      SET sms_alerts_consent = ${enabled},
          sms_alerts_consent_at = ${now},
          updated_at = ${now}
      WHERE NULLIF(regexp_replace(COALESCE(owner_phone, ''), '[^0-9]', '', 'g'), '') = ${digits}`);
}

export async function updateSmsStatusFromWebhook(
  id: number,
  messageSid: string,
  statusValue: unknown,
  errorCodeValue: unknown,
): Promise<OwnerSmsStatus | null> {
  const status = canonicalStatus(statusValue);
  if (!status || !messageSid) return null;
  const errorCode = typeof errorCodeValue === "string" || typeof errorCodeValue === "number"
    ? String(errorCodeValue).slice(0, 64)
    : null;
  const savedStatus = await updateMessageStatus(id, messageSid, status, errorCode);
  if (savedStatus === "failed" || savedStatus === "undelivered") {
    const [message] = await db.select({
      businessId: ownerSmsMessagesTable.businessId,
      businessName: businessesTable.businessName,
    }).from(ownerSmsMessagesTable)
      .leftJoin(businessesTable, eq(ownerSmsMessagesTable.businessId, businessesTable.id))
      .where(eq(ownerSmsMessagesTable.id, id)).limit(1);
    const eventKey = `twilio-delivery:${id}:${savedStatus}`;
    const inserted = await recordOperationalFailure({
      eventKey,
      source: "twilio_delivery",
      summary: "Owner lead SMS delivery failed",
      details: "Twilio reported that an owner alert was not delivered.",
      businessId: message?.businessId,
      businessName: message?.businessName,
      founderPush: {
        eventKey,
        title: "Text alert delivery failed",
        body: `${message?.businessName ?? "An owner"} text alert was not delivered. Review SMS status.`,
        deepLink: "/admin/activity",
      },
    }).catch(() => false);
    if (inserted) void runNotificationOutboxNow().catch(() => undefined);
  }
  return savedStatus;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "••••" : `••••${digits.slice(-4)}`;
}

export async function getAdminSmsDeliveryFailures() {
  const rows = await db.select({
    id: ownerSmsMessagesTable.id,
    businessId: ownerSmsMessagesTable.businessId,
    businessName: businessesTable.businessName,
    leadId: ownerSmsMessagesTable.leadId,
    category: ownerSmsMessagesTable.category,
    recipientPhone: ownerSmsMessagesTable.recipientPhone,
    status: ownerSmsMessagesTable.status,
    errorCode: ownerSmsMessagesTable.errorCode,
    twilioMessageSid: ownerSmsMessagesTable.twilioMessageSid,
    createdAt: ownerSmsMessagesTable.createdAt,
  }).from(ownerSmsMessagesTable)
    .leftJoin(businessesTable, eq(ownerSmsMessagesTable.businessId, businessesTable.id))
    .where(inArray(ownerSmsMessagesTable.status, ["failed", "undelivered"]))
    .orderBy(desc(ownerSmsMessagesTable.createdAt), desc(ownerSmsMessagesTable.id))
    .limit(50);

  return rows.map((row) => ({
    id: row.id,
    businessId: row.businessId,
    businessName: row.businessName,
    leadId: row.leadId,
    category: row.category,
    recipientMasked: maskPhone(row.recipientPhone),
    status: row.status,
    errorCode: row.errorCode,
    twilioMessageSid: row.twilioMessageSid,
    createdAt: row.createdAt.toISOString(),
  }));
}

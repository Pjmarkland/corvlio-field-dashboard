import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  getAdminSmsDeliveryFailures,
  getOwnerSmsReadiness,
  isConfiguredTwilioAccount,
  sendTrackedSms,
  updateOwnerSmsConsentByPhone,
  updateSmsStatusFromWebhook,
  validateTwilioWebhook,
} from "../lib/ownerSms";

const router = Router();
const emptyTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
const e164 = /^\+[1-9]\d{7,14}$/;
const testInput = z.object({
  requestId: z.string().uuid(),
  to: z.string().regex(e164),
}).strict();

function bodyString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function twilioKeyword(body: Record<string, unknown>): string {
  return bodyString(body.OptOutType || body.Body).trim().toUpperCase();
}

router.post("/sms/twilio/inbound", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const signature = req.get("X-Twilio-Signature");
  if (!validateTwilioWebhook(signature, body, "inbound")
    || !isConfiguredTwilioAccount(body.AccountSid)) {
    res.sendStatus(403);
    return;
  }

  try {
    const from = bodyString(body.From).trim();
    const command = twilioKeyword(body);
    if (["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(command)) {
      await updateOwnerSmsConsentByPhone(from, false);
    } else if (["START", "UNSTOP", "YES"].includes(command)) {
      await updateOwnerSmsConsentByPhone(from, true);
    } else if (command === "HELP" && getOwnerSmsReadiness().ready && e164.test(from)) {
      void sendTrackedSms({
        category: "help_reply",
        to: from,
        body: "Corvlio owner lead alerts. For support, email hello@corvlio.com. Reply STOP to opt out.",
      }).then((result) => {
        if (result.status === "failed" || result.status === "undelivered") {
          req.log.warn(
            { messageId: result.id, errorCode: result.errorCode },
            "Twilio HELP reply was not delivered",
          );
        }
      }).catch(() => {
        req.log.warn("Twilio HELP reply could not be logged or sent");
      });
    }
    res.status(200).type("text/xml").send(emptyTwiml);
  } catch {
    req.log.error("Twilio inbound SMS could not be processed");
    res.sendStatus(503);
  }
});

router.post("/sms/twilio/status", async (req, res): Promise<void> => {
  const rawMessageId = req.query.messageId;
  const messageId = Number(Array.isArray(rawMessageId) ? rawMessageId[0] : rawMessageId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const signature = req.get("X-Twilio-Signature");
  if (!Number.isSafeInteger(messageId) || messageId < 1
    || !validateTwilioWebhook(signature, body, "status", messageId)
    || !isConfiguredTwilioAccount(body.AccountSid)) {
    res.sendStatus(403);
    return;
  }

  try {
    const messageSid = bodyString(body.MessageSid || body.SmsSid);
    await updateSmsStatusFromWebhook(
      messageId,
      messageSid,
      body.MessageStatus,
      body.ErrorCode,
    );
    res.sendStatus(204);
  } catch {
    req.log.error("Twilio SMS status callback could not be recorded");
    res.sendStatus(503);
  }
});

router.use("/admin/sms", requireAdmin, (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

router.get("/admin/sms/messages", async (req, res): Promise<void> => {
  try {
    res.json({ messages: await getAdminSmsDeliveryFailures() });
  } catch {
    req.log.error("Unable to load SMS delivery failures");
    res.status(503).json({ error: "SMS delivery history is temporarily unavailable." });
  }
});

router.post("/admin/sms/test", async (req, res): Promise<void> => {
  const parsed = testInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your mobile number in E.164 format." });
    return;
  }
  if (!getOwnerSmsReadiness().ready) {
    res.status(409).json({ error: "SMS is disabled or missing required configuration." });
    return;
  }

  try {
    const result = await sendTrackedSms({
      category: "test",
      to: parsed.data.to,
      requestId: parsed.data.requestId,
      adminEmail: typeof res.locals.adminEmail === "string" ? res.locals.adminEmail : null,
      body: "Corvlio SMS test. Lead alerts are enabled for this number. Reply STOP to opt out or HELP for support.",
    });
    res.json({
      id: result.id,
      status: result.status,
      twilioMessageSid: result.twilioMessageSid,
      errorCode: result.errorCode,
    });
  } catch {
    req.log.error("Admin SMS test could not be completed");
    res.status(503).json({ error: "The SMS test could not be completed." });
  }
});

export default router;

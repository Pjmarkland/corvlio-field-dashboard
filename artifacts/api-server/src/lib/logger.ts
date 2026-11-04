import pino from "pino";
import { redactSensitiveText } from "./privacyRedaction";

const isProduction = process.env.NODE_ENV === "production";

const MASKABLE_LOG_TEXT_FIELDS = new Set([
  "email",
  "emailaddress",
  "owneremail",
  "calleremail",
  "contactemail",
  "phone",
  "phonenumber",
  "callernumber",
  "callerid",
  "callbacknumber",
  "message",
  "details",
  "body",
  "summary",
  "error",
]);

export function redactSensitiveLogValue(value: unknown, path: string[]): unknown {
  const field = path.at(-1)?.toLowerCase() ?? "";
  if (typeof value === "string" && MASKABLE_LOG_TEXT_FIELDS.has(field)) {
    return redactSensitiveText(value);
  }
  return "[Redacted]";
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-native-clerk-client']",
      "res.headers['set-cookie']",
      "email",
      "*.email",
      "emailAddress",
      "*.emailAddress",
      "ownerEmail",
      "*.ownerEmail",
      "callerEmail",
      "*.callerEmail",
      "contactEmail",
      "*.contactEmail",
      "phone",
      "*.phone",
      "phoneNumber",
      "*.phoneNumber",
      "callerNumber",
      "*.callerNumber",
      "callerId",
      "*.callerId",
      "callbackNumber",
      "*.callbackNumber",
      "message",
      "*.message",
      "details",
      "*.details",
      "body",
      "*.body",
      "summary",
      "*.summary",
      "callerName",
      "*.callerName",
      "contactName",
      "*.contactName",
      "transcript",
      "*.transcript",
      "recordingUrl",
      "*.recordingUrl",
      "recording_url",
      "*.recording_url",
      "privateNotes",
      "*.privateNotes",
      "private_notes",
      "*.private_notes",
      "address",
      "*.address",
      "callerAddress",
      "*.callerAddress",
      "availability",
      "*.availability",
      "password",
      "*.password",
      "secret",
      "*.secret",
      "token",
      "*.token",
      "apiKey",
      "*.apiKey",
      "refreshToken",
      "*.refreshToken",
      "accessToken",
      "*.accessToken",
      "*.stack",
      "*.error",
    ],
    censor: redactSensitiveLogValue,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

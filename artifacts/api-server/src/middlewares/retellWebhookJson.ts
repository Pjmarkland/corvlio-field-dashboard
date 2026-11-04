import express from "express";
import type { IncomingMessage, ServerResponse } from "node:http";

export const RETELL_WEBHOOK_JSON_LIMIT = "2mb";

export function captureWebhookRawBody(
  req: IncomingMessage,
  _res: ServerResponse,
  buffer: Buffer,
): void {
  (req as IncomingMessage & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
}

export function createRetellWebhookJsonParser() {
  return express.json({
    limit: RETELL_WEBHOOK_JSON_LIMIT,
    verify: captureWebhookRawBody,
  });
}

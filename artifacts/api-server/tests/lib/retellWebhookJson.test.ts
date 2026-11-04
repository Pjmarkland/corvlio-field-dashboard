import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordAlert: vi.fn() }));
vi.mock("../../src/lib/retellSystemAlerts", () => ({
  recordRetellSystemAlert: mocks.recordAlert,
}));

import { retellMalformedJsonAlertHandler } from "../../src/lib/retellWebhookAlerts";
import { createRetellWebhookJsonParser } from "../../src/middlewares/retellWebhookJson";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use("/api/webhooks/retell", createRetellWebhookJsonParser());
  app.post("/api/webhooks/retell/post-call", (req, res) => {
    res.json({ bytes: (req as express.Request & { rawBody?: Buffer }).rawBody?.byteLength ?? 0 });
  });
  app.use(retellMalformedJsonAlertHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordAlert.mockResolvedValue(undefined);
});

describe("Retell webhook JSON size handling", () => {
  it("accepts payloads larger than Express's default limit and preserves raw bytes", async () => {
    const response = await fetch(`${base}/api/webhooks/retell/post-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "x".repeat(150_000) }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bytes: expect.any(Number) });
    expect(mocks.recordAlert).not.toHaveBeenCalled();
  });

  it("alerts and returns 413 when a Retell payload exceeds the increased limit", async () => {
    const response = await fetch(`${base}/api/webhooks/retell/post-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "x".repeat(2_100_000) }),
    });
    expect(response.status).toBe(413);
    await vi.waitFor(() => expect(mocks.recordAlert).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: "retell:post-call:payload_too_large",
      category: "payload_too_large",
    })));
  });
});

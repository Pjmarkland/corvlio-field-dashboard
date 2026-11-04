import type { Request, Response, NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";
import { createPublicWebhookRateLimiter } from "../../src/middlewares/publicWebhookRateLimit";

function mockRequest(ip: string, path = "/pre-call") {
  return {
    ip,
    path,
    baseUrl: "/api/webhooks/retell",
    socket: { remoteAddress: ip },
  } as Request;
}

function mockResponse() {
  const response = {
    headers: new Map<string, string>(),
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response as unknown as Response & typeof response;
}

describe("public webhook rate limiter", () => {
  it("limits each client and route, then resets after the window", async () => {
    let now = 10_000;
    const limit = createPublicWebhookRateLimiter({ windowMs: 1_000, maxRequests: 2, now: () => now });
    const next = vi.fn<NextFunction>();
    const request = mockRequest("203.0.113.10");
    const first = mockResponse();
    const second = mockResponse();
    const blocked = mockResponse();

    await limit(request, first, next);
    await limit(request, second, next);
    await limit(request, blocked, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual({ error: "Too many webhook requests" });
    expect(blocked.headers.get("retry-after")).toBe("1");
    expect(blocked.headers.get("ratelimit-remaining")).toBe("0");

    now += 1_000;
    await limit(request, mockResponse(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("keeps separate counters for different clients and webhook routes", async () => {
    const limit = createPublicWebhookRateLimiter({ maxRequests: 1 });
    const next = vi.fn<NextFunction>();

    await limit(mockRequest("203.0.113.10"), mockResponse(), next);
    await limit(mockRequest("203.0.113.11"), mockResponse(), next);
    await limit(mockRequest("203.0.113.10", "/post-call"), mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(3);
  });
});

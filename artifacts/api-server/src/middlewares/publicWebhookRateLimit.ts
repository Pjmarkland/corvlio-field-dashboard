import type { RequestHandler } from "express";
import {
  consumeRateLimitBucket,
  hashRateLimitIdentity,
  requestIp,
  setRateLimitHeaders,
  type RateLimitConsumer,
} from "./requestRateLimit";

type RateLimitOptions = {
  windowMs?: number;
  maxRequests?: number;
  now?: () => number;
  consume?: RateLimitConsumer;
};

export function createPublicWebhookRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  now = Date.now,
  consume = consumeRateLimitBucket,
}: RateLimitOptions = {}): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const requestPath = `${req.baseUrl}${req.path}`.split("?")[0];
    const identity = `${requestIp(req)}:${requestPath}`;
    try {
      const result = await consume(
        `webhook:${hashRateLimitIdentity(identity)}`,
        windowMs,
        now(),
      );
      setRateLimitHeaders(res, maxRequests, result);

      if (result.count > maxRequests) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((result.resetAt.getTime() - now()) / 1000))),
        );
        res.status(429).json({ error: "Too many webhook requests" });
        return;
      }
      next();
    } catch (error) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Webhook rate limit could not be checked",
      );
      res.status(503).json({ error: "Webhook could not be processed securely" });
    }
  };
}

export const publicWebhookRateLimit = createPublicWebhookRateLimiter();

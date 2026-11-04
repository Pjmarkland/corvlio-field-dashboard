import type { RequestHandler } from "express";

type RateLimitOptions = {
  windowMs?: number;
  maxRequests?: number;
  maxKeys?: number;
  now?: () => number;
};

type WindowCounter = {
  count: number;
  resetAt: number;
};

export function createPublicWebhookRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  maxKeys = 10_000,
  now = Date.now,
}: RateLimitOptions = {}): RequestHandler {
  const counters = new Map<string, WindowCounter>();
  let callsSinceCleanup = 0;

  return (req, res, next) => {
    const currentTime = now();
    const requestPath = `${req.baseUrl}${req.path}`.split("?")[0];
    const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${requestPath}`;
    let counter = counters.get(key);

    if (!counter || counter.resetAt <= currentTime) {
      counter = { count: 0, resetAt: currentTime + windowMs };
      counters.delete(key);
      counters.set(key, counter);
    }

    counter.count += 1;
    callsSinceCleanup += 1;
    if (callsSinceCleanup >= 256 || counters.size > maxKeys) {
      callsSinceCleanup = 0;
      for (const [candidateKey, candidate] of counters) {
        if (candidate.resetAt <= currentTime) counters.delete(candidateKey);
      }
      while (counters.size > maxKeys) {
        const oldestKey = counters.keys().next().value;
        if (oldestKey === undefined) break;
        counters.delete(oldestKey);
      }
    }

    const remaining = Math.max(0, maxRequests - counter.count);
    res.setHeader("RateLimit-Limit", String(maxRequests));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(counter.resetAt / 1000)));

    if (counter.count > maxRequests) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((counter.resetAt - currentTime) / 1000))));
      res.status(429).json({ error: "Too many webhook requests" });
      return;
    }
    next();
  };
}

export const publicWebhookRateLimit = createPublicWebhookRateLimiter();

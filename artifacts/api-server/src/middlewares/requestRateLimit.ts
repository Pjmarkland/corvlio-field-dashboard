import { createHash } from "node:crypto";
import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { lte, sql } from "drizzle-orm";
import { db, requestRateLimitBucketsTable } from "@workspace/db";
import { consumeTestRateLimitBucket } from "./testRateLimitStore";

export type RateLimitResult = {
  count: number;
  resetAt: Date;
};

export type RateLimitConsumer = (
  key: string,
  windowMs: number,
  now?: number,
) => Promise<RateLimitResult>;

let callsSinceCleanup = 0;

export async function consumeRateLimitBucket(
  key: string,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === "test") {
    return consumeTestRateLimitBucket(key, windowMs, now);
  }

  const resetAt = new Date(now + windowMs);
  const nowDate = new Date(now);
  const [bucket] = await db
    .insert(requestRateLimitBucketsTable)
    .values({ bucketKey: key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: requestRateLimitBucketsTable.bucketKey,
      set: {
        count: sql`CASE
          WHEN ${requestRateLimitBucketsTable.resetAt} <= ${nowDate} THEN 1
          ELSE ${requestRateLimitBucketsTable.count} + 1
        END`,
        resetAt: sql`CASE
          WHEN ${requestRateLimitBucketsTable.resetAt} <= ${nowDate} THEN ${resetAt}
          ELSE ${requestRateLimitBucketsTable.resetAt}
        END`,
      },
    })
    .returning({
      count: requestRateLimitBucketsTable.count,
      resetAt: requestRateLimitBucketsTable.resetAt,
    });

  if (!bucket) throw new Error("Rate limit bucket was not returned");

  callsSinceCleanup += 1;
  if (callsSinceCleanup >= 500) {
    callsSinceCleanup = 0;
    void db.delete(requestRateLimitBucketsTable)
      .where(lte(requestRateLimitBucketsTable.resetAt, new Date(Date.now() - 24 * 60 * 60_000)))
      .catch(() => undefined);
  }

  return bucket;
}

export function hashRateLimitIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function setRateLimitHeaders(
  res: Parameters<RequestHandler>[1],
  limit: number,
  result: RateLimitResult,
): void {
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - result.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt.getTime() / 1000)));
}

export function createUserRateLimit(options: {
  bucket: string;
  windowMs: number;
  maxRequests: number;
  consume?: RateLimitConsumer;
}): RequestHandler {
  const consume = options.consume ?? consumeRateLimitBucket;
  return async (req, res, next): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      next();
      return;
    }

    try {
      const result = await consume(
        `owner:${options.bucket}:${hashRateLimitIdentity(userId)}`,
        options.windowMs,
      );
      setRateLimitHeaders(res, options.maxRequests, result);
      if (result.count > options.maxRequests) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))),
        );
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      next();
    } catch (error) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Request rate limit could not be checked",
      );
      res.status(503).json({ error: "Request could not be processed securely" });
    }
  };
}


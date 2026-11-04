export type RateLimitTestResult = {
  count: number;
  resetAt: Date;
};

const buckets = new Map<string, RateLimitTestResult>();

export async function consumeTestRateLimitBucket(
  key: string,
  windowMs: number,
  now: number,
): Promise<RateLimitTestResult> {
  const current = buckets.get(key);
  const bucket = !current || current.resetAt.getTime() <= now
    ? { count: 1, resetAt: new Date(now + windowMs) }
    : { count: current.count + 1, resetAt: current.resetAt };
  buckets.set(key, bucket);
  return bucket;
}

export function clearTestRateLimitBuckets(): void {
  buckets.clear();
}

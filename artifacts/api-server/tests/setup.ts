import { afterEach } from "vitest";
import { clearTestRateLimitBuckets } from "../src/middlewares/testRateLimitStore";

afterEach(() => {
  clearTestRateLimitBuckets();
});

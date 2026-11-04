import { afterEach } from "vitest";
import { clearRateLimitTestBuckets } from "../src/middlewares/requestRateLimit";

afterEach(() => {
  clearRateLimitTestBuckets();
});

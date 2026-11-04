import { describe, expect, it } from "vitest";
import {
  getPlanCallThresholdCount,
  getUsageAlertUtcWindow,
  usageThresholdReached,
} from "../../src/lib/usageAlertWorker";

describe("usage alert threshold helpers", () => {
  it("uses UTC calendar-day and month boundaries", () => {
    const { dayStart, monthStart } = getUsageAlertUtcWindow(new Date("2026-11-04T01:15:00-08:00"));
    expect(dayStart.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(monthStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("alerts at the threshold and above it", () => {
    expect(usageThresholdReached(499.9, 500)).toBe(false);
    expect(usageThresholdReached(500, 500)).toBe(true);
    expect(usageThresholdReached(500.1, 500)).toBe(true);
  });

  it("rounds call-count alert thresholds up to whole calls", () => {
    expect(getPlanCallThresholdCount(100, 80)).toBe(80);
    expect(getPlanCallThresholdCount(150, 80)).toBe(120);
    expect(getPlanCallThresholdCount(151, 80)).toBe(121);
    expect(getPlanCallThresholdCount(100, 100)).toBe(100);
  });
});

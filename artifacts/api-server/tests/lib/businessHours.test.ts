import { describe, expect, it } from "vitest";
import { businessClock, parseBusinessHours, validTimeZone } from "../../src/lib/businessHours";
describe("business-local opening hours", () => {
  it("uses business time zone and the exact closing boundary", () => {
    expect(businessClock("Mon-Fri 09:00-17:00", "America/New_York", new Date("2026-10-02T20:59:00Z")).business_is_open).toBe("true");
    const closed = businessClock("Mon-Fri 09:00-17:00", "America/New_York", new Date("2026-10-02T21:00:00Z"));
    expect(closed.business_is_open).toBe("false");
    expect(closed.next_opening).toBe("Mon 09:00 (America/New_York)");
  });
  it("does not promise a weekend morning when the business is closed", () => {
    expect(businessClock("Mon-Fri 09:00-17:00", "America/New_York", new Date("2026-10-03T14:00:00Z")).next_opening).toContain("Mon 09:00");
  });
  it("handles multiple ranges, full weekdays, lists and one-digit hours", () => {
    expect(parseBusinessHours("Monday-Friday 9:00 - 17:00; Sat, Sun 10:00-14:00")).toHaveLength(7);
    expect(businessClock("Mon-Fri 09:00-17:00; Sat 10:00-14:00", "America/Chicago", new Date("2026-10-03T16:00:00Z")).business_is_open).toBe("true");
  });
  it("handles overnight ranges, wrapped weekdays, 24/7 and DST", () => {
    expect(businessClock("Fri-Mon 22:00-06:00", "America/New_York", new Date("2026-10-03T06:00:00Z")).business_is_open).toBe("true");
    expect(businessClock("24/7", "America/New_York", new Date("2026-11-01T06:30:00Z")).business_is_open).toBe("true");
    expect(businessClock("Sun 01:00-03:00", "America/New_York", new Date("2026-11-01T06:30:00Z")).business_is_open).toBe("true");
  });
  it("does not invent open status from malformed data", () => {
    for (const schedule of ["", "Mon 99:00-25:00", "Mon 09:00-09:00", "Moon 09:00-17:00", "Mon-Fri 09:00-17:00;"]) {
      expect(parseBusinessHours(schedule)).toBeNull();
    }
    expect(businessClock("call owner", "America/New_York").business_is_open).toBe("unknown");
    expect(validTimeZone("Mars/City")).toBe(false);
    expect(validTimeZone("America/Phoenix")).toBe(true);
    expect(validTimeZone("UTC")).toBe(true);
  });
});
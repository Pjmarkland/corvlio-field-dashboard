import { describe, expect, it } from "vitest";
import { numberActivity } from "../../src/lib/numberActivity";
const now = new Date("2026-10-02T12:00:00Z").getTime();
const day = 24 * 60 * 60_000;
const business = { retellPhoneNumber: "+15551234567", retellAgentId: "test", isSample: false, provisioningState: "ready", createdAt: new Date(now - 10 * day) };
describe("read-only number inactivity flags", () => {
  it("flags assigned numbers with no recorded calls for at least seven days", () => {
    expect(numberActivity(business, [], now).unusedNumber7Days).toBe(true);
    expect(numberActivity(business, [], now, new Date(now - 6 * day)).unusedNumber7Days).toBe(false);
  });
  it("uses the most recent call and includes the seven-day boundary", () => {
    const calls = [8, 7].map((age) => ({ callStartedAt: new Date(now - age * day), recordedAt: new Date(now) }));
    expect(numberActivity(business, calls, now).unusedNumber7Days).toBe(true);
    calls.push({ callStartedAt: new Date(now - day), recordedAt: new Date(now) });
    expect(numberActivity(business, calls, now).unusedNumber7Days).toBe(false);
  });
  it("never flags demos or businesses without numbers", () => {
    expect(numberActivity({ ...business, isSample: true }, [], now)).toMatchObject({ provisioningState: "sample", unusedNumber7Days: false });
    expect(numberActivity({ ...business, retellPhoneNumber: null, provisioningState: "capped" }, [], now)).toMatchObject({ provisioningState: "capped", unusedNumber7Days: false });
  });
});
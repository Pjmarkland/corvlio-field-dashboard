import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/lib/logger";
const fixture = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, select: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { select: fixture.select }, businessesTable: { retellPhoneNumber: "phone" } }));
import { findBusinessByPhoneNumber } from "../../src/lib/businessDirectory";
describe("fresh business routing", () => {
  beforeEach(() => {
    fixture.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => fixture.rows }) }),
    }));
    fixture.rows = [{ id: 1, agentName: "Aria", pricingPolicy: "Old pricing" }];
  });
  it("does a fresh lookup for every call instead of using process-local policies", async () => {
    expect((await findBusinessByPhoneNumber("+1 (555) 123-4567"))?.pricingPolicy).toBe("Old pricing");
    fixture.rows = [{ id: 1, agentName: "Maya", pricingPolicy: "Updated in another server" }];
    expect((await findBusinessByPhoneNumber("+15551234567"))?.pricingPolicy).toBe("Updated in another server");
    expect(fixture.select).toHaveBeenCalledTimes(2);
  });
  it("refuses and logs ambiguous duplicate phone mappings", async () => {
    fixture.rows = [{ id: 1 }, { id: 2 }];
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    await expect(findBusinessByPhoneNumber("+15551234567")).rejects.toThrow("Duplicate assigned phone");
    expect(log).toHaveBeenCalled();
  });
  it("does not look up an empty normalized number", async () => {
    expect(await findBusinessByPhoneNumber("  ")).toBeUndefined();
    expect(fixture.select).not.toHaveBeenCalled();
  });
});
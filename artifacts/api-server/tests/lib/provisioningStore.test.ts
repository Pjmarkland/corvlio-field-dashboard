import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business } from "@workspace/db";
const mocks = vi.hoisted(() => ({
  updateBusiness: vi.fn(), createBusiness: vi.fn(), findBusinessByClerkUserId: vi.fn(),
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction }, advisoryLockPool: { connect: mocks.connect },
  businessesTable: {}, provisioningAttemptsTable: {},
}));
vi.mock("../../src/lib/businessDirectory", () => ({
  createBusiness: mocks.createBusiness,
  findBusinessByClerkUserId: mocks.findBusinessByClerkUserId,
  updateBusiness: mocks.updateBusiness,
  WEBSITE_ENRICHMENT_FIELDS: ["businessType", "pricingPolicy"],
}));
import { provisioningStore } from "../../src/lib/provisioningStore";
describe("durable provisioning storage", () => {
  beforeEach(() => {
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockResolvedValue({});
    mocks.updateBusiness.mockImplementation(async (id, changes) => ({ id, ...changes }));
  });
  it("holds a database account lock across the operation and releases it after success", async () => {
    const operation = vi.fn(async () => "done");
    expect(await provisioningStore.lock("test-account", operation)).toBe("done");
    expect(mocks.query.mock.calls.map(([command]) => command)).toEqual([
      "SELECT pg_advisory_lock(542310, hashtext($1))",
      "SELECT pg_advisory_unlock(542310, hashtext($1))",
    ]);
    expect(mocks.release).toHaveBeenCalledWith(false);
  });
  it("releases the account lock when the operation fails", async () => {
    await expect(provisioningStore.lock("test-account", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("destroys a connection when unlock fails so no session lock can leak", async () => {
    mocks.query.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("connection lost"));
    await provisioningStore.lock("test-account", async () => "done");
    expect(mocks.release).toHaveBeenCalledWith(true);
  });
  it("clears only manually overwritten website source markers inside the lock", async () => {
    const business = {
      id: 1, isSample: false, websiteEnrichmentAttemptedAt: new Date(),
      websiteEnrichmentSources: { businessType: "https://example.test/about", pricingPolicy: "https://example.test/prices" },
    } as unknown as Business;
    await provisioningStore.update!(business, { businessName: "Owner business", businessType: "Owner-entered HVAC contractor" });
    expect(mocks.updateBusiness).toHaveBeenCalledWith(1, expect.objectContaining({
      businessType: "Owner-entered HVAC contractor",
      websiteEnrichmentSources: { pricingPolicy: "https://example.test/prices" },
      websiteEnrichmentAttemptedAt: business.websiteEnrichmentAttemptedAt,
    }));
  });
  it("preserves sample provenance when an existing demo is edited", async () => {
    const business = { id: 1, isSample: true, websiteEnrichmentSources: {}, websiteEnrichmentAttemptedAt: null } as unknown as Business;
    await provisioningStore.update!(business, { businessName: "Edited", isSample: false, businessWebsiteUrl: "https://example.test" });
    expect(mocks.updateBusiness).toHaveBeenCalledWith(1, expect.objectContaining({
      isSample: true, provisioningState: "sample", businessWebsiteUrl: null,
    }));
  });
});
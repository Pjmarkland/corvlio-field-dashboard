import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUserList: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUserList: mocks.getUserList } },
}));
vi.mock("../../src/middlewares/requireAdmin", () => ({
  parseAdminEmails: () => new Set(["admin@corvlio.com"]),
}));

import { createInternalBusiness } from "../../src/lib/internalBusinesses";

describe("internal business creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.getUserList.mockReset();
    mocks.getUserList.mockResolvedValue({
      data: [{
        id: "admin_user",
        emailAddresses: [{ emailAddress: "admin@corvlio.com", verification: { status: "verified" } }],
      }],
    });
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 21,
        business_name: "Corvlio",
        is_internal: true,
        agent_name: "Aria",
        retell_phone_number: "+12397882087",
        retell_agent_id: null,
        clerk_user_id: "admin_user",
        owner_email: "hello@corvlio.com",
      }] });
  });

  it("rejects other numbers before any business record is written", async () => {
    await expect(createInternalBusiness({
      businessName: "Corvlio",
      retellPhoneNumber: "+15551234567",
      ownerUserId: "admin_user",
      businessType: "Corvlio sales",
      servicesOffered: "Answer calls",
      servicesNotOffered: "No dispatch",
      serviceArea: "United States",
      majorIssueExamples: "Sales questions",
      businessHours: "Mon-Fri 09:00-17:00",
      timeZone: "America/New_York",
      emergencyAvailable: false,
      emergencyEscalationPhone: null,
      aiPromisePolicy: "callback_only",
    })).rejects.toThrow("existing Corvlio number +1 239-788-2087");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.getUserList).not.toHaveBeenCalled();
  });

  it("stores the existing number and onboarding profile locally without a Retell agent mutation", async () => {
    const record = await createInternalBusiness({
      businessName: "Corvlio",
      retellPhoneNumber: "+12397882087",
      ownerUserId: "admin_user",
      businessType: "Corvlio sales",
      servicesOffered: "Answer calls and capture sales inquiries",
      servicesNotOffered: "No service dispatch",
      serviceArea: "United States",
      majorIssueExamples: "New customer inquiries",
      businessHours: "Mon-Fri 09:00-17:00",
      timeZone: "America/New_York",
      emergencyAvailable: false,
      emergencyEscalationPhone: null,
      aiPromisePolicy: "callback_only",
    });

    expect(record).toMatchObject({
      id: 21,
      businessName: "Corvlio",
      isInternal: true,
      agentName: "Aria",
      retellPhoneNumber: "+12397882087",
      retellAgentId: null,
      ownerUserId: "admin_user",
      ownerEmail: "hello@corvlio.com",
    });
    expect(mocks.query).toHaveBeenCalledTimes(3);
    const [insertSql, values] = mocks.query.mock.calls[2] as [string, unknown[]];
    expect(insertSql).toContain("lead_alerts_enabled");
    expect(insertSql).toContain("retell_phone_number");
    expect(insertSql).not.toContain("retell_agent_id");
    expect(insertSql).toContain("'Aria'");
    expect(insertSql).toContain("'hello@corvlio.com'");
    expect(values).toContain("+12397882087");
    expect(values).toContain("Mon-Fri 09:00-17:00");
  });

  it("does not replace an existing business owner or write a record for a linked admin", async () => {
    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ clerk_user_id: "admin_user", business_name: "Existing business" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(createInternalBusiness({
      businessName: "Corvlio",
      retellPhoneNumber: "+12397882087",
      ownerUserId: "admin_user",
      businessType: "Corvlio sales",
      servicesOffered: "Answer calls",
      servicesNotOffered: "No dispatch",
      serviceArea: "United States",
      majorIssueExamples: "Sales questions",
      businessHours: "Mon-Fri 09:00-17:00",
      timeZone: "America/New_York",
      emergencyAvailable: false,
      emergencyEscalationPhone: null,
      aiPromisePolicy: "callback_only",
    })).rejects.toThrow("This owner already has a business.");
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});

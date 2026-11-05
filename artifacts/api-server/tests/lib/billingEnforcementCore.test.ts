import { describe, expect, it, vi } from "vitest";
import { addBusinessDays } from "../../src/billing/policy";
import {
  evaluateEnforcementCandidate,
  enforcementMilestoneAt,
  type EnforcementCandidate,
  type EnforcementPorts,
} from "../../src/billing/enforcementCore";
import { shouldSendEnforcementWarningEmail } from "../../src/billing/enforcementNoticeGate";

const startedAt = new Date("2026-10-05T17:00:00.000Z");
const candidate: EnforcementCandidate = {
  businessId: 12,
  businessName: "Example business",
  source: "stripe",
  invoiceId: "in_past_due",
  graceStartedAt: startedAt,
  graceEndsAt: addBusinessDays(startedAt, 5),
  neverAutoSuspend: false,
  stripeCustomerId: "cus_expected",
  stripeSubscriptionId: "sub_expected",
  stripeStatus: "past_due",
};
const now = new Date("2026-11-01T23:59:59.999Z");

function ports(overrides: Partial<EnforcementPorts> = {}): EnforcementPorts {
  return {
    readMode: vi.fn(async () => "enforce" as const),
    verifyStripe: vi.fn(async () => true),
    recordWouldSuspend: vi.fn(async () => true),
    queueWarning: vi.fn(async () => {}),
    warningsDelivered: vi.fn(async () => true),
    suspend: vi.fn(async () => true),
    ...overrides,
  };
}

describe("unpaid-client enforcement safety", () => {
  it("fails open when the settings store cannot be read", async () => {
    const p = ports({ readMode: async () => { throw new Error("database unavailable"); } });
    expect(await evaluateEnforcementCandidate(candidate, now, p)).toBe("off");
    expect(p.suspend).not.toHaveBeenCalled();
  });

  it("does no enforcement work while the global switch is Off", async () => {
    const p = ports({ readMode: async () => "off" });
    expect(await evaluateEnforcementCandidate(candidate, now, p)).toBe("off");
    expect(p.queueWarning).not.toHaveBeenCalled();
    expect(p.suspend).not.toHaveBeenCalled();
  });

  it("never processes an account with the never-auto-suspend override", async () => {
    const p = ports();
    expect(await evaluateEnforcementCandidate({ ...candidate, neverAutoSuspend: true }, now, p)).toBe("overridden");
    expect(p.readMode).not.toHaveBeenCalled();
    expect(p.queueWarning).not.toHaveBeenCalled();
    expect(p.suspend).not.toHaveBeenCalled();
  });

  it("records dry-run candidates without sending warnings or suspending", async () => {
    const p = ports({ readMode: async () => "dry_run" });
    expect(await evaluateEnforcementCandidate(candidate, now, p)).toBe("dry_run_logged");
    expect(p.recordWouldSuspend).toHaveBeenCalledWith(candidate);
    expect(p.queueWarning).not.toHaveBeenCalled();
    expect(p.suspend).not.toHaveBeenCalled();
  });

  it("queues day-3 and day-5 warnings only when On", async () => {
    const p = ports();
    expect(await evaluateEnforcementCandidate(candidate, now, p)).toBe("suspended");
    expect(p.queueWarning).toHaveBeenNthCalledWith(1, candidate, 3);
    expect(p.queueWarning).toHaveBeenNthCalledWith(2, candidate, 5);
  });

  it("keeps service active when live provider verification says paid or fails", async () => {
    const p = ports({ verifyStripe: async () => false });
    expect(await evaluateEnforcementCandidate(candidate, now, p)).toBe("verification_failed");
    expect(p.suspend).not.toHaveBeenCalled();

    const unavailable = ports({ verifyStripe: async () => { throw new Error("Stripe unavailable"); } });
    expect(await evaluateEnforcementCandidate(candidate, now, unavailable)).toBe("verification_failed");
    expect(unavailable.suspend).not.toHaveBeenCalled();
  });

  it("does not suspend when scheduled warnings are not delivered", async () => {
    const p = ports({ warningsDelivered: async () => false });
    expect(await evaluateEnforcementCandidate(candidate, now, p)).toBe("waiting_for_warnings");
    expect(p.suspend).not.toHaveBeenCalled();
  });

  it("sends enforcement warning email only in On mode", () => {
    const dayThree = "billing-enforcement:warning:stripe:12:in_past_due:1:day-3:owner";
    const dayFive = "billing-enforcement:warning:manual:12:9:1:day-5:admin";
    expect(shouldSendEnforcementWarningEmail(dayThree, "off")).toBe(false);
    expect(shouldSendEnforcementWarningEmail(dayThree, "dry_run")).toBe(false);
    expect(shouldSendEnforcementWarningEmail(dayThree, "enforce")).toBe(true);
    expect(shouldSendEnforcementWarningEmail(dayFive, "off")).toBe(false);
    expect(shouldSendEnforcementWarningEmail(dayFive, "enforce")).toBe(true);
    expect(shouldSendEnforcementWarningEmail("billing:ordinary-payment-reminder", "off")).toBe(true);
  });

  it("uses five business-day grace and later local warning milestones", () => {
    const dayThree = enforcementMilestoneAt(startedAt, 3);
    const dayFive = enforcementMilestoneAt(startedAt, 5);
    expect(dayFive.getTime()).toBeGreaterThan(dayThree.getTime());
    expect(candidate.graceEndsAt.getTime()).toBeGreaterThan(startedAt.getTime());
  });
});

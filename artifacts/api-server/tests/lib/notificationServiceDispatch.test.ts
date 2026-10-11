import { describe, expect, it, vi } from "vitest";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("../../src/lib/notificationDispatch", () => ({ dispatchNotificationChannels: dispatch }));
vi.mock("../../src/lib/leadAlertEmail", () => ({ deliverLeadAlertEmails: vi.fn() }));
vi.mock("../../src/lib/operationalFailures", () => ({ deliverOperationalFailureAlerts: vi.fn() }));
vi.mock("../../src/lib/apnsAdapter", () => ({ sendApnsNotification: vi.fn(), isApnsConfigured: vi.fn() }));
vi.mock("../../src/lib/googleSheets", () => ({ readGoogleSheetLeads: vi.fn() }));
vi.mock("../../src/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { runNotificationOutboxNow } from "../../src/lib/notificationService";

describe("notification poller email isolation", () => {
  it("releases the push poller without waiting for slow email, so scheduled push retries can continue", async () => {
    let finishEmail!: () => void;
    const pendingEmail = new Promise<void>(resolve => { finishEmail = resolve; });
    dispatch.mockImplementation(channels => channels[0].name === "owner_email" ? pendingEmail : Promise.resolve());
    await expect(runNotificationOutboxNow()).resolves.toBeUndefined();
    expect(dispatch.mock.calls.map(args => args[0].map((channel: { name: string }) => channel.name)))
      .toEqual([["owner_email", "admin_email"], ["push"]]);
    finishEmail();
  });
});

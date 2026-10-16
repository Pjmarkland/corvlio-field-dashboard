import { describe, expect, it, vi } from "vitest";
const log = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/logger", () => ({ logger: { error: log } }));
import { dispatchNotificationChannels } from "../../src/lib/notificationDispatch";

describe("independent notification channels", () => {
  it("reports retry-worker failures only after all independent channels settle", async () => {
    const failure = new Error("database unavailable");
    const push = vi.fn(async () => {});
    await expect(dispatchNotificationChannels([
      { name: "owner_email", deliver: async () => { throw failure; } },
      { name: "push", deliver: push },
    ], { throwOnError: true })).rejects.toBe(failure);
    expect(push).toHaveBeenCalledOnce();
  });
  it("still delivers push and admin notifications when owner email fails", async () => {
    const push = vi.fn(async () => {}), admin = vi.fn(async () => {});
    await expect(dispatchNotificationChannels([
      { name: "owner_email", deliver: async () => { throw new Error("Gmail API disabled"); } },
      { name: "admin_email", deliver: admin }, { name: "push", deliver: push },
    ])).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledOnce(); expect(admin).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      { channel: "owner_email", error: "Gmail API disabled" },
      "Notification channel failed; other channels continue independently",
    );
  });
  it("waits for push completion rather than releasing the outbox after email rejection", async () => {
    let finishPush!: () => void;
    const pushed = new Promise<void>(resolve => { finishPush = resolve; });
    let completed = false;
    const result = dispatchNotificationChannels([
      { name: "owner_email", deliver: async () => { throw new Error("Email failed"); } },
      { name: "push", deliver: () => pushed },
    ]).then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(completed).toBe(false);
    finishPush(); await result;
    expect(completed).toBe(true);
  });
  it("isolates even a synchronous delivery error", async () => {
    const push = vi.fn(async () => {});
    await dispatchNotificationChannels([
      { name: "owner_email", deliver: () => { throw new Error("Channel unavailable"); } },
      { name: "push", deliver: push },
    ]);
    expect(push).toHaveBeenCalledOnce();
  });
  it("delivers a subsequent lead's push while an earlier email is still waiting", async () => {
    let finishEmail!: () => void;
    const pendingEmail = new Promise<void>(resolve => { finishEmail = resolve; });
    const email = vi.fn(() => pendingEmail), push = vi.fn(async () => {});
    const channels = [{ name: "owner_email", deliver: email }, { name: "push", deliver: push }];
    const first = dispatchNotificationChannels(channels);
    await new Promise(resolve => setImmediate(resolve));
    const second = dispatchNotificationChannels(channels);
    await new Promise(resolve => setImmediate(resolve));
    expect(push).toHaveBeenCalledTimes(2);
    expect(email).toHaveBeenCalledOnce();
    finishEmail(); await Promise.all([first, second]);
    expect(email).toHaveBeenCalledTimes(2);
  });
  it("coalesces overlapping requests without concurrent sends within one channel", async () => {
    let finishPush!: () => void;
    const pendingPush = new Promise<void>(resolve => { finishPush = resolve; });
    const push = vi.fn(() => pendingPush);
    const first = dispatchNotificationChannels([{ name: "push", deliver: push }]);
    await new Promise(resolve => setImmediate(resolve));
    const second = dispatchNotificationChannels([{ name: "push", deliver: push }]);
    expect(push).toHaveBeenCalledOnce();
    finishPush(); await Promise.all([first, second]);
    expect(push).toHaveBeenCalledTimes(2);
  });
});

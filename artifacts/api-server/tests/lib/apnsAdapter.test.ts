import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:http2", () => ({
  default: { connect: mocks.connect, constants: { NGHTTP2_CANCEL: 8 } },
}));
vi.mock("node:crypto", () => ({
  createSign: () => ({ update: vi.fn(), sign: () => Buffer.from("test-signature") }),
}));
vi.mock("../../src/lib/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
import { closeApnsSession, sendApnsNotification } from "../../src/lib/apnsAdapter";

let req: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("APNS_KEY", "test-key");
  vi.stubEnv("APNS_KEY_ID", "test-key-id");
  vi.stubEnv("APNS_TEAM_ID", "test-team-id");
  req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), close: vi.fn() });
  const session = Object.assign(new EventEmitter(), { request: () => req, close: vi.fn() });
  mocks.connect.mockReturnValue(session);
});
afterEach(() => {
  closeApnsSession();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const input = { deviceToken: "test-token", title: "New lead", body: "Repair", deepLink: "/leads/1" };
describe("APNs network deadline", () => {
  it.each(["sandbox","production"] as const)("routes a device explicitly to %s regardless of the server default",async environment=>{
    const pending=sendApnsNotification({...input,environment});
    expect(mocks.connect).toHaveBeenCalledWith(environment==="production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    req.emit("response",{":status":200});req.emit("end");
    expect((await pending).outcome).toBe("delivered");
  });
  it("cancels a hung request at 10 seconds", async () => {
    const pending = sendApnsNotification(input);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual({
      outcome: "error", statusCode: 0, reason: "APNs request timed out after 10000ms",
    });
    expect(req.close).toHaveBeenCalledWith(8);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([200, 410, 503])("clears the deadline after HTTP %s", async status => {
    const pending = sendApnsNotification(input);
    req.emit("response", { ":status": status, "apns-id": "test-id" });
    req.emit("data", Buffer.from('{"reason":"Unavailable"}'));
    req.emit("end");
    expect((await pending).outcome).toBe(status === 200 ? "delivered" : status === 410 ? "invalid_token" : "error");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("settles and clears the deadline on an early stream close", async () => {
    const pending = sendApnsNotification(input);
    req.emit("close");
    expect((await pending).outcome).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
  });
});

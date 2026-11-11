import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishableKeyFromHost: vi.fn(),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: mocks.publishableKeyFromHost,
}));

import { getClerkPublishableKeyForHost } from "../../src/lib/clerkPublishableKey";

beforeEach(() => {
  mocks.publishableKeyFromHost.mockReset();
  mocks.publishableKeyFromHost.mockReturnValue("derived-key");
});

describe("getClerkPublishableKeyForHost", () => {
  it.each(["corvlio.com", "app.corvlio.com", "sub.app.corvlio.com", "APP.CORVLIO.COM:443"])(
    "uses the configured key unchanged for %s",
    (host) => {
      expect(getClerkPublishableKeyForHost(host, "configured-key")).toBe("configured-key");
      expect(mocks.publishableKeyFromHost).not.toHaveBeenCalled();
    },
  );

  it.each(["corvlio.com.evil.test", "replit.app", "localhost", "127.0.0.1:8080", undefined])(
    "keeps host-derived key behavior for %s",
    (host) => {
      expect(getClerkPublishableKeyForHost(host, "configured-key")).toBe("derived-key");
      expect(mocks.publishableKeyFromHost).toHaveBeenCalledWith(host ?? "", "configured-key");
    },
  );

  it("preserves an undefined configured key for Corvlio domains", () => {
    expect(getClerkPublishableKeyForHost("app.corvlio.com", undefined)).toBeUndefined();
    expect(mocks.publishableKeyFromHost).not.toHaveBeenCalled();
  });
});

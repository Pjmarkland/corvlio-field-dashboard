import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

const storageKey = "corvlio.clerkClient";
const nativeHeader = "X-Native-Clerk-Client";

let originalFetch: typeof window.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  window.localStorage.clear();
  originalFetch = window.fetch;
  fetchMock = vi.fn();
  fetchMock.mockResolvedValue(new Response("ok"));
  window.fetch = fetchMock as unknown as typeof window.fetch;
  await import("./nativeClerkCookieBridge");
});

afterEach(() => {
  window.fetch = originalFetch;
  window.localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("native Clerk cookie bridge", () => {
  it("bridges only a valid stored cookie to a same-origin Clerk proxy request", async () => {
    window.localStorage.setItem(storageKey, "client_saved-123");
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { headers: { [nativeHeader]: "client_rotated-456" } }),
    );

    await window.fetch("/api/__clerk/v1/client");

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
    expect(new Headers(init?.headers).get(nativeHeader)).toBe("client_saved-123");
    expect(window.localStorage.getItem(storageKey)).toBe("client_rotated-456");
  });

  it("removes invalid stored and returned cookie values", async () => {
    window.localStorage.setItem(storageKey, "bad\r\nvalue");
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { headers: { [nativeHeader]: "value=with-separator" } }),
    );

    await window.fetch("/api/__clerk/v1/client");

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
    expect(new Headers(init?.headers).has(nativeHeader)).toBe(false);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("does not bridge lookalike paths or cross-origin Clerk URLs", async () => {
    window.localStorage.setItem(storageKey, "client_saved-123");
    fetchMock.mockResolvedValue(
      new Response("ok", { headers: { [nativeHeader]: "attacker-value" } }),
    );

    await window.fetch("/api/__clerkish/v1/client");
    await window.fetch("https://attacker.example/api/__clerk/v1/client");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined();
    expect(window.localStorage.getItem(storageKey)).toBe("client_saved-123");
  });
});

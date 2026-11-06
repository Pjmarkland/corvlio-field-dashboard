import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NATIVE_API_BASE_URL } from "./nativeConfig";

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
  it("bridges the stored client cookie to the configured remote Clerk proxy", async () => {
    window.localStorage.setItem(storageKey, "client_saved-123");
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { headers: { [nativeHeader]: "client_rotated-456" } }),
    );

    await window.fetch(`${DEFAULT_NATIVE_API_BASE_URL}/api/__clerk/v1/client`);

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
    expect(new Headers(init?.headers).get(nativeHeader)).toBe("client_saved-123");
    expect(window.localStorage.getItem(storageKey)).toBe("client_rotated-456");
  });

  it("bridges the sign-in, password, and email-code requests and persists rotated client headers", async () => {
    window.localStorage.setItem(storageKey, "client_before_signin");
    const requestUrls = [
      `${DEFAULT_NATIVE_API_BASE_URL}/api/__clerk/v1/client/sign_ins`,
      `${DEFAULT_NATIVE_API_BASE_URL}/api/__clerk/v1/client/sign_ins/signin_test/attempt_first_factor`,
      `${DEFAULT_NATIVE_API_BASE_URL}/api/__clerk/v1/client/sign_ins/signin_test/prepare_first_factor`,
      `${DEFAULT_NATIVE_API_BASE_URL}/api/__clerk/v1/client/sign_ins/signin_test/attempt_first_factor`,
    ];
    const returnedClientValues = [
      "client_after_start",
      "client_after_password",
      "client_after_email_code_prepare",
      "client_after_email_code_attempt",
    ];
    fetchMock.mockImplementation(async () => {
      const value = returnedClientValues.shift();
      return new Response("ok", {
        headers: value ? { [nativeHeader]: value } : undefined,
      });
    });

    for (const requestUrl of requestUrls) {
      const clientValueSent = window.localStorage.getItem(storageKey);
      const response = await window.fetch(requestUrl, { method: "POST" });
      const [, init] = fetchMock.mock.calls.at(-1) as [RequestInfo | URL, RequestInit?];
      expect(new Headers(init?.headers).get(nativeHeader)).toBe(clientValueSent);
      expect(response.headers.get(nativeHeader)).toBeTruthy();
      expect(window.localStorage.getItem(storageKey)).toBe(
        response.headers.get(nativeHeader),
      );
    }

    expect(fetchMock).toHaveBeenCalledTimes(requestUrls.length);
    expect(window.localStorage.getItem(storageKey)).toBe("client_after_email_code_attempt");
  });

  it("removes invalid stored and returned cookie values", async () => {
    window.localStorage.setItem(storageKey, "bad\r\nvalue");
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { headers: { [nativeHeader]: "value=with-separator" } }),
    );

    await window.fetch(`${DEFAULT_NATIVE_API_BASE_URL}/api/__clerk/v1/client`);

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
    expect(new Headers(init?.headers).has(nativeHeader)).toBe(false);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("does not bridge a local, lookalike, or unconfigured cross-origin URL", async () => {
    window.localStorage.setItem(storageKey, "client_saved-123");
    fetchMock.mockResolvedValue(
      new Response("ok", { headers: { [nativeHeader]: "attacker-value" } }),
    );

    await window.fetch("/api/__clerk/v1/client");
    await window.fetch(`${DEFAULT_NATIVE_API_BASE_URL}/api/__clerkish/v1/client`);
    await window.fetch("https://attacker.example/api/__clerk/v1/client");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toBeUndefined();
    }
    expect(window.localStorage.getItem(storageKey)).toBe("client_saved-123");
  });

  it("does not bridge a same-path URL on a different origin", async () => {
    window.localStorage.setItem(storageKey, "client_saved-123");

    await window.fetch("/api/__clerkish/v1/client");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(window.localStorage.getItem(storageKey)).toBe("client_saved-123");
  });
});

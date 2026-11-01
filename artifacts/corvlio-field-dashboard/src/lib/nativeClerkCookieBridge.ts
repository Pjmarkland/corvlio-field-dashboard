import { Capacitor } from '@capacitor/core';

const NATIVE_CLERK_CLIENT_STORAGE_KEY = 'corvlio.clerkClient';
const NATIVE_CLERK_CLIENT_HEADER = 'X-Native-Clerk-Client';
const CLERK_PROXY_PATH_SEGMENT = '/api/__clerk';

if (Capacitor.isNativePlatform()) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const inputUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    let path: string;
    try {
      path = new URL(inputUrl, window.location.href).pathname;
    } catch {
      return originalFetch(input, init);
    }

    if (!path.includes(CLERK_PROXY_PATH_SEGMENT)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }

    try {
      const clientValue = window.localStorage.getItem(
        NATIVE_CLERK_CLIENT_STORAGE_KEY,
      );
      if (clientValue) {
        headers.set(NATIVE_CLERK_CLIENT_HEADER, clientValue);
      }
    } catch {
      // Storage can be unavailable in hardened WebView contexts.
    }

    const response = await originalFetch(input, { ...init, headers });
    const clientValue = response.headers.get(NATIVE_CLERK_CLIENT_HEADER);
    if (clientValue !== null) {
      try {
        if (clientValue) {
          window.localStorage.setItem(
            NATIVE_CLERK_CLIENT_STORAGE_KEY,
            clientValue,
          );
        } else {
          window.localStorage.removeItem(NATIVE_CLERK_CLIENT_STORAGE_KEY);
        }
      } catch {
        // Keep the request usable if WebView storage is unavailable.
      }
    }

    return response;
  };
}

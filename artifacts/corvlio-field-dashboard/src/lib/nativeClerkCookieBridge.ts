import { Capacitor } from '@capacitor/core';
import { getNativeApiBaseUrl, getNativeClerkProxyUrl } from './nativeConfig';

const NATIVE_CLERK_CLIENT_STORAGE_KEY = 'corvlio.clerkClient';
const NATIVE_CLERK_CLIENT_HEADER = 'X-Native-Clerk-Client';
const MAX_NATIVE_CLERK_CLIENT_COOKIE_LENGTH = 4096;
const NATIVE_CLERK_CLIENT_COOKIE_PATTERN = /^[A-Za-z0-9._~%-]+$/;
const nativeClerkProxyUrl = getNativeClerkProxyUrl(
  import.meta.env.VITE_CLERK_PROXY_URL,
  getNativeApiBaseUrl(import.meta.env.VITE_NATIVE_API_BASE_URL),
);

function isValidNativeClientValue(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_NATIVE_CLERK_CLIENT_COOKIE_LENGTH
    && NATIVE_CLERK_CLIENT_COOKIE_PATTERN.test(value);
}

function isClerkProxyRequest(inputUrl: string): boolean {
  try {
    const url = new URL(inputUrl, window.location.href);
    const proxy = new URL(nativeClerkProxyUrl, window.location.href);
    const proxyPath = proxy.pathname.replace(/\/+$/, '') || '/';
    return url.origin === proxy.origin
      && (url.pathname === proxyPath || url.pathname.startsWith(`${proxyPath}/`));
  } catch {
    return false;
  }
}

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

    if (!isClerkProxyRequest(inputUrl)) {
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
      if (clientValue && isValidNativeClientValue(clientValue)) {
        headers.set(NATIVE_CLERK_CLIENT_HEADER, clientValue);
      } else if (clientValue !== null) {
        window.localStorage.removeItem(NATIVE_CLERK_CLIENT_STORAGE_KEY);
      }
    } catch {
      // Storage can be unavailable in hardened WebView contexts.
    }

    const response = await originalFetch(input, { ...init, headers });
    const clientValue = response.headers.get(NATIVE_CLERK_CLIENT_HEADER);
    if (clientValue !== null) {
      try {
        if (isValidNativeClientValue(clientValue)) {
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

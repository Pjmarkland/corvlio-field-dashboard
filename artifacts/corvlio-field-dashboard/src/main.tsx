import './lib/nativeClerkCookieBridge';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const LEGACY_LEADS_STORAGE_KEY = 'corvlio-leads-v1';

try {
  localStorage.removeItem(LEGACY_LEADS_STORAGE_KEY);
} catch {
  // Storage can be unavailable in hardened browser contexts; the app remains usable.
}

// ─── Native API bootstrap ─────────────────────────────────────────────────────
// Web builds stay on same-origin cookies and relative /api/… paths.
// Native Capacitor builds need an absolute API origin and an explicit bearer
// token because the WebView has no session cookie.
if (Capacitor.isNativePlatform()) {
  const nativeApiBase = import.meta.env.VITE_NATIVE_API_BASE_URL as string | undefined;
  if (nativeApiBase) {
    setBaseUrl(nativeApiBase);
  }

  // window.Clerk is the Clerk JS SDK singleton, available after ClerkProvider
  // mounts. The getter is invoked lazily on every fetch so it always returns
  // the current session token, even after sign-in or token rotation.
  setAuthTokenGetter(async () => {
    try {
      type ClerkWindow = Window & typeof globalThis & {
        Clerk?: { session?: { getToken(): Promise<string | null> } };
      };
      return (await (window as ClerkWindow).Clerk?.session?.getToken()) ?? null;
    } catch {
      return null;
    }
  });
}

if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
    .then((registration) => registration.update())
    .catch(() => {
      // The dashboard remains fully usable when service workers are unavailable.
    });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

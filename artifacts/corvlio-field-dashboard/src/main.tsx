import './lib/nativeClerkCookieBridge';
import { useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

import { ErrorBoundary, type ErrorFallbackProps } from '@/components/error-boundary';
import { StartupFailureScreen } from '@/components/StartupFailureScreen';
import { getAppBuildInfo } from '@/lib/buildInfo';
import { getNativeApiBaseUrl } from '@/lib/nativeConfig';

import './index.css';

const LEGACY_LEADS_STORAGE_KEY = 'corvlio-leads-v1';
const native = Capacitor.isNativePlatform();

try {
  localStorage.removeItem(LEGACY_LEADS_STORAGE_KEY);
} catch {
  // Storage can be unavailable in hardened browser contexts; the app remains usable.
}

// ─── Native API bootstrap ─────────────────────────────────────────────────────
// Web builds stay on same-origin cookies and relative /api/… paths.
// Native Capacitor builds need an absolute API origin and an explicit bearer
// token because the WebView has no session cookie.
if (native) {
  setBaseUrl(getNativeApiBaseUrl(import.meta.env.VITE_NATIVE_API_BASE_URL));

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

if (!native && 'serviceWorker' in navigator && import.meta.env.PROD) {
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

function StartupLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex min-h-[100dvh] items-center justify-center bg-[#071527] px-6 text-center text-white"
    >
      <div>
        <p className="text-sm font-medium">Loading Corvlio Field Desk…</p>
        <p className="mt-2 text-xs text-white/55">{getAppBuildInfo()}</p>
      </div>
    </main>
  );
}

function StartupFailure({ error }: ErrorFallbackProps) {
  return <StartupFailureScreen error={error} />;
}

function AppBootstrap() {
  const [LoadedApp, setLoadedApp] = useState<ComponentType | null>(null);
  const [startupError, setStartupError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    void import('./App')
      .then(({ default: App }) => {
        if (!active) return;
        setLoadedApp(() => App);
        (window as Window & { corvlioStartupComplete?: () => void })
          .corvlioStartupComplete?.();
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStartupError(
          error instanceof Error ? error : new Error('The app could not load.'),
        );
      });

    return () => {
      active = false;
    };
  }, []);

  if (startupError) {
    return (
      <StartupFailure
        error={startupError}
        resetError={() => window.location.reload()}
      />
    );
  }
  if (!LoadedApp) return <StartupLoading />;
  return <LoadedApp />;
}

const root = createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: () => {
    console.error("Unexpected dashboard render error");
  },
});

root.render(
  <ErrorBoundary FallbackComponent={StartupFailure}>
    <AppBootstrap />
  </ErrorBoundary>,
);

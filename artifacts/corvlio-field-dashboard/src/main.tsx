import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const LEGACY_LEADS_STORAGE_KEY = 'corvlio-leads-v1';

try {
  localStorage.removeItem(LEGACY_LEADS_STORAGE_KEY);
} catch {
  // Storage can be unavailable in hardened browser contexts; the app remains usable.
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

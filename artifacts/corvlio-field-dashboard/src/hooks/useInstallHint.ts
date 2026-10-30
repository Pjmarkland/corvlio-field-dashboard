import { useCallback, useEffect, useState } from 'react';

export const INSTALL_HINT_KEY = 'corvlio-install-hint-dismissed';

type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice?: Promise<unknown> };
export type InstallEnv = { native: boolean; standalone: boolean; userAgent: string; touch: boolean };

export function installPlatform(env: InstallEnv): 'ios' | 'android' | null {
  if (env.native || env.standalone) return null;
  const ua = env.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'ios';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && env.touch)) return null;
  if (/Android/.test(ua) && /Mobile/.test(ua)) return 'android';
  return null;
}

export function useInstallHint(native: boolean) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_HINT_KEY) === '1'; } catch { return false; }
  });
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const standalone = typeof window !== 'undefined' && (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const platform = installPlatform({ native, standalone, userAgent: navigator.userAgent, touch: navigator.maxTouchPoints > 1 });

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as DeferredPrompt); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(INSTALL_HINT_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  }, []);
  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    setDeferred(null);
    dismiss();
  }, [deferred, dismiss]);

  return { visible: !dismissed && platform !== null, platform, canPrompt: !!deferred, install, dismiss };
}

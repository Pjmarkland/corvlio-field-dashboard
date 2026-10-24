import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  getGetWebPushConfigQueryKey,
  getWebPushConfig,
  registerWebPushSubscription,
  revokeWebPushSubscription,
  useGetWebPushConfig,
} from '@workspace/api-client-react';

export type WebPushStatus =
  | 'checking'
  | 'off'
  | 'registered'
  | 'requesting'
  | 'revoking'
  | 'denied'
  | 'unsupported'
  | 'error';

function isSupported(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const decoded = window.atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Service worker is not ready')), 15_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 409) {
    return 'This browser is linked to another account. Sign out of that account before enabling alerts here.';
  }
  return 'Could not update browser notifications. Check your connection and try again.';
}

export function useWebPushNotifications(userId: string | undefined) {
  const config = useGetWebPushConfig({
    query: {
      queryKey: getGetWebPushConfigQueryKey(),
      enabled: Boolean(userId) && !Capacitor.isNativePlatform(),
      retry: false,
      staleTime: 5 * 60_000,
    },
  });
  const [status, setStatus] = useState<WebPushStatus>('checking');
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSubscription = useCallback(async () => {
    setError(null);
    if (!userId || Capacitor.isNativePlatform()) {
      setEnabled(false);
      setStatus('off');
      return;
    }
    if (!isSupported()) {
      setEnabled(false);
      setStatus('unsupported');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      setEnabled(Boolean(subscription));
      setStatus(subscription ? 'registered' : Notification.permission === 'denied' ? 'denied' : 'off');
    } catch {
      setEnabled(false);
      setStatus('error');
      setError('Could not check this browser’s notification settings.');
    }
  }, [userId]);

  useEffect(() => {
    setStatus('checking');
    setEnabled(false);
    setError(null);
    void checkSubscription();
  }, [checkSubscription]);

  const register = useCallback(async () => {
    if (!userId || Capacitor.isNativePlatform()) return;
    if (!isSupported()) {
      setStatus('unsupported');
      return;
    }

    setStatus('requesting');
    setError(null);
    let createdSubscription: PushSubscription | null = null;
    try {
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setEnabled(false);
        setStatus('denied');
        return;
      }

      let publicKey = config.data?.publicKey;
      if (!config.data) publicKey = (await getWebPushConfig()).publicKey;
      if (!publicKey) {
        setEnabled(false);
        setStatus('off');
        setError('Browser notifications are not configured for this account yet.');
        return;
      }

      const registration = await serviceWorkerReady();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey) as BufferSource,
      });
      if (!existing) createdSubscription = subscription;

      const serialized = subscription.toJSON();
      if (!serialized.keys?.p256dh || !serialized.keys.auth) {
        throw new Error('Browser subscription keys are missing');
      }
      await registerWebPushSubscription({
        endpoint: subscription.endpoint,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
        expirationTime: subscription.expirationTime,
      });
      setEnabled(true);
      setStatus('registered');
    } catch (caught) {
      if (createdSubscription) {
        try { await createdSubscription.unsubscribe(); } catch { /* Keep the registration error visible. */ }
      }
      setEnabled(false);
      setStatus('error');
      setError(errorMessage(caught));
    }
  }, [config.data, userId]);

  const revoke = useCallback(async () => {
    if (!userId || Capacitor.isNativePlatform()) return;
    setStatus('revoking');
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await revokeWebPushSubscription({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEnabled(false);
      setStatus('off');
    } catch {
      setEnabled(true);
      setStatus('error');
      setError('Could not disable notifications on this browser. Try again.');
      throw new Error('Could not revoke browser notification subscription');
    }
  }, [userId]);

  const retry = useCallback(async () => {
    if (userId && !Capacitor.isNativePlatform()) await config.refetch();
    await checkSubscription();
  }, [checkSubscription, config, userId]);

  return {
    status,
    enabled,
    error,
    available: Boolean(config.data?.available),
    configLoading: config.isLoading,
    configError: config.isError,
    register,
    revoke,
    retry,
  };
}

/**
 * usePushNotifications
 *
 * Manages Capacitor push-notification registration for native iOS/Android builds.
 * On the web PWA this hook is a no-op (Capacitor.isNativePlatform() is false).
 *
 * Listener lifecycle (Capacitor's documented order):
 *   1. checkPermissions / requestPermissions
 *   2. addListener('registration')      ─┐ both awaited (Promise.allSettled)
 *   3. addListener('registrationError') ─┘ BEFORE register() is called
 *   4. PushNotifications.register() — fires the APNs/FCM handshake
 *   5. OS delivers token (or error) → listener callback settles tokenPromise
 *   6. POST /notification-devices with the token
 *
 * Cleanup guarantees:
 *   - callbackFired flag: if the callback fires synchronously during addListener
 *     (before Promise.allSettled populates the handles), handles are removed in a
 *     second doCleanup() call made right after Promise.allSettled resolves.
 *   - Promise.allSettled (not Promise.all): captures handles from whichever
 *     addListener calls succeeded so they can be cleaned up on partial failure.
 *
 * Revocation contract:
 *   - Device ID is stored in both an in-memory Map and localStorage.
 *     If localStorage is unavailable the Map is the single source of truth.
 *   - revoke() does NOT clear local state until the backend confirms deletion
 *     (or returns 404 = already gone).  Non-404 failures throw so callers
 *     (e.g. sign-out) can block and surface the error.
 */

import { useCallback, useEffect, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  registerNotificationDevice,
  revokeNotificationDevice,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushStatus =
  | 'idle'
  | 'requesting'
  | 'registered'
  | 'revoking'
  | 'denied'
  | 'error';

// ---------------------------------------------------------------------------
// Module-level device-ID store (in-memory + localStorage)
// ---------------------------------------------------------------------------

const inMemoryDeviceIds = new Map<string, number>();

function deviceIdKey(userId: string): string {
  return `push_device_id:${userId}`;
}

function setStoredDeviceId(userId: string, deviceId: number): void {
  inMemoryDeviceIds.set(userId, deviceId);
  try {
    localStorage.setItem(deviceIdKey(userId), String(deviceId));
  } catch {
    // In-memory Map is the fallback when localStorage is unavailable.
  }
}

function getStoredDeviceId(userId: string): number | null {
  const mem = inMemoryDeviceIds.get(userId);
  if (mem != null) return mem;
  try {
    const raw = localStorage.getItem(deviceIdKey(userId));
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    inMemoryDeviceIds.set(userId, n);
    return n;
  } catch {
    return null;
  }
}

function clearStoredDeviceId(userId: string): void {
  inMemoryDeviceIds.delete(userId);
  try {
    localStorage.removeItem(deviceIdKey(userId));
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// 404-detection helper (ApiError is not re-exported from the package index)
// ---------------------------------------------------------------------------

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    (err as { status: number }).status === 404
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const REGISTRATION_TIMEOUT_MS = 30_000;

export function usePushNotifications(userId: string | undefined) {
  const [status, setStatus] = useState<PushStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Restore registration state on cold start.
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    if (getStoredDeviceId(userId) != null) setStatus('registered');
  }, [userId]);

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  const register = useCallback(async () => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;

    setStatus('requesting');
    setError(null);

    // ── 1. Permission ──────────────────────────────────────────────────────
    try {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        setStatus('denied');
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not check notification permission.';
      setError(msg);
      setStatus('error');
      return;
    }

    // ── 2. Listener setup ──────────────────────────────────────────────────
    //
    // Deferred promise: listener callbacks resolve/reject this pair.
    let resolveToken!: (token: string) => void;
    let rejectToken!: (err: Error) => void;
    const tokenPromise = new Promise<string>((res, rej) => {
      resolveToken = res;
      rejectToken = rej;
    });

    // Mutable references populated after Promise.allSettled resolves.
    let regHandle: PluginListenerHandle | undefined;
    let errHandle: PluginListenerHandle | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // callbackFired: set to true by the listener callback.  If the callback
    // fires synchronously during addListener (before Promise.allSettled can
    // populate the handles), we detect this and call doCleanup() again right
    // after allSettled resolves.
    let callbackFired = false;

    const doCleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      void regHandle?.remove();
      void errHandle?.remove();
    };

    // 2a. Attach both listeners — use Promise.allSettled so we always get
    //     both results and can clean up whichever handles were attached even
    //     on partial failure.  Awaiting allSettled guarantees both listeners
    //     are registered before PushNotifications.register() is called.
    const listenerResults = await Promise.allSettled([
      PushNotifications.addListener('registration', (token) => {
        callbackFired = true;
        doCleanup();
        resolveToken(token.value);
      }),
      PushNotifications.addListener('registrationError', (regErr) => {
        callbackFired = true;
        doCleanup();
        const msg =
          typeof regErr?.error === 'string'
            ? regErr.error
            : 'Push token registration failed.';
        rejectToken(new Error(msg));
      }),
    ]);

    const [regResult, errResult] = listenerResults;
    if (regResult.status === 'fulfilled') regHandle = regResult.value;
    if (errResult.status === 'fulfilled') errHandle = errResult.value;

    // Handle partial or total listener setup failure.
    if (regResult.status === 'rejected' || errResult.status === 'rejected') {
      doCleanup(); // remove any successfully attached listener
      const reason: unknown =
        regResult.status === 'rejected'
          ? regResult.reason
          : errResult.status === 'rejected'
            ? errResult.reason
            : undefined;
      const msg =
        reason instanceof Error ? reason.message : 'Failed to set up push listeners.';
      setError(msg);
      setStatus('error');
      return;
    }

    // If the callback already fired synchronously during addListener, the
    // earlier doCleanup() had undefined handles.  Now that allSettled has
    // populated them, remove them immediately.
    if (callbackFired) {
      doCleanup();
      // tokenPromise is already settled — fall through to await it below.
    } else {
      // 2b. Bounded timeout: surface an error if the OS never responds.
      timeoutId = setTimeout(() => {
        doCleanup();
        rejectToken(new Error('Push registration timed out. Please try again.'));
      }, REGISTRATION_TIMEOUT_MS);

      // 2c. Trigger the APNs/FCM handshake AFTER listeners are in place.
      try {
        await PushNotifications.register();
      } catch (err) {
        doCleanup();
        const msg = err instanceof Error ? err.message : 'Failed to start push registration.';
        setError(msg);
        setStatus('error');
        return;
      }
    }

    // 2d. Await the OS callback (immediate if synchronous delivery).
    let tokenValue: string;
    try {
      tokenValue = await tokenPromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Push registration failed.';
      setError(msg);
      setStatus('error');
      return;
    }

    // ── 3. Register token with the backend ─────────────────────────────────
    const platform = Capacitor.getPlatform() as 'ios' | 'android' | string;
    try {
      const device = await registerNotificationDevice({
        token: tokenValue,
        platform: platform as 'ios' | 'android',
        enabled: true,
      });
      setStoredDeviceId(userId, device.id);
      setStatus('registered');
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register device with server.';
      setError(msg);
      setStatus('error');
    }
  }, [userId]);

  // -------------------------------------------------------------------------
  // revoke — clears local state ONLY after backend confirms deletion.
  //
  // Throws on non-404 failures so callers (e.g. sign-out) can block and
  // surface the error to the user.
  // -------------------------------------------------------------------------

  const revoke = useCallback(async () => {
    if (!userId) return;
    if (!Capacitor.isNativePlatform()) return;

    const deviceId = getStoredDeviceId(userId);
    if (deviceId == null) {
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('revoking');
    setError(null);

    try {
      await revokeNotificationDevice(deviceId);
    } catch (err) {
      if (isNotFound(err)) {
        // Server already deleted the record — idempotent success.
        clearStoredDeviceId(userId);
        setStatus('idle');
        setError(null);
        return;
      }
      // Keep device ID intact so the user can retry.
      const msg = err instanceof Error ? err.message : 'Failed to disable push alerts.';
      setError(msg);
      setStatus('error');
      throw err instanceof Error ? err : new Error(msg);
    }

    // Backend confirmed — now safe to clear local state.
    clearStoredDeviceId(userId);
    setStatus('idle');
    setError(null);
  }, [userId]);

  return { status, error, register, revoke };
}

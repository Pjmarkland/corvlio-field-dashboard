/**
 * usePushNotifications — unit tests
 *
 * Covers:
 *   - Listener-before-register ordering (both listeners attached before register())
 *   - Synchronous callback: token delivered during addListener → handles removed after allSettled
 *   - Plugin rejection: register() throws → error state, no backend call
 *   - registrationError callback → error state
 *   - Partial listener setup failure → surviving handle removed
 *   - Successful revocation (local state cleared only after backend confirms)
 *   - 404 revocation treated as idempotent success
 *   - Network failure keeps device ID intact and throws
 *   - Sign-out ordering: revoke() throws so callers can block sign-out
 *   - localStorage unavailable: in-memory fallback preserves device ID
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
vi.mock('@/lib/pushEnvironment',()=>({iosPushEnvironment:async()=>undefined}));

// ---------------------------------------------------------------------------
// Hoist mock fns so vi.mock factories can reference them safely
// ---------------------------------------------------------------------------

const {
  mockRegisterNotificationDevice,
  mockRevokeNotificationDevice,
  mockCheckPermissions,
  mockRegister,
  mockAddListener,
} = vi.hoisted(() => ({
  mockRegisterNotificationDevice: vi.fn(),
  mockRevokeNotificationDevice: vi.fn(),
  mockCheckPermissions: vi.fn(),
  mockRegister: vi.fn(),
  mockAddListener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: mockCheckPermissions,
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: mockRegister,
    addListener: mockAddListener,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  registerNotificationDevice: mockRegisterNotificationDevice,
  revokeNotificationDevice: mockRevokeNotificationDevice,
}));

// ---------------------------------------------------------------------------
// Import hook AFTER mocks
// ---------------------------------------------------------------------------

import { usePushNotifications } from './usePushNotifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user_test_001';
const DEVICE_ID = 42;

function storageKey(userId: string) {
  return `push_device_id:${userId}`;
}

/**
 * Build a realistic pair of addListener + register mocks that deliver the
 * token AFTER register() is called (matching real APNs/FCM timing).
 *
 * @param callLog  Optional array to record call order for ordering assertions.
 */
function makeRealisticMocks(callLog?: Array<string>) {
  let registrationCb: ((arg: { value: string }) => void) | null = null;

  const addListenerMock = vi.fn().mockImplementation(
    (event: string, cb: (arg: unknown) => void) => {
      callLog?.push(`addListener:${event}`);
      if (event === 'registration') {
        registrationCb = cb as (arg: { value: string }) => void;
      }
      return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) });
    },
  );

  const registerMock = vi.fn().mockImplementation(async () => {
    callLog?.push('register');
    // Deliver token in next microtask after register() — simulates APNs bridge.
    await Promise.resolve();
    registrationCb?.({ value: 'device-token-abc' });
  });

  return { addListenerMock, registerMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mockCheckPermissions.mockResolvedValue({ receive: 'granted' });
    mockRegisterNotificationDevice.mockResolvedValue({ id: DEVICE_ID, token: 'device-token-abc' });
    mockRevokeNotificationDevice.mockResolvedValue(undefined);

    // Default: realistic APNs timing — token delivered only AFTER register() is called.
    const { addListenerMock, registerMock } = makeRealisticMocks();
    mockAddListener.mockImplementation(addListenerMock);
    mockRegister.mockImplementation(registerMock);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Listener-before-register ordering
  // -------------------------------------------------------------------------

  it('attaches both listeners BEFORE calling PushNotifications.register()', async () => {
    const callLog: string[] = [];
    const { addListenerMock, registerMock } = makeRealisticMocks(callLog);
    mockAddListener.mockImplementation(addListenerMock);
    mockRegister.mockImplementation(registerMock);

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    const regIdx = callLog.indexOf('addListener:registration');
    const errIdx = callLog.indexOf('addListener:registrationError');
    const regFnIdx = callLog.indexOf('register');

    expect(regIdx).toBeGreaterThanOrEqual(0);
    expect(errIdx).toBeGreaterThanOrEqual(0);
    expect(regFnIdx).toBeGreaterThanOrEqual(0);
    expect(regIdx).toBeLessThan(regFnIdx);
    expect(errIdx).toBeLessThan(regFnIdx);
  });

  // -------------------------------------------------------------------------
  // Synchronous / early callback with handle-removal verification
  // -------------------------------------------------------------------------

  it('handles a synchronous callback and removes both listener handles', async () => {
    const removeMocks: ReturnType<typeof vi.fn>[] = [];

    mockAddListener.mockImplementation((event: string, cb: (arg: unknown) => void) => {
      if (event === 'registration') {
        cb({ value: 'sync-token' }); // synchronous delivery
      }
      const removeMock = vi.fn().mockResolvedValue(undefined);
      removeMocks.push(removeMock);
      return Promise.resolve({ remove: removeMock });
    });
    mockRegisterNotificationDevice.mockResolvedValue({ id: DEVICE_ID, token: 'sync-token' });

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    expect(result.current.status).toBe('registered');
    // Both handles must have been removed (cleanup after allSettled resolves).
    expect(removeMocks).toHaveLength(2);
    for (const remove of removeMocks) {
      expect(remove).toHaveBeenCalled();
    }
  });

  // -------------------------------------------------------------------------
  // Partial listener setup failure — surviving handle must be removed
  // -------------------------------------------------------------------------

  it('removes the surviving handle when one addListener call fails', async () => {
    const removeMock = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;

    mockAddListener.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First listener attaches successfully.
        return Promise.resolve({ remove: removeMock });
      }
      // Second listener fails.
      return Promise.reject(new Error('Listener setup failed'));
    });

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    expect(result.current.status).toBe('error');
    // The first handle must have been cleaned up.
    expect(removeMock).toHaveBeenCalled();
    // Backend must NOT have been called.
    expect(mockRegisterNotificationDevice).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Plugin rejection — register() throws
  // -------------------------------------------------------------------------

  it('sets error state when PushNotifications.register() rejects', async () => {
    mockRegister.mockRejectedValue(new Error('Bridge unavailable'));

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/bridge unavailable/i);
    expect(mockRegisterNotificationDevice).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // registrationError callback
  // -------------------------------------------------------------------------

  it('sets error state when the registrationError listener fires', async () => {
    mockAddListener.mockImplementation((event: string, cb: (arg: unknown) => void) => {
      if (event === 'registrationError') {
        Promise.resolve().then(() => cb({ error: 'APNs rejected the request' }));
      }
      return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) });
    });

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/apns rejected/i);
    expect(mockRegisterNotificationDevice).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Successful revocation
  // -------------------------------------------------------------------------

  it('clears local state ONLY after backend confirms revocation', async () => {
    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    expect(result.current.status).toBe('registered');
    expect(localStorage.getItem(storageKey(USER_ID))).toBe(String(DEVICE_ID));

    await act(async () => { await result.current.revoke(); });

    expect(mockRevokeNotificationDevice).toHaveBeenCalledWith(DEVICE_ID);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(localStorage.getItem(storageKey(USER_ID))).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 404 = already revoked → idempotent success
  // -------------------------------------------------------------------------

  it('treats a 404 revocation response as idempotent success', async () => {
    localStorage.setItem(storageKey(USER_ID), String(DEVICE_ID));
    mockRevokeNotificationDevice.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 }),
    );

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => {}); // mount → restores 'registered'
    expect(result.current.status).toBe('registered');

    await act(async () => { await result.current.revoke(); });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(localStorage.getItem(storageKey(USER_ID))).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Network / server failure — device ID retained
  // -------------------------------------------------------------------------

  it('keeps device ID and surfaces error state when revocation fails', async () => {
    localStorage.setItem(storageKey(USER_ID), String(DEVICE_ID));
    mockRevokeNotificationDevice.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => {});

    await act(async () => {
      await expect(result.current.revoke()).rejects.toThrow('Network error');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/network error/i);
    // Device ID MUST still exist for retry.
    expect(localStorage.getItem(storageKey(USER_ID))).toBe(String(DEVICE_ID));
  });

  // -------------------------------------------------------------------------
  // Sign-out ordering — revoke() throws so callers block sign-out
  // -------------------------------------------------------------------------

  it('revoke() throws on failure so callers can observe and block sign-out', async () => {
    localStorage.setItem(storageKey(USER_ID), String(DEVICE_ID));
    mockRevokeNotificationDevice.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => {});

    let signedOut = false;
    await act(async () => {
      try {
        await result.current.revoke();
        signedOut = true; // must NOT reach here
      } catch {
        // caller blocks sign-out
      }
    });

    expect(signedOut).toBe(false);
  });

  // -------------------------------------------------------------------------
  // localStorage unavailable — in-memory fallback
  // -------------------------------------------------------------------------

  it('retains device ID in memory when localStorage is unavailable', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockReturnValue(null);

    const { result } = renderHook(() => usePushNotifications(USER_ID));
    await act(async () => { await result.current.register(); });

    expect(result.current.status).toBe('registered');

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();

    // In-memory Map has the ID — revocation must still work.
    await act(async () => { await result.current.revoke(); });

    expect(mockRevokeNotificationDevice).toHaveBeenCalledWith(DEVICE_ID);
    expect(result.current.status).toBe('idle');
  });
});

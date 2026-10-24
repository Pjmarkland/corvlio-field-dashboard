import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  register: vi.fn(),
  revoke: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetWebPushConfigQueryKey: () => ['/api/web-push/config'],
  getWebPushConfig: mocks.getConfig,
  registerWebPushSubscription: mocks.register,
  revokeWebPushSubscription: mocks.revoke,
  useGetWebPushConfig: () => ({
    data: { available: true, publicKey: 'AQIDBA' },
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  }),
}));

import { useWebPushNotifications } from './useWebPushNotifications';

let restoreServiceWorker: PropertyDescriptor | undefined;
let restoreNotification: PropertyDescriptor | undefined;
let restorePushManager: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  restoreServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  restoreNotification = Object.getOwnPropertyDescriptor(window, 'Notification');
  restorePushManager = Object.getOwnPropertyDescriptor(window, 'PushManager');
  mocks.register.mockResolvedValue({ registered: true });
  mocks.revoke.mockImplementation(async () => {
    actions.push('server');
  });
  mocks.refetch.mockResolvedValue({ data: { available: true, publicKey: 'AQIDBA' } });
});

const actions: string[] = [];

afterEach(() => {
  if (restoreServiceWorker) Object.defineProperty(navigator, 'serviceWorker', restoreServiceWorker);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
  if (restoreNotification) Object.defineProperty(window, 'Notification', restoreNotification);
  else delete (window as Window & { Notification?: typeof Notification }).Notification;
  if (restorePushManager) Object.defineProperty(window, 'PushManager', restorePushManager);
  else delete (window as Window & { PushManager?: typeof PushManager }).PushManager;
  actions.length = 0;
});

describe('useWebPushNotifications', () => {
  it('asks for permission only after the owner opts in, then registers with the server', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    class FakeNotification {}
    Object.defineProperty(FakeNotification, 'permission', { value: 'default', configurable: true });
    Object.defineProperty(FakeNotification, 'requestPermission', { value: requestPermission, configurable: true });
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });

    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      expirationTime: null,
      toJSON: () => ({ keys: { p256dh: 'browser-key', auth: 'browser-auth' } }),
      unsubscribe: vi.fn(async () => {
        actions.push('local');
        return true;
      }),
    };
    const getSubscription = vi.fn()
      .mockResolvedValueOnce(null) // initial state check
      .mockResolvedValueOnce(null) // opt-in lookup before subscribe
      .mockResolvedValueOnce(subscription); // disable lookup
    const registration = {
      pushManager: {
        getSubscription,
        subscribe: vi.fn().mockResolvedValue(subscription),
      },
    } as unknown as ServiceWorkerRegistration;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(registration),
        getRegistration: vi.fn().mockResolvedValue(registration),
      },
      configurable: true,
    });

    const { result } = renderHook(() => useWebPushNotifications('owner-a'));
    await waitFor(() => expect(result.current.status).toBe('off'));
    expect(requestPermission).not.toHaveBeenCalled();

    await act(async () => result.current.register());
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(mocks.register).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      keys: { p256dh: 'browser-key', auth: 'browser-auth' },
      expirationTime: null,
    });
    expect(result.current.enabled).toBe(true);

    await act(async () => result.current.revoke());
    expect(actions).toEqual(['server', 'local']);
    expect(result.current.enabled).toBe(false);
  });

  it('does not issue browser push permission prompts in native builds', async () => {
    const { result } = renderHook(() => useWebPushNotifications(undefined));
    await waitFor(() => expect(result.current.status).toBe('off'));
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

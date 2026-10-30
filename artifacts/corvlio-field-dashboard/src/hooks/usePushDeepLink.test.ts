/**
 * usePushDeepLink — unit tests
 *
 * Covers:
 *   - No-op on web (isNativePlatform returns false)
 *   - actionPerformed navigates to deepLink via location setter
 *   - actionPerformed with no deepLink does not navigate
 *   - pushNotificationReceived fires toast with correct title/description
 *   - Both listeners are removed on unmount
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoist mock fns so vi.mock factories can reference them safely
// ---------------------------------------------------------------------------

const {
  mockIsNativePlatform,
  mockAddListener,
  mockSetLocation,
  mockToast,
} = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn(() => true),
  mockAddListener: vi.fn(),
  mockSetLocation: vi.fn(),
  mockToast: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mockIsNativePlatform,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: mockAddListener,
  },
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: mockToast,
}));

// ToastAction is rendered as JSX inside the hook; a stub is enough for tests.
vi.mock('@/components/ui/toast', () => ({
  ToastAction: ({ children }: { children: unknown }) => children,
}));

// ---------------------------------------------------------------------------
// Import hook AFTER mocks
// ---------------------------------------------------------------------------

import { usePushDeepLink } from './usePushDeepLink';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePushDeepLink', () => {
  let actionPerformedCb: ((action: unknown) => void) | null = null;
  let receivedCb: ((notification: unknown) => void) | null = null;
  let actionPerformedRemove: ReturnType<typeof vi.fn>;
  let receivedRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNativePlatform.mockReturnValue(true);

    actionPerformedCb = null;
    receivedCb = null;
    actionPerformedRemove = vi.fn().mockResolvedValue(undefined);
    receivedRemove = vi.fn().mockResolvedValue(undefined);

    mockAddListener.mockImplementation((event: string, cb: (arg: unknown) => void) => {
      if (event === 'pushNotificationActionPerformed') {
        actionPerformedCb = cb;
        return Promise.resolve({ remove: actionPerformedRemove });
      }
      if (event === 'pushNotificationReceived') {
        receivedCb = cb;
        return Promise.resolve({ remove: receivedRemove });
      }
      return Promise.resolve({ remove: vi.fn() });
    });
  });

  afterEach(() => {
    actionPerformedCb = null;
    receivedCb = null;
  });

  // -------------------------------------------------------------------------
  // No-op on web
  // -------------------------------------------------------------------------

  it('is a no-op on web — does not attach any listeners when isNativePlatform is false', () => {
    mockIsNativePlatform.mockReturnValue(false);

    renderHook(() => usePushDeepLink());

    expect(mockAddListener).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // actionPerformed → navigation
  // -------------------------------------------------------------------------

  it('navigates to the deepLink path when pushNotificationActionPerformed fires', async () => {
    renderHook(() => usePushDeepLink());
    // Let addListener promises resolve so the effect settles.
    await act(async () => { await Promise.resolve(); });

    expect(mockAddListener).toHaveBeenCalledWith(
      'pushNotificationActionPerformed',
      expect.any(Function),
    );

    act(() => {
      actionPerformedCb?.({
        actionId: 'tap',
        notification: { id: '1', data: { deepLink: '/leads/abc-123' } },
      });
    });

    expect(mockSetLocation).toHaveBeenCalledWith('/leads/abc-123');
  });

  it('does not call setLocation when actionPerformed notification has no deepLink', async () => {
    renderHook(() => usePushDeepLink());
    await act(async () => { await Promise.resolve(); });

    act(() => {
      actionPerformedCb?.({
        actionId: 'tap',
        notification: { id: '1', data: {} },
      });
    });

    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // received → toast
  // -------------------------------------------------------------------------

  it('fires toast with title and description when pushNotificationReceived fires', async () => {
    renderHook(() => usePushDeepLink());
    await act(async () => { await Promise.resolve(); });

    expect(mockAddListener).toHaveBeenCalledWith(
      'pushNotificationReceived',
      expect.any(Function),
    );

    act(() => {
      receivedCb?.({
        id: '2',
        title: 'New lead: Jane Smith',
        body: 'Needs electrical panel repair',
        data: { deepLink: '/leads/xyz-456' },
      });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New lead: Jane Smith',
        description: 'Needs electrical panel repair',
      }),
    );
  });

  it('fires toast even when notification has no title or body', async () => {
    renderHook(() => usePushDeepLink());
    await act(async () => { await Promise.resolve(); });

    act(() => {
      receivedCb?.({
        id: '3',
        data: { deepLink: '/leads/xyz-789' },
      });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New lead',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cleanup — both listeners removed on unmount
  // -------------------------------------------------------------------------

  it('removes both listeners on unmount', async () => {
    const { unmount } = renderHook(() => usePushDeepLink());
    await act(async () => { await Promise.resolve(); });

    unmount();
    // Allow the void remove() promise chains to settle.
    await act(async () => { await Promise.resolve(); });

    expect(actionPerformedRemove).toHaveBeenCalled();
    expect(receivedRemove).toHaveBeenCalled();
  });
});

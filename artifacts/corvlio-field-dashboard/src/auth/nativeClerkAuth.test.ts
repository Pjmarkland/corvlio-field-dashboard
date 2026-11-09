import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { plugin, registerPlugin } = vi.hoisted(() => ({
  plugin: {
    initialize: vi.fn(),
    getAuthState: vi.fn(),
    getDebugTrace: vi.fn(),
    startHostedAuth: vi.fn(),
    getToken: vi.fn(),
    signOut: vi.fn(),
  },
  registerPlugin: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin }));

import {
  nativeClerkAuth,
  NATIVE_CLERK_INITIALIZE_TIMEOUT_MESSAGE,
  NATIVE_CLERK_INITIALIZE_TIMEOUT_MS,
} from './nativeClerkAuth';

describe('native Clerk bridge initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPlugin.mockReturnValue(plugin);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the native plugin and forwards its initialization result', async () => {
    const result = { configured: true };
    plugin.initialize.mockResolvedValue(result);

    await expect(nativeClerkAuth.initialize({
      publishableKey: 'pk_test_native-test',
      redirectUrl: 'com.corvlio.fielddashboard://callback',
      callbackUrlScheme: 'com.corvlio.fielddashboard',
    })).resolves.toEqual(result);

    expect(registerPlugin).toHaveBeenCalledWith('ClerkNativeAuth');
    expect(plugin.initialize).toHaveBeenCalledWith(expect.objectContaining({
      publishableKey: 'pk_test_native-test',
    }));
  });

  it('rejects with a useful timeout when native initialization never responds', async () => {
    vi.useFakeTimers();
    plugin.initialize.mockReturnValue(new Promise(() => {}));

    const initialization = nativeClerkAuth.initialize({
      publishableKey: 'pk_test_native-test',
      redirectUrl: 'com.corvlio.fielddashboard://callback',
      callbackUrlScheme: 'com.corvlio.fielddashboard',
    });
    const rejection = expect(initialization).rejects.toThrow(NATIVE_CLERK_INITIALIZE_TIMEOUT_MESSAGE);

    await vi.advanceTimersByTimeAsync(NATIVE_CLERK_INITIALIZE_TIMEOUT_MS);
    await rejection;
  });

  it('preserves a native plugin rejection for the retry screen', async () => {
    const error = new Error('Native plugin initialization failed.');
    plugin.initialize.mockRejectedValue(error);

    await expect(nativeClerkAuth.initialize({
      publishableKey: 'pk_test_native-test',
      redirectUrl: 'com.corvlio.fielddashboard://callback',
      callbackUrlScheme: 'com.corvlio.fielddashboard',
    })).rejects.toBe(error);
  });

  it('applies a short independent timeout to native auth-state loading', async () => {
    vi.useFakeTimers();
    plugin.getAuthState.mockReturnValue(new Promise(() => {}));

    const stateLoad = nativeClerkAuth.getAuthState();
    const rejection = expect(stateLoad).rejects.toThrow('Native sign-in state did not load after 2 seconds.');
    await vi.advanceTimersByTimeAsync(2_000);
    await rejection;
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartupFailureScreen } from './StartupFailureScreen';
import { getLastStartupError, normalizeStartupError, subscribeStartupErrors } from '@/lib/startupErrors';

describe('startup failure screen', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="corvlio-app-version" content="1.0">
      <meta name="corvlio-build-number" content="17">
    `;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('shows a readable error, version/build, and a working retry button', () => {
    const onRetry = vi.fn();
    render(
      <StartupFailureScreen
        title="Sign-in could not load"
        message="Check your connection and retry."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Sign-in could not load');
    expect(screen.getByText('Version 1.0 · Build 17')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the real name, message, and first stack lines even in production', () => {
    vi.stubEnv('DEV', false);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new TypeError('Native startup failed');
    error.stack = 'TypeError: Native startup failed\n' + Array.from({ length: 10 }, (_, i) => `    at frame${i}`).join('\n');
    render(<StartupFailureScreen error={error} />);
    expect(screen.getByRole('alert').textContent).toContain('TypeError: Native startup failed');
    expect(screen.getByRole('alert').textContent).toContain('at frame4');
    expect(screen.getByRole('alert').textContent).not.toContain('at frame5');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('TypeError: Native startup failed'), error.stack, error);
  });

  it('normalizes rejected strings and plain error-like objects without losing their stack', () => {
    expect(normalizeStartupError('Bridge unavailable').message).toBe('Bridge unavailable');
    const error = normalizeStartupError({ name: 'BridgeError', message: 'Unavailable', stack: 'native-frame' });
    expect(error.name).toBe('BridgeError');
    expect(error.stack).toBe('native-frame');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(normalizeStartupError(cyclic)).toBeInstanceOf(Error);
  });

  it('replaces a loaded app with diagnostics for a global error and updates the last async rejection', () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Harness() {
      const error = useSyncExternalStore(subscribeStartupErrors, getLastStartupError, getLastStartupError);
      return error ? <StartupFailureScreen /> : <p>Public home loaded</p>;
    }
    render(<Harness />);
    expect(screen.getByText('Public home loaded')).toBeTruthy();
    const error = new ReferenceError('Effect exploded');
    error.stack = 'ReferenceError: Effect exploded\n    at nativeEffect';
    const event = new ErrorEvent('error', { error, message: error.message, cancelable: true });
    event.preventDefault();
    act(() => { window.dispatchEvent(event); });
    expect(screen.queryByText('Public home loaded')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('ReferenceError: Effect exploded');
    expect(screen.getByRole('alert').textContent).toContain('at nativeEffect');

    const rejection = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(rejection, 'reason', { value: { name: 'AsyncError', message: 'Promise exploded', stack: 'at nativeAsync' } });
    rejection.preventDefault();
    act(() => { window.dispatchEvent(rejection); });
    expect(screen.getByRole('alert').textContent).toContain('AsyncError: Promise exploded');
    expect(screen.getByRole('alert').textContent).toContain('at nativeAsync');
    expect(screen.getByRole('alert').textContent).toContain('Last global error: unhandledrejection');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebPushSettingsRow } from './WebPushSettingsRow';
import type { useWebPushNotifications } from '@/hooks/useWebPushNotifications';

type WebPushState = ReturnType<typeof useWebPushNotifications>;

function pushState(overrides: Partial<WebPushState> = {}): WebPushState {
  return {
    status: 'off',
    enabled: false,
    error: null,
    available: true,
    configLoading: false,
    configError: false,
    register: vi.fn(),
    revoke: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

describe('WebPushSettingsRow', () => {
  it('explains that the browser asks permission after opt-in', () => {
    render(<WebPushSettingsRow push={pushState()} />);
    expect(screen.getByText(/browser will ask permission/i)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /browser notifications on this browser/i }).getAttribute('aria-checked')).toBe('false');
  });

  it('enables and disables only the current browser subscription', () => {
    const push = pushState({ status: 'off', enabled: false });
    const { rerender } = render(<WebPushSettingsRow push={push} />);
    fireEvent.click(screen.getByTestId('switch-web-push'));
    expect(push.register).toHaveBeenCalledOnce();

    const enabled = pushState({ status: 'registered', enabled: true });
    rerender(<WebPushSettingsRow push={enabled} />);
    fireEvent.click(screen.getByTestId('switch-web-push'));
    expect(enabled.revoke).toHaveBeenCalledOnce();
  });
});

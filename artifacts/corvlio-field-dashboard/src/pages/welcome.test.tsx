import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { claimWelcome, setLocation } = vi.hoisted(() => ({ claimWelcome: vi.fn(), setLocation: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ claimWelcome }));
vi.mock('wouter', () => ({ useLocation: () => ['/welcome', setLocation] }));
vi.mock('@/assets/logo.svg', () => ({ default: '/logo.svg' }));

import WelcomePage from './welcome';

beforeEach(() => { claimWelcome.mockReset(); setLocation.mockReset(); });

describe('WelcomePage', () => {
  it('claims once, shows the steps, and Get started replaces to onboarding', async () => {
    claimWelcome.mockResolvedValue({ showWelcome: true, nextPath: '/onboarding' });
    render(<WelcomePage />);
    expect(await screen.findByText('Welcome to Corvlio')).toBeTruthy();
    expect(screen.getByText('Tell us about your business')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-welcome-get-started'));
    expect(setLocation).toHaveBeenCalledWith('/onboarding', { replace: true });
    expect(claimWelcome).toHaveBeenCalledTimes(1);
  });

  it('dismisses via replace when the welcome was already shown', async () => {
    claimWelcome.mockResolvedValue({ showWelcome: false, nextPath: '/dashboard' });
    render(<WelcomePage />);
    await waitFor(() => expect(setLocation).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(screen.queryByText('Welcome to Corvlio')).toBeNull();
  });

  it('shows a recoverable error and retries', async () => {
    claimWelcome.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ showWelcome: true, nextPath: '/onboarding' });
    render(<WelcomePage />);
    fireEvent.click(await screen.findByTestId('button-welcome-retry'));
    expect(await screen.findByText('Welcome to Corvlio')).toBeTruthy();
    expect(claimWelcome).toHaveBeenCalledTimes(2);
  });

  it('ignores a result that resolves after unmount', async () => {
    let resolve!: (v: unknown) => void;
    claimWelcome.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = render(<WelcomePage />);
    unmount();
    await act(async () => { resolve({ showWelcome: false, nextPath: '/dashboard' }); });
    expect(setLocation).not.toHaveBeenCalled();
  });

  it('a refresh (new mount) claims again and routes away', async () => {
    claimWelcome.mockResolvedValueOnce({ showWelcome: true, nextPath: '/onboarding' }).mockResolvedValueOnce({ showWelcome: false, nextPath: '/onboarding' });
    const first = render(<WelcomePage />);
    await screen.findByText('Welcome to Corvlio');
    first.unmount();
    render(<WelcomePage />);
    await waitFor(() => expect(setLocation).toHaveBeenCalledWith('/onboarding', { replace: true }));
  });
});

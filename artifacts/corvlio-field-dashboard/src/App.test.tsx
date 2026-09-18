import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRevoke,
  mockSignOut,
  mockToast,
} = vi.hoisted(() => ({
  mockRevoke: vi.fn(),
  mockSignOut: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ signOut: mockSignOut }),
  useUser: () => ({ user: { id: 'user_unconfigured' } }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  Show: ({ children }: { children: React.ReactNode }) => children,
  SignIn: () => null,
  SignUp: () => null,
}));

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ revoke: mockRevoke }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetLeads: vi.fn(),
  useGetNotificationStatus: vi.fn(),
  useUpdateLeadStatus: vi.fn(),
  getGetLeadsQueryKey: vi.fn(),
}));

vi.mock('@/assets/logo.svg', () => ({ default: '/logo.svg' }));
vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/hooks/usePushDeepLink', () => ({ usePushDeepLink: vi.fn() }));
vi.mock('@/pages/onboarding', () => ({ default: () => null }));
vi.mock('@/pages/terms', () => ({ default: () => null }));
vi.mock('@/pages/client-agreement', () => ({ default: () => null }));

import { UnconfiguredAccountScreen } from './App';

describe('UnconfiguredAccountScreen sign-out escape hatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevoke.mockResolvedValue(undefined);
    mockSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('revokes alerts, signs out, and navigates to the public root', async () => {
    const assign = vi.fn();
    render(<UnconfiguredAccountScreen navigate={assign} />);

    expect(screen.getByTestId('link-configure-business')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-sign-out-unconfigured'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledOnce());
    expect(mockRevoke).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/');
    expect(screen.getByRole('heading', { name: 'No business configured' })).toBeTruthy();
  });

  it('keeps the screen and shows an error toast when alert revocation fails', async () => {
    mockRevoke.mockRejectedValue(new Error('Push service unavailable'));
    render(<UnconfiguredAccountScreen />);

    fireEvent.click(screen.getByTestId('button-sign-out-unconfigured'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
      title: 'Could not disable push alerts',
    })));
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'No business configured' })).toBeTruthy();
  });

  it('keeps the screen and shows an error toast when Clerk sign-out fails', async () => {
    mockSignOut.mockRejectedValue(new Error('Clerk unavailable'));
    render(<UnconfiguredAccountScreen />);

    fireEvent.click(screen.getByTestId('button-sign-out-unconfigured'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
      title: 'Could not sign out',
      description: 'Clerk unavailable',
    })));
    expect(screen.getByRole('heading', { name: 'No business configured' })).toBeTruthy();
  });
});
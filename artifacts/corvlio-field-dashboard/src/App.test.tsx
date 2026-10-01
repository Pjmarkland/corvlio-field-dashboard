import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRevoke,
  mockSignOut,
  mockToast,
  mockGetBusinessProfile,
  mockUpdateBusinessProfile,
} = vi.hoisted(() => ({
  mockRevoke: vi.fn(),
  mockSignOut: vi.fn(),
  mockToast: vi.fn(),
  mockGetBusinessProfile: vi.fn(),
  mockUpdateBusinessProfile: vi.fn(),
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
  getGetLeadsQueryKey: () => ['/api/leads'],
  useGetBusinessProfile: () => mockGetBusinessProfile(),
  useUpdateBusinessProfile: () => ({ isPending: false, mutate: mockUpdateBusinessProfile }),
  getGetBusinessProfileQueryKey: () => ['/api/businesses/me'],
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
import { BusinessProfileEditor } from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';

const sampleProfile = {
  businessName: 'Harbor Electric',
  agentName: null,
  businessType: 'Electrical',
  businessWebsiteUrl: null,
  ownerEmail: 'owner@harbor.example',
  serviceArea: 'North Bay',
  personalityToneDescription: null,
  servicesNotOffered: null,
  majorIssueExamples: null,
  pricingPolicy: null,
  financingPolicy: null,
  brandsWorkedWith: null,
  responseTimeCommitment: null,
  warrantyInfo: null,
  maintenancePlanOfferings: null,
  credentials: null,
  ownerAvailability: 'Weekdays, 8–5',
  emergencyContactInfo: null,
  retellPhoneNumber: '+14155550123',
};

function renderProfileEditor() {
  localStorage.removeItem('corvlio-theme');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}><ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="corvlio-theme">{children}</ThemeProvider></QueryClientProvider>;
  }
  return render(<BusinessProfileEditor businessName={sampleProfile.businessName} retellPhoneNumber={sampleProfile.retellPhoneNumber} />, { wrapper: Wrapper });
}

describe('Business profile settings', () => {
  beforeEach(() => {
    mockGetBusinessProfile.mockReturnValue({ data: sampleProfile, isLoading: false, isError: false, refetch: vi.fn() });
    mockUpdateBusinessProfile.mockReset();
  });

  it('validates http/https website URLs and saves profile values with feedback', async () => {
    mockUpdateBusinessProfile.mockImplementation((variables, options) => {
      options.onSuccess({ ...sampleProfile, ...variables.data });
    });
    renderProfileEditor();

    const website = await screen.findByTestId('input-profile-businessWebsiteUrl') as HTMLInputElement;
    expect(website.type).toBe('url');
    fireEvent.change(website, { target: { value: 'ftp://harbor.example' } });
    expect(website.checkValidity()).toBe(false);
    expect(mockUpdateBusinessProfile).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('input-profile-businessName'), { target: { value: 'Harbor Electric Co.' } });
    fireEvent.change(website, { target: { value: 'https://harbor.example' } });
    fireEvent.submit(screen.getByTestId('form-business-profile'));

    await waitFor(() => expect(screen.getByTestId('status-profile-save').textContent).toBe('Business details saved.'));
    expect(mockUpdateBusinessProfile).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        businessName: 'Harbor Electric Co.',
        businessWebsiteUrl: 'https://harbor.example',
        ownerAvailability: 'Weekdays, 8–5',
      }) }),
      expect.any(Object),
    );
  });

  it('offers Light, Dark, and System themes and persists a changed preference', async () => {
    renderProfileEditor();

    const theme = await screen.findByTestId('select-theme') as HTMLSelectElement;
    expect(theme.value).toBe('system');
    expect([...theme.options].map((option) => option.value)).toEqual(['system', 'light', 'dark']);

    fireEvent.change(theme, { target: { value: 'dark' } });
    await waitFor(() => expect(localStorage.getItem('corvlio-theme')).toBe('dark'));
  });
});

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
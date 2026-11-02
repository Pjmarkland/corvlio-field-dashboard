import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferLeadCallback } from '@/lib/leadDisplay';

const {
  mockRevoke,
  mockSignOut,
  mockToast,
  mockGetBusinessProfile,
  mockUpdateBusinessProfile,
  mockNativeState,
  mockGetOwnerInvoices,
} = vi.hoisted(() => ({
  mockRevoke: vi.fn(),
  mockSignOut: vi.fn(),
  mockToast: vi.fn(),
  mockGetBusinessProfile: vi.fn(),
  mockUpdateBusinessProfile: vi.fn(),
  mockNativeState: { value: false },
  mockGetOwnerInvoices: vi.fn(),
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
vi.mock('@/components/AccountDeletionPanel', () => ({
  default: () => null,
  DeletedAccountSignOut: () => null,
  deletionSignOutMarker: 'mock-deletion-signout-marker',
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockNativeState.value,
    getPlatform: () => mockNativeState.value ? 'ios' : 'web',
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetLeads: vi.fn(),
  useGetNotificationStatus: vi.fn(),
  useUpdateLeadStatus: vi.fn(),
  getGetLeadsQueryKey: () => ['/api/leads'],
  getGetNativeBusinessSetupStatusQueryKey: () => ['/api/businesses/native-onboard/status'],
  useGetNativeBusinessSetupStatus: vi.fn(),
  submitNativeBusinessSetup: vi.fn(),
  getGetOwnerInvoicesQueryKey: () => ['/api/owner/invoices'],
  useGetOwnerInvoices: (...args: unknown[]) => mockGetOwnerInvoices(...args),
  useGetBusinessProfile: () => mockGetBusinessProfile(),
  useUpdateBusinessProfile: () => ({ isPending: false, mutate: mockUpdateBusinessProfile }),
  getGetBusinessProfileQueryKey: () => ['/api/businesses/me'],
}));
vi.mock('@/hooks/useAdminAccess', () => ({ useAdminAccess: () => false }));
vi.mock('@/components/LeadAlertBell', () => ({ LeadAlertBell: () => null }));

vi.mock('@/assets/logo-dark.png', () => ({ default: '/logo-dark.png' }));
vi.mock('@/assets/logo-light.png', () => ({ default: '/logo-light.png' }));
vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/hooks/usePushDeepLink', () => ({ usePushDeepLink: vi.fn() }));
vi.mock('@/pages/onboarding', () => ({ default: () => null, NativeOnboardingForm: () => null }));
vi.mock('@/pages/terms', () => ({ default: () => null }));
vi.mock('@/pages/client-agreement', () => ({ default: () => null }));

import { UnconfiguredAccountScreen, DetailPage, LeadCard, BusinessWelcomeCard, AppShell } from './App';
import { Router as TestRouter, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
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

  it('saves a selected no-nonsense tone using the existing profile API', async () => {
    renderProfileEditor();
    fireEvent.change(screen.getByTestId('select-profile-tone'), { target: { value: 'No-nonsense' } });
    fireEvent.submit(screen.getByTestId('form-business-profile'));
    await waitFor(() => expect(mockUpdateBusinessProfile.mock.calls[0][0].data.personalityToneDescription).toBe('No-nonsense'));
  });

  it('shows the friendly server name rejection without reporting a successful save', async () => {
    const message = 'Please use your real business name without offensive language.';
    mockUpdateBusinessProfile.mockImplementation((_variables, options) => {
      options.onError({ status: 400, data: { error: message } });
    });
    renderProfileEditor();
    fireEvent.change(screen.getByTestId('input-profile-businessName'), { target: { value: 'Rejected test name' } });
    fireEvent.submit(screen.getByTestId('form-business-profile'));
    await waitFor(() => expect(screen.getByTestId('status-profile-save').textContent).toBe(message));
    expect(screen.queryByText('Business details saved.')).toBeNull();
  });

  it.each([
    new Error('network details must not be displayed'),
    { status: 400, data: { error: 7 } },
    { status: 500, data: { error: 'internal details must not be displayed' } },
  ])('keeps a generic message for network failures or malformed validation responses', async (error) => {
    mockUpdateBusinessProfile.mockImplementation((_variables, options) => {
      options.onError(error);
    });
    renderProfileEditor();
    fireEvent.submit(screen.getByTestId('form-business-profile'));
    await waitFor(() => expect(screen.getByTestId('status-profile-save').textContent).toBe('Could not save your details. Check your connection and try again.'));
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

describe('trade notes and the manual post-onboarding call link', () => {
  it('shows readable saved answers on a lead card', () => {
    render(<LeadCard saving={false} onStatus={vi.fn()} lead={{
      id: 'trade', name: 'Sam', phone: '+15551230001', issue: 'No cooling', address: '14 Oak St',
      urgency: 'normal', status: 'pending', createdAt: new Date().toISOString(), contactedAt: null,
      tradeIntakeAnswers: 'System: Heat pump, 10 years old\nProblem: No cooling',
    }} />);
    expect(screen.getByTestId('trade-intake-trade').textContent).toContain('Heat pump, 10 years old');
  });
  it('only exposes a tel link for an assigned non-sample number, never auto-calls', () => {
    const confirmation = { userId: 'owner', businessName: 'Plumbing', isSample: false, phoneNumber: '+15551230002', submittedAt: new Date().toISOString() };
    const { rerender } = render(<BusinessWelcomeCard businessName="Plumbing" confirmation={confirmation} />);
    expect(screen.getByTestId('button-call-new-number').getAttribute('href')).toBe('tel:+15551230002');
    expect(screen.getByText(/This is your AI receptionist/)).toBeTruthy();
    expect(screen.getByTestId('call-forwarding-help').textContent).toContain('+15551230002');
    rerender(<BusinessWelcomeCard businessName="Plumbing" confirmation={{ ...confirmation, isSample: true }} />);
    expect(screen.queryByTestId('button-call-new-number')).toBeNull();
    expect(screen.queryByTestId('call-forwarding-help')).toBeNull();
    rerender(<BusinessWelcomeCard businessName="Plumbing" confirmation={{ ...confirmation, phoneNumber: null }} />);
    expect(screen.queryByTestId('button-call-new-number')).toBeNull();
    expect(screen.queryByTestId('call-forwarding-help')).toBeNull();
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

  it('continues signing out when alert revocation fails', async () => {
    mockRevoke.mockRejectedValue(new Error('Push service unavailable'));
    render(<UnconfiguredAccountScreen />);

    fireEvent.click(screen.getByTestId('button-sign-out-unconfigured'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledOnce());
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
describe('LeadCard navigation', () => {
  const lead = { id: 'L1', name: 'Ann Lee', phone: '(415) 555-0123', issue: 'Leak', address: '1 Pier', urgency: 'normal' as const, status: 'pending' as const, createdAt: new Date().toISOString(), contactedAt: null };
  const renderCard = (onStatus = vi.fn()) => {
    const { hook, history } = memoryLocation({ path: '/dashboard', record: true });
    render(<TestRouter hook={hook}><LeadCard lead={lead} onStatus={onStatus} saving={false} /></TestRouter>);
    return { history, onStatus };
  };
  it('opens detail when the card background is clicked', () => {
    const { history } = renderCard();
    fireEvent.click(screen.getByTestId('card-lead-L1'));
    expect(history?.at(-1)).toBe('/leads/L1');
  });
  it('name link is a focusable anchor to detail', () => {
    renderCard();
    const link = screen.getByTestId('link-lead-L1');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/leads/L1');
  });
  it('does not navigate from call, text or status buttons', () => {
    const { history, onStatus } = renderCard();
    fireEvent.click(screen.getByTestId('button-call-L1'));
    fireEvent.click(screen.getByTestId('button-text-L1'));
    fireEvent.click(screen.getByTestId('button-toggle-status-L1'));
    expect(history?.at(-1)).toBe('/dashboard');
    expect(onStatus).toHaveBeenCalledWith('L1', 'contacted');
  });
});

describe('native AppShell billing boundaries', () => {
  afterEach(() => { mockNativeState.value = false; });

  const renderShell = () => {
    const { hook } = memoryLocation({ path: '/dashboard', record: true });
    return render(
      <TestRouter hook={hook}>
        <AppShell leads={[]} businessName="App Review Demo">
          <div>Demo dashboard</div>
        </AppShell>
      </TestRouter>,
    );
  };

  it('does not request owner invoices or show the web-only welcome card in native', () => {
    mockNativeState.value = true;
    mockGetBusinessProfile.mockReturnValue({ data: { isInternal: false }, isLoading: false, isSuccess: true });
    mockGetOwnerInvoices.mockReturnValue({
      data: {
        plan: null,
        status: 'legacy',
        serviceActive: false,
        provisioningState: 'pending',
        invoices: [{ number: 'CRV-REVIEW-ONLY', totalCents: 99999 }],
      },
    });
    renderShell();

    expect(mockGetOwnerInvoices.mock.calls.at(-1)?.[0].query.enabled).toBe(false);
    expect(screen.queryByText(/billing|awaiting payment|CRV-REVIEW-ONLY/i)).toBeNull();
    expect(screen.getByText('Demo dashboard')).toBeTruthy();
  });

  it('keeps the owner-invoice query enabled on web', () => {
    mockNativeState.value = false;
    mockGetBusinessProfile.mockReturnValue({ data: { isInternal: false }, isLoading: false, isSuccess: true });
    mockGetOwnerInvoices.mockReturnValue({ data: undefined });
    renderShell();
    expect(mockGetOwnerInvoices.mock.calls.at(-1)?.[0].query.enabled).toBe(true);
  });
});

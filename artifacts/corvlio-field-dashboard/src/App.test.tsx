import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferLeadCallback } from '@/lib/leadDisplay';

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

import { UnconfiguredAccountScreen, DetailPage, LeadCard, BusinessWelcomeCard } from './App';
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
    rerender(<BusinessWelcomeCard businessName="Plumbing" confirmation={{ ...confirmation, isSample: true }} />);
    expect(screen.queryByTestId('button-call-new-number')).toBeNull();
    rerender(<BusinessWelcomeCard businessName="Plumbing" confirmation={{ ...confirmation, phoneNumber: null }} />);
    expect(screen.queryByTestId('button-call-new-number')).toBeNull();
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
describe('LeadDetail status actions', () => {
  const lead = { id: 'L1', name: '', phone: '(415) 555-0123', issue: '', address: '1 Pier', urgency: 'normal' as const, status: 'pending' as const, createdAt: new Date().toISOString(), contactedAt: null };
  it('uses the normalized spoken callback and shows caller ID, availability, summary and the expandable transcript', () => {
    const { hook } = memoryLocation({ path: '/leads/L1' });
    const onStatus = vi.fn();
    const detailed = preferLeadCallback({ ...lead, phone: '+1-555-0101', callbackNumber: '+1-555-0188',
      callerId: '+1-555-0101', availability: 'Afternoons', summary: 'Caller needs a pipe repaired.',
      transcript: 'user: Please call me at the other number.' });
    render(<TestRouter hook={hook}><Route path="/leads/:id"><DetailPage leads={[detailed]} onStatus={onStatus} savingLeadId={null} /></Route></TestRouter>);
    expect(screen.getByTestId('button-detail-call-L1').getAttribute('href')).toBe('tel:+15550188');
    expect(screen.getByTestId('link-info-phone').getAttribute('href')).toBe('tel:+15550188');
    expect(screen.getByText('Caller ID')).toBeTruthy();
    expect(screen.getByText('+1-555-0101')).toBeTruthy();
    expect(screen.getByText('Afternoons')).toBeTruthy();
    expect(screen.getByTestId('lead-summary').textContent).toBe(detailed.summary);
    expect(screen.queryByTestId('lead-transcript')).toBeNull();
    fireEvent.click(screen.getByTestId('button-toggle-transcript'));
    expect(screen.getByTestId('lead-transcript').textContent).toBe(detailed.transcript);
    expect(onStatus).not.toHaveBeenCalled();
  });
  it('never marks contacted from tel/sms, only from the explicit button', () => {
    const onStatus = vi.fn();
    const { hook } = memoryLocation({ path: '/leads/L1' });
    render(<TestRouter hook={hook}><Route path="/leads/:id"><DetailPage leads={[lead]} onStatus={onStatus} savingLeadId={null} /></Route></TestRouter>);
    fireEvent.click(screen.getByTestId('button-detail-call-L1'));
    fireEvent.click(screen.getByTestId('button-detail-text-L1'));
    expect(onStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('button-mark-contacted-L1'));
    expect(onStatus).toHaveBeenCalledWith('L1', 'contacted');
  });
});

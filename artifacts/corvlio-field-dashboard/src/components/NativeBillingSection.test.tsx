import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: true, summary: {} as any, loading: false, failed: false,
  profile: { isLoading: false, isSuccess: true, data: { isInternal: false, billingMode: 'manual' } } as any,
  query: vi.fn(), refetch: vi.fn(), portal: vi.fn(), openBrowser: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isSignedIn: true }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetNativeBillingSummaryQueryKey: () => ['native-summary'],
  getGetBusinessProfileQueryKey: () => ['prof'],
  useGetBusinessProfile: () => m.profile,
  useCreateBillingPortal: () => ({ mutate: m.portal, isPending: false }),
  useGetNativeBillingSummary: (options: any) => { m.query(options); return {
    data: m.summary, isLoading: m.loading, isError: m.failed, refetch: m.refetch,
  }; },
}));
vi.mock('@/lib/nativeBillingBrowser', () => ({ openStripeBillingPortal: m.openBrowser }));
import NativeBillingSection from './NativeBillingSection';
beforeEach(() => {
  vi.clearAllMocks(); m.profile = { isLoading: false, isSuccess: true, data: { isInternal: false, billingMode: 'manual' } }; m.native = true; m.loading = false; m.failed = false;
  m.summary = { planName: 'Professional', status: 'active', nextInvoiceDate: '2026-11-01T00:00:00Z',
    billingEnabled: true, hasStripeCustomer: true };
});
describe('native Settings billing', () => {
  it.each(['ios', 'android'])('shows a read-only summary in %s without plan or payment forms', () => {
    const { container } = render(<NativeBillingSection />);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('November 1, 2026')).toBeTruthy();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Professional|Startup|Starter|Managed|\$|checkout|upgrade|subscribe now|payment link/i);
    expect(container.querySelector('input, select, form, iframe, a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeTruthy();
  });
  it.each([['active', 'Active'], ['past_due', 'Past due'], ['canceled', 'Canceled'],
    ['not_subscribed', 'No active subscription']])('renders %s in calm copy', (status, text) => {
    m.summary.status = status; m.summary.nextInvoiceDate = null;
    render(<NativeBillingSection />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('Next charge date')).toBeNull();
  });
  it('keeps the portal action disabled when Stripe billing is unavailable', () => {
    m.summary.billingEnabled = false;
    const { container } = render(<NativeBillingSection />);
    expect(screen.getByRole('button', { name: /manage billing/i })).toHaveProperty('disabled', true);
    expect(container.querySelector('a[href]')).toBeNull();
  });
  it('opens Stripe billing in the external browser only after the owner taps Manage billing', () => {
    m.portal.mockImplementation((_variables, callbacks) => callbacks.onSuccess({ url: 'https://billing.stripe.com/session/test' }));
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    expect(m.portal).toHaveBeenCalledTimes(1);
    expect(m.openBrowser).toHaveBeenCalledWith('https://billing.stripe.com/session/test');
  });
  it('does not initiate billing or browser actions', () => {
    render(<NativeBillingSection />);
    expect(m.query).toHaveBeenCalled();
  });
  it('keeps web/PWA unchanged, without rendering or fetching a native summary', () => {
    m.native = false;
    const { container } = render(<NativeBillingSection />);
    expect(container.innerHTML).toBe('');
    expect(m.query).not.toHaveBeenCalled();
  });
  it('shows loading and errors without inventing account status', () => {
    m.failed = true; m.summary = undefined;
    render(<NativeBillingSection />);
    expect(screen.getByText('Billing details are temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('No active subscription')).toBeNull();
  });
});
describe('native Settings billing internal guard', () => {
  it('renders nothing and disables query for internal business', () => {
    m.profile = { isLoading: false, isSuccess: true, data: { isInternal: true, billingMode: 'manual' } };
    const { container } = render(<NativeBillingSection />);
    expect(container.innerHTML).toBe('');
    expect(m.query.mock.calls.at(-1)![0].query.enabled).toBe(false);
  });
  it('waits for profile before querying', () => {
    m.profile = { isLoading: true, isSuccess: false, data: undefined };
    render(<NativeBillingSection />);
    expect(m.query.mock.calls.at(-1)![0].query.enabled).toBe(false);
  });
});

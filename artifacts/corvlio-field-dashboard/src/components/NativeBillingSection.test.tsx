import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: true, summary: {} as any, loading: false, failed: false,
  profile: { isLoading: false, isSuccess: true, data: { isInternal: false } } as any,
  query: vi.fn(), portal: vi.fn(), external: vi.fn(), refetch: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: m.external } }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isSignedIn: true }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetNativeBillingSummaryQueryKey: () => ['native-summary'],
  getGetBusinessProfileQueryKey: () => ['prof'],
  useGetBusinessProfile: () => m.profile,
  useGetNativeBillingSummary: (options: any) => { m.query(options); return {
    data: m.summary, isLoading: m.loading, isError: m.failed, refetch: m.refetch,
  }; },
  useCreateBillingPortal: () => ({ mutateAsync: m.portal }),
}));
import NativeBillingSection from './NativeBillingSection';
import { websiteBillingUrl } from '@/lib/nativeBillingBrowser';
beforeEach(() => {
  vi.clearAllMocks(); m.profile = { isLoading: false, isSuccess: true, data: { isInternal: false } }; m.native = true; m.loading = false; m.failed = false;
  m.summary = { planName: 'Professional', status: 'active', nextInvoiceDate: '2026-11-01T00:00:00Z',
    billingEnabled: true, hasStripeCustomer: true };
  m.portal.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/fake_session' });
  m.external.mockResolvedValue({ completed: true });
});
describe('native Settings billing', () => {
  it.each(['ios', 'android'])('shows only a read-only summary in %s, with no prices or payment UI', () => {
    const { container } = render(<NativeBillingSection />);
    expect(screen.getByText('Professional')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('November 1, 2026')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$|€|£|checkout|upgrade|subscribe now|per month|compare plans/i);
    expect(container.querySelector('input, select, form, iframe')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Manage billing' })).toHaveLength(1);
    expect(m.portal).not.toHaveBeenCalled();
  });
  it.each([['active', 'Active'], ['past_due', 'Past due'], ['canceled', 'Canceled'],
    ['not_subscribed', 'No active subscription']])('renders %s in calm copy', (status, text) => {
    m.summary.status = status; m.summary.nextInvoiceDate = null;
    render(<NativeBillingSection />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('Next charge date')).toBeNull();
  });
  it('opens only the website billing page in the external OS browser', async () => {
    const windowOpen = vi.spyOn(window, 'open');
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({ url: websiteBillingUrl }));
    expect(m.portal).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled(); windowOpen.mockRestore();
  });
  it.each(['disabled', 'no customer'])('shows a neutral website link for %s and never requests a portal', async mode => {
    if (mode === 'disabled') m.summary.billingEnabled = false;
    else m.summary.hasStripeCustomer = false;
    render(<NativeBillingSection />);
    const link = screen.getByRole('button', { name: 'Manage billing' });
    fireEvent.click(link);
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({ url: websiteBillingUrl }));
    expect(m.portal).not.toHaveBeenCalled();
  });
  it('falls back externally if the server gate closes after summary loading', async () => {
    m.portal.mockRejectedValue({ status: 404 }); m.refetch.mockResolvedValue({});
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({ url: websiteBillingUrl }));
    expect(m.portal).not.toHaveBeenCalled();
  });
  it('reports a failed OS launch without navigating to an in-app payment screen', async () => {
    m.external.mockResolvedValue({ completed: false });
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Please try again'));
  });
  it.each(['javascript:alert(1)', 'https://example.com/payment', 'http://billing.stripe.com/payment'])('ignores portal URL data and opens only the website: %s', async url => {
    m.portal.mockResolvedValue({ url });
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({url:websiteBillingUrl}));
    expect(m.portal).not.toHaveBeenCalled();
  });
  it('keeps web/PWA unchanged, without rendering or fetching a native summary', () => {
    m.native = false;
    const { container } = render(<NativeBillingSection />);
    expect(container.innerHTML).toBe('');
    expect(m.query).not.toHaveBeenCalled(); expect(m.portal).not.toHaveBeenCalled();
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
    m.profile = { isLoading: false, isSuccess: true, data: { isInternal: true } };
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

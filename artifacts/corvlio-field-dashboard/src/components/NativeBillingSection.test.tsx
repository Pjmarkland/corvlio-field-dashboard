import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: true, summary: {} as any, loading: false, failed: false,
  query: vi.fn(), portal: vi.fn(), external: vi.fn(), refetch: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: m.external } }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isSignedIn: true }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetNativeBillingSummaryQueryKey: () => ['native-summary'],
  useGetNativeBillingSummary: (options: any) => { m.query(options); return {
    data: m.summary, isLoading: m.loading, isError: m.failed, refetch: m.refetch,
  }; },
  useCreateBillingPortal: () => ({ mutateAsync: m.portal }),
}));
import NativeBillingSection from './NativeBillingSection';
import { websiteBillingUrl } from '@/lib/nativeBillingBrowser';
beforeEach(() => {
  vi.clearAllMocks(); m.native = true; m.loading = false; m.failed = false;
  m.summary = { planName: 'Professional', status: 'active', nextChargeDate: '2026-11-01T00:00:00Z',
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
    m.summary.status = status; m.summary.nextChargeDate = null;
    render(<NativeBillingSection />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('Next charge date')).toBeNull();
  });
  it('opens the authenticated portal in the external OS browser', async () => {
    const windowOpen = vi.spyOn(window, 'open');
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({ url: 'https://billing.stripe.com/p/session/fake_session' }));
    expect(m.portal).toHaveBeenCalledWith();
    expect(windowOpen).not.toHaveBeenCalled(); windowOpen.mockRestore();
  });
  it.each(['disabled', 'no customer'])('shows a neutral website link for %s and never requests a portal', async mode => {
    if (mode === 'disabled') m.summary.billingEnabled = false;
    else m.summary.hasStripeCustomer = false;
    render(<NativeBillingSection />);
    expect(screen.getByText('Billing is managed on our website.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Manage billing' });
    expect(link.getAttribute('href')).toBe(websiteBillingUrl);
    fireEvent.click(link);
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({ url: websiteBillingUrl }));
    expect(m.portal).not.toHaveBeenCalled();
  });
  it('falls back externally if the server gate closes after summary loading', async () => {
    m.portal.mockRejectedValue({ status: 404 }); m.refetch.mockResolvedValue({});
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(m.external).toHaveBeenCalledWith({ url: websiteBillingUrl }));
    expect(m.refetch).toHaveBeenCalledOnce();
  });
  it('reports a failed OS launch without navigating to an in-app payment screen', async () => {
    m.external.mockResolvedValue({ completed: false });
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Please try again'));
  });
  it.each(['javascript:alert(1)', 'https://example.com/payment', 'http://billing.stripe.com/payment'])('rejects an unsafe portal URL: %s', async url => {
    m.portal.mockResolvedValue({ url });
    render(<NativeBillingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(m.external).not.toHaveBeenCalled();
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

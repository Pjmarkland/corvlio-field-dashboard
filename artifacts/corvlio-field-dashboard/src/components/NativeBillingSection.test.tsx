import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: true, summary: {} as any, loading: false, failed: false,
  profile: { isLoading: false, isSuccess: true, data: { isInternal: false, billingMode: 'manual' } } as any,
  query: vi.fn(), refetch: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isSignedIn: true }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetNativeBillingSummaryQueryKey: () => ['native-summary'],
  getGetBusinessProfileQueryKey: () => ['prof'],
  useGetBusinessProfile: () => m.profile,
  useGetNativeBillingSummary: (options: any) => { m.query(options); return {
    data: m.summary, isLoading: m.loading, isError: m.failed, refetch: m.refetch,
  }; },
}));
import NativeBillingSection from './NativeBillingSection';
beforeEach(() => {
  vi.clearAllMocks(); m.profile = { isLoading: false, isSuccess: true, data: { isInternal: false, billingMode: 'manual' } }; m.native = true; m.loading = false; m.failed = false;
  m.summary = { planName: 'Professional', status: 'active', nextInvoiceDate: '2026-11-01T00:00:00Z',
    billingEnabled: true, hasStripeCustomer: true };
});
describe('native Settings billing', () => {
  it.each(['ios', 'android'])('shows only a read-only status summary in %s', () => {
    const { container } = render(<NativeBillingSection />);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Professional|Startup|Starter|Managed|\$|checkout|upgrade|subscribe|payment|invoice|stripe|manage billing/i);
    expect(container.querySelector('input, select, form, iframe, a, button')).toBeNull();
  });
  it.each([['active', 'Active'], ['past_due', 'Past due'], ['canceled', 'Canceled'],
    ['not_subscribed', 'No active subscription']])('renders %s in calm copy', (status, text) => {
    m.summary.status = status;
    render(<NativeBillingSection />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
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
    expect(screen.getByText('Subscription status is temporarily unavailable.')).toBeTruthy();
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

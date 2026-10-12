import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  avail: { enabled: false, settled: true, disabled: true },
  snapshot: vi.fn(), cancel: vi.fn(), checkout: vi.fn(),
  data: null as unknown,
  native: false,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: () => m.avail }));
vi.mock('wouter', () => ({
  Link: ({ children, href, ...r }: { children: React.ReactNode; href: string }) => <a href={href} {...r}>{children}</a>,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetOwnerBillingQueryKey: () => ['b'],
  useGetOwnerBilling: () => { m.snapshot(); return { data: m.data, isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 0 }; },
  useCreateBillingCheckout: () => ({ mutate: m.checkout, isPending: false }),
  useCreateBillingPortal: () => ({ mutate: vi.fn(), isPending: false }),
  useUpgradeBillingPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeBilling: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelBilling: () => ({ mutate: (_: unknown, o: { onSuccess: (a: unknown) => void }) => { m.cancel(); o.onSuccess({ cancelAt: '2025-08-14T00:00:00.000Z' }); }, isPending: false }),
}));
import BillingPage from './billing';

const account = { plan: 'starter', status: 'active', subscriptionId: 'sub', periodEnd: '2025-07-01T00:00:00Z', startupEligible: false, cancelAt: null, graceEndsAt: null };
beforeEach(() => {
  vi.clearAllMocks();
  m.native = false;
  m.data = { account, usage: { count: 63, limit: 100, start: '2025-06-01T00:00:00Z', end: '2025-07-01T00:00:00Z' }, plans: [{ id: 'starter', label: 'Starter', monthlyCents: 5000, setupCents: 0, callLimit: 100 }], policy: { cancellationNoticeDays: 30 }, timeline: [] };
});
describe('billing page', () => {
  it.each(['ios', 'android'])('blocks native %s direct billing/portal entry even if availability says enabled', () => {
    m.native = true;
    m.avail = { enabled: true, settled: true, disabled: false };
    window.history.replaceState({}, '', '/billing?portal=1');
    render(<BillingPage />);
    expect(screen.getByTestId('redirect').textContent).toBe('/dashboard');
    expect(m.snapshot).not.toHaveBeenCalled();
    expect(m.checkout).not.toHaveBeenCalled();
    expect(screen.queryByText('Billing')).toBeNull();
    expect(screen.queryByTestId('section-billing-current')).toBeNull();
    window.history.replaceState({}, '', '/');
  });
  it('offers fresh Checkout after final cancellation despite a retained subscription ID and date', () => {
    m.avail = { enabled: true, settled: true, disabled: false };
    const snapshot = m.data as { account: Record<string, unknown> };
    snapshot.account = { ...snapshot.account, status: 'canceled', cancelAt: '2025-06-01T00:00:00Z' };
    render(<BillingPage />);
    expect(screen.getByTestId('text-status').textContent).toBe('Status: canceled');
    expect(screen.queryByTestId('button-manage-card')).toBeNull();
    expect(screen.queryByTestId('section-cancel')).toBeNull();
    expect(screen.queryByTestId('text-next-charge')).toBeNull();
    expect(screen.queryByTestId('text-cancel-date')).toBeNull();
    fireEvent.click(screen.getByTestId('button-checkout-starter'));
    expect(m.checkout).toHaveBeenCalledWith({ data: { plan: 'starter' } }, expect.any(Object));
  });
  it('keeps management and resume available before scheduled cancellation becomes effective', () => {
    m.avail = { enabled: true, settled: true, disabled: false };
    const snapshot = m.data as { account: Record<string, unknown> };
    snapshot.account = { ...snapshot.account, cancelAt: '2025-08-14T00:00:00Z' };
    render(<BillingPage />);
    expect(screen.getByTestId('button-manage-card')).toBeTruthy();
    expect(screen.getByTestId('button-resume')).toBeTruthy();
    expect(screen.queryByTestId('button-checkout-starter')).toBeNull();
  });
  it('shows a renewal when notice extends beyond the current paid period', () => {
    m.avail = { enabled: true, settled: true, disabled: false };
    const snapshot = m.data as { account: Record<string, unknown> };
    snapshot.account = { ...snapshot.account, cancelAt: '2025-08-14T00:00:00Z' };
    render(<BillingPage />);
    expect(screen.getByTestId('text-next-charge').textContent).toContain('renewal before cancellation');
  });
  it('flag off redirects, renders no billing UI and requests no snapshot', () => {
    m.avail = { enabled: false, settled: true, disabled: true };
    render(<BillingPage />);
    expect(screen.getByTestId('redirect').textContent).toBe('/dashboard');
    expect(screen.queryByText('Billing')).toBeNull();
    expect(m.snapshot).not.toHaveBeenCalled();
  });
  it('shows usage and requires consent before cancelling, then shows effective date', () => {
    m.avail = { enabled: true, settled: true, disabled: false };
    render(<BillingPage />);
    expect(screen.getByTestId('text-usage').textContent).toBe('63 of 100 calls this month');
    fireEvent.click(screen.getByTestId('button-cancel-start'));
    const confirm = screen.getByTestId('button-cancel-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('checkbox-cancel-consent'));
    fireEvent.click(confirm);
    expect(m.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('text-cancel-confirmation').textContent).toContain('August 14, 2025');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  avail: { enabled: false, settled: true, disabled: true },
  snapshot: vi.fn(), cancel: vi.fn(),
  data: null as unknown,
}));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: () => m.avail }));
vi.mock('wouter', () => ({
  Link: ({ children, href, ...r }: { children: React.ReactNode; href: string }) => <a href={href} {...r}>{children}</a>,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetOwnerBillingQueryKey: () => ['b'],
  useGetOwnerBilling: () => { m.snapshot(); return { data: m.data, isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 0 }; },
  useCreateBillingCheckout: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateBillingPortal: () => ({ mutate: vi.fn(), isPending: false }),
  useUpgradeBillingPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeBilling: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelBilling: () => ({ mutate: (_: unknown, o: { onSuccess: (a: unknown) => void }) => { m.cancel(); o.onSuccess({ cancelAt: '2025-08-14T00:00:00.000Z' }); }, isPending: false }),
}));
import BillingPage from './billing';

const account = { plan: 'starter', status: 'active', subscriptionId: 'sub', periodEnd: '2025-07-01T00:00:00Z', startupEligible: false, cancelAt: null, graceEndsAt: null };
beforeEach(() => {
  vi.clearAllMocks();
  m.data = { account, usage: { count: 63, limit: 100, start: '2025-06-01T00:00:00Z', end: '2025-07-01T00:00:00Z' }, plans: [{ id: 'starter', label: 'Starter', monthlyCents: 5000, setupCents: 0, callLimit: 100 }], policy: { cancellationNoticeDays: 30 }, timeline: [] };
});
describe('billing page', () => {
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

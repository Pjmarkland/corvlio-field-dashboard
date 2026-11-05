import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  alertsQuery: { data: null as any, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  healthQuery: { data: null as any, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  resolveMutate: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetAdminSystemAlertsQueryKey: () => ['admin-system-alerts'],
  getGetAdminHealthCheckQueryKey: () => ['admin-health-check'],
  useGetAdminSystemAlerts: () => h.alertsQuery,
  useGetAdminHealthCheck: () => h.healthQuery,
  useResolveAdminSystemAlert: () => ({ mutate: h.resolveMutate, isPending: false }),
}));

vi.mock('wouter', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('./AdminShared', () => ({
  AdminEmpty: ({ title, description }: { title: string; description: string }) => <div><h2>{title}</h2><p>{description}</p></div>,
  AdminError: () => <div>Admin error</div>,
  AdminLoading: () => <div>Loading</div>,
  AdminShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  AdminMetric: ({ label, value, detail }: { label: string; value: string | number; detail?: string }) => <section><h2>{label}</h2><strong>{value}</strong><p>{detail}</p></section>,
  SectionHeading: ({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) => <header><h2>{title}</h2><p>{detail}</p>{action}</header>,
  formatAdminDate: (value: string | null | undefined) => value ?? 'Not recorded',
}));

import AdminHealthCheckPage from './AdminHealthCheckPage';
import AdminSystemAlertsPage from './AdminSystemAlertsPage';

const openAlert = {
  id: 7,
  endpoint: 'post-call',
  category: 'post_call_processing_error',
  summary: 'Post-call webhook processing failed',
  details: 'Database unavailable',
  businessId: null,
  businessName: null,
  firstSeenAt: '2026-11-03T11:00:00.000Z',
  lastSeenAt: '2026-11-03T12:00:00.000Z',
  occurrenceCount: 3,
  status: 'open',
  resolvedAt: null,
  resolvedBy: null,
};

describe('Retell admin monitoring pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.alertsQuery = { data: { alerts: [openAlert], openCount: 1 }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    h.healthQuery = {
      data: {
        lastPreCallSuccessfulAt: '2026-11-03T11:30:00.000Z',
        lastPostCallSuccessfulAt: null,
        lastSuccessfulLeadEmailAt: '2026-11-03T11:15:00.000Z',
        openAlertCount: 1,
        openAlerts: [openAlert],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  it('lists open incidents and resolves them while refreshing both monitoring queries', () => {
    render(<AdminSystemAlertsPage />);
    expect(screen.getByRole('heading', { name: 'System alerts' })).toBeTruthy();
    expect(screen.getByTestId('metric-open-system-alerts').textContent).toBe('1');
    expect(screen.getByText('Database unavailable')).toBeTruthy();

    fireEvent.click(screen.getByTestId('button-resolve-system-alert-7'));
    expect(h.resolveMutate).toHaveBeenCalledWith({ alertId: 7 }, expect.objectContaining({ onSuccess: expect.any(Function) }));
    act(() => h.resolveMutate.mock.calls[0][1].onSuccess());
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-system-alerts'] });
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-health-check'] });
  });

  it('shows successful webhook times and unresolved incidents on the health check', () => {
    render(<AdminHealthCheckPage />);
    expect(screen.getByRole('heading', { name: 'Health check' })).toBeTruthy();
    expect(screen.getByText('Last success: 2026-11-03T11:30:00.000Z')).toBeTruthy();
    expect(screen.getByText('Last successful lead email')).toBeTruthy();
    expect(screen.getByText('Delivered: 2026-11-03T11:15:00.000Z')).toBeTruthy();
    expect(screen.getByText('No successful webhook recorded yet')).toBeTruthy();
    expect(screen.getByTestId('health-open-alert-7')).toBeTruthy();
    expect(screen.getByTestId('link-health-system-alerts').getAttribute('href')).toBe('/admin/system-alerts');
  });
});

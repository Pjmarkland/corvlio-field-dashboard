import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock('wouter', () => ({ useParams: () => ({ businessId: '44' }) }));
vi.mock('./AdminShared', () => ({
  AdminShell: ({ children, title }: { children: React.ReactNode; title: string }) => <main><h1>{title}</h1>{children}</main>,
  AdminAge: () => null,
  AdminEmpty: ({ title }: { title: string }) => <p>{title}</p>,
  AdminError: () => null,
  AdminLoading: () => null,
  AdminMetric: ({ label, value }: { label: string; value: React.ReactNode }) => <div>{label}: {value}</div>,
  AdminStatus: ({ status }: { status: string }) => <span>{status}</span>,
  BackLink: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionHeading: ({ title }: { title: string }) => <h2>{title}</h2>,
  formatAdminDate: (value: string | null, fallback = 'Not recorded') => value ?? fallback,
  formatAdminDuration: () => '—',
  formatAdminResponse: () => '—',
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminBusinessQueryKey: (id: number) => ['admin-business', id],
  useGetAdminBusiness: () => h.query,
  useUpdateAdminManagedReports: () => ({ mutate: h.mutate, isPending: false, isError: false }),
}));

import AdminBusinessPage from './AdminBusinessPage';

function setBusiness(enabled: boolean, isInternal = false) {
  h.query = {
    data: {
      business: {
        id: 44,
        businessName: 'Northline Heating',
        isInternal,
        managedReportsEnabled: enabled,
        provisioningStatus: 'pending',
        provisioningState: 'pending',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.test',
        retellPhoneNumber: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        ownerLastSignInAt: null,
        agreementsAcceptedAt: null,
        isSample: false,
        unusedNumber7Days: false,
        lastCallAt: null,
        onboardingCompletenessPercent: 50,
        completedOnboardingFieldCount: 5,
        onboardingFieldCount: 10,
        totalLeadCount: 0,
        contactedLeadCount: 0,
        averageResponseTimeMs: null,
        pushEnabledDeviceCount: 0,
        pushPlatforms: [],
      },
      onboarding: { websiteEnrichmentSources: {}, websiteEnrichmentAttemptedAt: null, agreementsAcceptedAt: null },
      leads: [],
      calls: [],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('AdminBusinessPage managed reports setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBusiness(false);
  });

  it('enables reports for the selected business and refreshes its detail', () => {
    render(<AdminBusinessPage />);
    expect(screen.getByTestId('section-managed-reports').textContent).toContain('Disabled');
    fireEvent.click(screen.getByTestId('button-toggle-managed-reports'));

    expect(h.mutate).toHaveBeenCalledWith(
      { businessId: 44, data: { enabled: true } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    h.mutate.mock.calls[0][1].onSuccess();
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['admin-business', 44] });
  });

  it('clearly labels an internal business in its admin detail', () => {
    setBusiness(false, true);
    render(<AdminBusinessPage />);
    expect(screen.getByTestId('badge-internal-detail').textContent).toContain('Internal / non-billed');
  });
});

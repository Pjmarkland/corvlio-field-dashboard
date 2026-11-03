import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
  fallbackMutate: vi.fn(),
  invalidate: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate, setQueryData: h.setQueryData }),
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
  useUpdateAdminBusinessFallbackPhone: () => ({ mutate: h.fallbackMutate, isPending: false }),
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
      fallbackRouting: {
        overridePhoneNumber: null,
        resolvedPhoneNumber: '+18634463029',
        defaultPhoneNumber: '+18634463029',
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

  it('shows the resolved number and saves a business-specific US fallback', () => {
    render(<AdminBusinessPage />);
    expect(screen.getByTestId('text-resolved-fallback-phone').textContent).toBe('+18634463029');
    expect(screen.getByText(/where calls ring if the AI is unavailable/i)).toBeTruthy();
    fireEvent.change(screen.getByTestId('input-business-fallback-phone'), {
      target: { value: '+1 (650) 555-0123' },
    });
    fireEvent.click(screen.getByTestId('button-save-fallback-phone'));

    expect(h.fallbackMutate).toHaveBeenCalledWith(
      { businessId: 44, data: { fallbackPhoneNumber: '+1 (650) 555-0123' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    act(() => h.fallbackMutate.mock.calls[0][1].onSuccess({
      overridePhoneNumber: '+16505550123',
      resolvedPhoneNumber: '+16505550123',
      defaultPhoneNumber: '+18634463029',
    }));
    expect(screen.getByTestId('status-fallback-phone').textContent).toContain('saved');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
  fallbackMutate: vi.fn(),
  checklistMutate: vi.fn(),
  retellPhoneMutation: vi.fn(),
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
  getGetAdminOverviewQueryKey: () => ['admin-overview'],
  useGetAdminBusiness: () => h.query,
  useUpdateAdminManagedReports: () => ({ mutate: h.mutate, isPending: false, isError: false }),
  useUpdateAdminBusinessRetellPhoneNumber: () => ({ mutate: h.retellPhoneMutation, isPending: false, isError: false }),
  useUpdateAdminBusinessFallbackPhone: () => ({ mutate: h.fallbackMutate, isPending: false }),
  useUpdateAdminFirstClientChecklistItem: () => ({ mutate: h.checklistMutate, isPending: false, isError: false }),
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
        agreementsAcceptedVersion: null,
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
      onboarding: { websiteEnrichmentSources: {}, websiteEnrichmentAttemptedAt: null, agreementsAcceptedAt: null, agreementsAcceptedVersion: null },
      leads: [],
      calls: [],
      firstClientChecklist: [],
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

  it('requires an explicit confirmation before changing the Retell mapping', async () => {
    render(<AdminBusinessPage />);
    fireEvent.change(screen.getByTestId('input-admin-retell-phone-number'), {
      target: { value: '+14353245513' },
    });
    fireEvent.click(screen.getByTestId('button-review-retell-phone-number'));

    const confirmation = await screen.findByTestId('panel-confirm-retell-phone-number');
    expect(confirmation.textContent).toContain('+14353245513');
    expect(confirmation.textContent).toContain('Retell’s own phone routing will not be changed.');
    expect(h.retellPhoneMutation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-confirm-retell-phone-number-change'));
    expect(h.retellPhoneMutation).toHaveBeenCalledWith(
      { businessId: 44, data: { retellPhoneNumber: '+14353245513' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const onSuccess = h.retellPhoneMutation.mock.calls[0][1].onSuccess as (result: {
      businessId: number; retellPhoneNumber: string; changed: boolean;
    }) => void;
    act(() => onSuccess({ businessId: 44, retellPhoneNumber: '+14353245513', changed: true }));
    expect(screen.getByTestId('text-retell-phone-number-notice').textContent).toContain('saved and audited');
    const cacheUpdater = h.setQueryData.mock.calls[0][1] as (current: any) => any;
    expect(cacheUpdater(h.query.data).business.retellPhoneNumber).toBe('+14353245513');
  });

  it('requires E.164 format before showing the confirmation step', async () => {
    render(<AdminBusinessPage />);
    fireEvent.change(screen.getByTestId('input-admin-retell-phone-number'), {
      target: { value: '+1 (435) 324-5513' },
    });
    fireEvent.click(screen.getByTestId('button-review-retell-phone-number'));
    expect(await screen.findByText('Enter a valid E.164 number, for example +14353245513.')).toBeTruthy();
    expect(screen.queryByTestId('panel-confirm-retell-phone-number')).toBeNull();
    expect(h.retellPhoneMutation).not.toHaveBeenCalled();
  });

  it('shows the resolved number and saves a business-specific US fallback', () => {
    render(<AdminBusinessPage />);
    expect(screen.getByTestId('text-resolved-fallback-phone').textContent).toBe('+18634463029');
    expect(screen.getByText(/where calls should ring if the AI is unavailable/i)).toBeTruthy();
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

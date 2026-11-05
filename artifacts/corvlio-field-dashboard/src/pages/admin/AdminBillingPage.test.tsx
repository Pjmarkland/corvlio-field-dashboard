import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  data: [] as unknown[],
  mode: vi.fn(),
  override: vi.fn(),
  reinstate: vi.fn(),
  confirm: vi.fn(),
  readinessData: null as any,
  createLivePaymentTest: vi.fn(),
  livePaymentTestStatus: null as any,
  billingAvailability: { enabled: true, settled: true, mode: 'live' as 'live' | 'test' | 'off' },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('wouter', () => ({ Redirect: ({ to }: { to: string }) => <div>{to}</div> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminBillingQueryKey: () => ['admin-billing'],
  getGetAdminLivePaymentTestStatusQueryKey: (testId: string) => ['admin-live-payment-test', testId],
  getGetBillingEnforcementQueryKey: () => ['billing-enforcement'],
  useCreateAdminLivePaymentTestCheckout: () => ({ mutate: m.createLivePaymentTest, isPending: false, isError: false, error: null }),
  useGetAdminLivePaymentTestStatus: () => ({ data: m.livePaymentTestStatus, isLoading: false, isError: false }),
  useCheckAdminBillingReadiness: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: m.readinessData }),
  useGetAdminBilling: () => ({ data: m.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetStartupEligibility: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useGetBillingEnforcement: () => ({ data: {
    mode: 'off', updatedAt: null, updatedBy: null,
    businesses: [{
      businessId: 12, businessName: 'Enforcement Test Business', billingMode: 'stripe',
      accountStatus: 'suspended', neverAutoSuspend: false,
      suspension: { suspendedAt: '2026-10-20T00:00:00.000Z', source: 'stripe', invoiceId: 'in_exact' },
    }],
    manualInvoices: [{
      invoiceId: 24, businessId: 12, businessName: 'Enforcement Test Business',
      dueAt: '2026-10-01T00:00:00.000Z', paidAt: null, overdueConfirmedAt: null, overdueConfirmedBy: null,
    }],
    dryRunCandidates: [],
    auditLog: [],
  }, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetBillingEnforcementMode: () => ({ mutate: m.mode, isPending: false, isError: false }),
  useSetBillingEnforcementOverride: () => ({ mutate: m.override, isPending: false, isError: false }),
  useReinstateBillingAccount: () => ({ mutate: m.reinstate, isPending: false, isError: false }),
  useConfirmManualInvoiceOverdue: () => ({ mutate: m.confirm, isPending: false, isError: false }),
}));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: () => m.billingAvailability }));
vi.mock('./AdminShared', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  AdminEmpty: () => <p>No data</p>,
  AdminError: () => <p>Could not load</p>,
  AdminLoading: () => <p>Loading</p>,
  formatAdminDate: (value: string | null) => value ?? 'Not recorded',
}));

import AdminBillingPage from './AdminBillingPage';

beforeEach(() => {
  vi.clearAllMocks();
  m.readinessData = null;
  m.createLivePaymentTest = vi.fn();
  m.livePaymentTestStatus = null;
  m.billingAvailability = { enabled: true, settled: true, mode: 'live' };
  window.history.replaceState({}, '', '/admin/billing');
  m.data = [{
    businessId: 3,
    businessName: 'Admin Test Business',
    account: {
      plan: 'live-test-3', status: 'active', customerId: 'cus_test', subscriptionId: null,
      periodStart: null, periodEnd: null, paidPeriodEnd: null, pastDueSince: null,
      graceEndsAt: null, needsAdminReview: false, cancelAt: null, cancelRequestedAt: null,
      cancelRequestedBy: null, startupEligible: false, startupTransitionAt: null,
      setupPaid: false, usageFlags: [], lastEvent: null,
    },
    usage: { count: 0, limit: null, start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' },
    plans: [{
      id: 'live-test-3', label: 'Live Test $3', monthlyCents: 0, setupCents: 0,
      callLimit: null, billingType: 'one_time', oneTimeCents: 300, testOnly: true,
    }],
    policy: { startupEligibilityBusinessAgeMonths: 18 },
    timeline: [],
  }];
});

describe('admin billing page', () => {
  it('clearly labels a completed test payment in the admin account list', () => {
    render(<AdminBillingPage />);
    expect(screen.getByTestId('badge-test-payment-3').textContent).toContain('TEST PAYMENT');
    expect(screen.getByTestId('badge-test-payment-3').textContent).toContain('$3 ONE-TIME');
  });

  it('shows global controls, per-account override, manual confirmation, and reinstatement', () => {
    render(<AdminBillingPage />);
    expect(screen.getByTestId('select-enforcement-mode')).toBeTruthy();
    expect(screen.getByTestId('checkbox-never-auto-suspend-12')).toBeTruthy();
    expect(screen.getByTestId('button-confirm-overdue-24')).toBeTruthy();
    expect(screen.getByTestId('button-reinstate-12')).toBeTruthy();
    expect(screen.getByTestId('panel-enforcement-audit')).toBeTruthy();
    expect(screen.getByTestId('panel-dry-run-candidates')).toBeTruthy();
  });

  it('labels a restricted live Stripe key as live restricted without displaying its value', () => {
    m.readinessData = {
      mode: 'off',
      reason: 'missing_live_credentials',
      liveModeOptIn: true,
      runningInProduction: true,
      secretKeyPresent: true,
      secretKeyMode: 'live_restricted',
      webhookSecretPresent: true,
      webhookSecretValid: true,
      publicApiBaseValid: true,
      webhookUrl: null,
      webhookReachable: null,
      sms: {},
      webPush: {
        configured: false,
        publicKeyPresent: false,
        privateKeyPresent: false,
        subjectPresent: false,
        subjectValid: false,
      },
    };
    render(<AdminBillingPage />);
    expect(screen.getByText('Present (live restricted)')).toBeTruthy();
    expect(screen.queryByText(/rk_live_/)).toBeNull();
  });

  it('offers the $3 checkout only while Stripe live billing is enabled and shows webhook completion', () => {
    const first = render(<AdminBillingPage />);
    const button = screen.getByTestId('button-run-admin-live-payment-test');
    expect(button.textContent).toBe('Run $3 live payment test');
    fireEvent.click(button);
    expect(m.createLivePaymentTest).toHaveBeenCalledWith(undefined, expect.objectContaining({
      onSuccess: expect.any(Function),
    }));
    first.unmount();

    m.billingAvailability = { enabled: true, settled: true, mode: 'test' };
    const { unmount } = render(<AdminBillingPage />);
    expect(screen.queryByTestId('button-run-admin-live-payment-test')).toBeNull();
    unmount();

    m.billingAvailability = { enabled: true, settled: true, mode: 'live' };
    m.livePaymentTestStatus = {
      testId: 'test-run',
      status: 'paid',
      webhookReceived: true,
      createdAt: '2026-11-05T00:00:00.000Z',
      paidAt: '2026-11-05T00:01:00.000Z',
    };
    window.history.replaceState({}, '', '/admin/billing?adminLivePaymentTestId=test-run');
    render(<AdminBillingPage />);
    expect(screen.getByTestId('text-admin-live-payment-test-result').textContent).toBe('Paid — webhook received.');
  });

  it('submits the selected enforcement mode and account-specific actions', () => {
    render(<AdminBillingPage />);
    fireEvent.change(screen.getByTestId('select-enforcement-mode'), { target: { value: 'enforce' } });
    fireEvent.click(screen.getByTestId('checkbox-never-auto-suspend-12'));
    fireEvent.click(screen.getByTestId('button-confirm-overdue-24'));
    fireEvent.click(screen.getByTestId('button-reinstate-12'));
    expect(m.mode).toHaveBeenCalledWith({ data: { mode: 'enforce' } });
    expect(m.override).toHaveBeenCalledWith({ businessId: 12, data: { neverAutoSuspend: true } });
    expect(m.confirm).toHaveBeenCalledWith({ invoiceId: 24 });
    expect(m.reinstate).toHaveBeenCalledWith({ businessId: 12 });
  });
});

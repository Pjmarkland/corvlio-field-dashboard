import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  data: [] as unknown[],
  mode: vi.fn(),
  override: vi.fn(),
  reinstate: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('wouter', () => ({ Redirect: ({ to }: { to: string }) => <div>{to}</div> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminBillingQueryKey: () => ['admin-billing'],
  getGetBillingEnforcementQueryKey: () => ['billing-enforcement'],
  useCheckAdminBillingReadiness: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: null }),
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
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: () => ({ enabled: true, settled: true }) }));
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

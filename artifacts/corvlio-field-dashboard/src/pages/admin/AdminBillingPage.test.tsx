import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('wouter', () => ({ Redirect: ({ to }: { to: string }) => <div>{to}</div> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetAdminBillingQueryKey: () => ['admin-billing'],
  useCheckAdminBillingReadiness: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: null }),
  useGetAdminBilling: () => ({ data: m.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetStartupEligibility: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: () => ({ enabled: true, settled: true }) }));
vi.mock('./AdminShared', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  AdminEmpty: () => <p>No data</p>,
  AdminError: () => <p>Could not load</p>,
  AdminLoading: () => <p>Loading</p>,
}));

import AdminBillingPage from './AdminBillingPage';

beforeEach(() => {
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
});

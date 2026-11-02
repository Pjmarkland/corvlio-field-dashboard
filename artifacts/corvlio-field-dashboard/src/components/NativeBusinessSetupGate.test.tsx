import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  data: { submitted: false, businessName: null as string | null, provisioningState: null as string | null },
  query: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetNativeBusinessSetupStatusQueryKey: () => ['/api/businesses/native-onboard/status'],
  useGetNativeBusinessSetupStatus: (options: unknown) => {
    m.query(options);
    return { data: m.data, isPending: false, isFetching: false, isError: false, refetch: m.refetch };
  },
}));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: 'client-1' } }) }));
vi.mock('@/pages/onboarding', () => ({
  NativeOnboardingForm: () => <div data-testid="native-onboarding-form">Native setup form</div>,
}));

import NativeBusinessSetupGate from './NativeBusinessSetupGate';

function renderGate() {
  const queryClient = new QueryClient();
  const { hook } = memoryLocation({ path: '/welcome', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}><NativeBusinessSetupGate /></Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.data = { submitted: false, businessName: null, provisioningState: null };
});

describe('native setup gate', () => {
  it('shows the setup form to an account with no submitted business', () => {
    renderGate();
    expect(screen.getByTestId('native-onboarding-form')).toBeTruthy();
  });

  it('shows saved confirmation while admin activation is pending', () => {
    m.data = { submitted: true, businessName: 'Northline Heating', provisioningState: 'awaiting_activation' };
    renderGate();
    expect(screen.getByTestId('native-setup-confirmation')).toBeTruthy();
    expect(screen.getByText(/Northline Heating/)).toBeTruthy();
    expect(screen.queryByTestId('native-onboarding-form')).toBeNull();
    expect(screen.getByTestId('link-native-setup-dashboard')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Startup|Starter|Professional|Managed|checkout|payment link|\\$\\d/i);
  });
});

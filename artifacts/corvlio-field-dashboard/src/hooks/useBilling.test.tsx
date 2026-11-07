import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: false, signedIn: true, availability: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isSignedIn: m.signedIn }) }));
vi.mock('@/auth/AppAuthProvider', () => ({
  useAppAuth: () => ({
    user: null, isLoaded: true, isSignedIn: m.signedIn, error: null,
    signOut: vi.fn(), startHostedAuth: vi.fn(),
  }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetBillingAvailability: m.availability,
  getGetBillingAvailabilityQueryKey: () => ['billing-availability'],
}));
import { useBillingAvailability } from './useBilling';
beforeEach(() => {
  vi.clearAllMocks(); m.native = false; m.signedIn = true;
  m.availability.mockReturnValue({ data: { enabled: true, mode: 'test' }, isLoading: false });
});
describe('native billing exclusion', () => {
  it.each(['ios', 'android'])('blocks %s even with cached enabled billing data and disables the request', () => {
    m.native = true;
    const { result } = renderHook(useBillingAvailability);
    expect(result.current).toEqual({ enabled: false, settled: true, disabled: true, mode: 'off' });
    expect(m.availability).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ enabled: false }),
    }));
  });
  it('preserves signed-in web/PWA availability', () => {
    const { result } = renderHook(useBillingAvailability);
    expect(result.current).toEqual({ enabled: true, settled: true, disabled: false, mode: 'test' });
    expect(m.availability).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ enabled: true }),
    }));
  });
});

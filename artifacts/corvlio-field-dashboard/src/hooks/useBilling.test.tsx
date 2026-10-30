import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: false, signedIn: true, availability: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ isSignedIn: m.signedIn }) }));
vi.mock('@workspace/api-client-react', () => ({
  useGetBillingAvailability: m.availability,
  getGetBillingAvailabilityQueryKey: () => ['billing-availability'],
}));
import { useBillingAvailability } from './useBilling';
beforeEach(() => {
  vi.clearAllMocks(); m.native = false; m.signedIn = true;
  m.availability.mockReturnValue({ data: { enabled: true }, isLoading: false });
});
describe('native billing exclusion', () => {
  it.each(['ios', 'android'])('blocks %s even with cached enabled billing data and disables the request', () => {
    m.native = true;
    const { result } = renderHook(useBillingAvailability);
    expect(result.current).toEqual({ enabled: false, settled: true, disabled: true });
    expect(m.availability).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ enabled: false }),
    }));
  });
  it('preserves signed-in web/PWA availability', () => {
    const { result } = renderHook(useBillingAvailability);
    expect(result.current).toEqual({ enabled: true, settled: true, disabled: false });
    expect(m.availability).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ enabled: true }),
    }));
  });
});

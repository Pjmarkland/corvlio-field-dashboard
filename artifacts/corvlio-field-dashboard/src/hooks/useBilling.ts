import { useAppAuth } from '@/auth/AppAuthProvider';
import { Capacitor } from '@capacitor/core';
import { useGetBillingAvailability, getGetBillingAvailabilityQueryKey } from '@workspace/api-client-react';

/** Payment UI gate. Native read-only Settings uses a separate summary, never this gate. */
export function useBillingAvailability() {
  const { isSignedIn } = useAppAuth();
  const native = Capacitor.isNativePlatform();
  const query = useGetBillingAvailability({ query: { enabled: !native && Boolean(isSignedIn), queryKey: getGetBillingAvailabilityQueryKey(), retry: false, staleTime: 60_000 } });
  const enabled = !native && Boolean(isSignedIn) && query.data?.enabled === true;
  const mode = !native ? query.data?.mode ?? 'off' : 'off';
  const settled = native || (isSignedIn ? !query.isLoading : false);
  return { enabled, settled, disabled: settled && !enabled, mode };
}

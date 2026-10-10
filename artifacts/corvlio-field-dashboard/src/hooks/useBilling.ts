import { useUser } from '@clerk/react';
import { useGetBillingAvailability, getGetBillingAvailabilityQueryKey } from '@workspace/api-client-react';

/** Billing UI is visible only when the signed-in availability check explicitly says enabled. */
export function useBillingAvailability() {
  const { isSignedIn } = useUser();
  const query = useGetBillingAvailability({ query: { enabled: Boolean(isSignedIn), queryKey: getGetBillingAvailabilityQueryKey(), retry: false, staleTime: 60_000 } });
  const enabled = Boolean(isSignedIn) && query.data?.enabled === true;
  const settled = !isSignedIn ? false : !query.isLoading;
  return { enabled, settled, disabled: settled && !enabled };
}

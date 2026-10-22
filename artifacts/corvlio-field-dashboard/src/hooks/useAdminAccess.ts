import { useUser } from '@clerk/react';
import { Capacitor } from '@capacitor/core';
import { getGetAdminOverviewQueryKey, useGetAdminOverview } from '@workspace/api-client-react';

/** Use the same server-side allowlist/verified-email gate as the admin pages. */
export function useAdminAccess() {
  const { user, isSignedIn } = useUser();
  const enabled = Boolean(isSignedIn && user?.id) && !Capacitor.isNativePlatform();
  const query = useGetAdminOverview({ query: {
    queryKey: [...getGetAdminOverviewQueryKey(), user?.id],
    enabled,
    retry: false,
    staleTime: 60_000,
  } });
  return enabled && query.isSuccess && !query.isError;
}

import type { ReactNode } from 'react';
import { useUser } from '@clerk/react';
import { getGetLeadsQueryKey, useGetLeads } from '@workspace/api-client-react';
import { Redirect } from 'wouter';

/** Read-only gate: setup pages must never mount for an already configured owner. */
export function BusinessSetupGuard({ children, allowConfigured = false }: { children: ReactNode; allowConfigured?: boolean }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { data, isPending, isFetching, isError, refetch } = useGetLeads(undefined, {
    query: {
      // Do not reuse another account's cached setup decision during an auth change.
      queryKey: [...getGetLeadsQueryKey(), 'setup-entry', user?.id],
      enabled: isLoaded && isSignedIn,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

  if (isLoaded && !isSignedIn) return <Redirect to="/sign-in" />;

  if (!isLoaded || isPending || isFetching) {
    return <main className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center text-foreground" role="status">
      <p>Checking your business…</p>
    </main>;
  }

  // An unavailable lookup is not evidence that setup is needed.
  if (isError || !data || typeof data.configured !== 'boolean') {
    return <main className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center text-foreground">
      <div role="alert">
        <h1 className="text-2xl font-bold">We couldn’t check your business.</h1>
        <p className="mt-3 text-muted-foreground">Setup is paused to protect your existing details. Nothing has been changed.</p>
        <button type="button" onClick={() => void refetch()} className="mt-5 min-h-11 rounded-xl bg-primary px-5 font-bold text-primary-foreground">Try again</button>
      </div>
    </main>;
  }

  if (data.configured && !allowConfigured) return <Redirect to="/dashboard" />;
  return children;
}
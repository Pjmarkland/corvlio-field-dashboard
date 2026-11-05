import { Capacitor } from '@capacitor/core';
import { useUser } from '@clerk/react';
import { getGetBusinessProfileQueryKey, useGetBusinessProfile, getGetNativeBillingSummaryQueryKey, useGetNativeBillingSummary } from '@workspace/api-client-react';

export default function NativeBillingSection() {
  // Never change the web/PWA Settings billing link or fetch its data here.
  return Capacitor.isNativePlatform() ? <NativeBillingContent /> : null;
}

function NativeBillingContent() {
  const { isSignedIn } = useUser();
  const profile = useGetBusinessProfile({ query: { queryKey: getGetBusinessProfileQueryKey(), retry: false } });
  const internal = profile.data?.isInternal === true;
  const query = useGetNativeBillingSummary({ query: {
    queryKey: getGetNativeBillingSummaryQueryKey(), enabled: Boolean(isSignedIn) && profile.isSuccess && !internal,
    retry: false, staleTime: 0, refetchInterval: 60_000,
  } });
  const summary = query.data;
  const labels = { active: 'Active', past_due: 'Past due', canceled: 'Canceled', not_subscribed: 'No active subscription',
    requested:'Awaiting approval',invoiced:'Invoice issued',overdue:'Overdue',paid:'Current',legacy:'Legacy account' };
  if (internal || !profile.isSuccess) return null;
  return <section className="mt-4 rounded-2xl border border-border bg-card p-5 text-foreground sm:p-6" data-testid="section-native-billing">
    <h2 className="font-bold">Billing</h2>
    <p className="mt-2 text-sm text-muted-foreground">This subscription status summary is read-only.</p>
    {query.isLoading ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking subscription status…</p>
      : query.isError || !summary ? <div className="mt-4 text-sm">
        <p>Subscription status is temporarily unavailable.</p><button type="button" onClick={() => void query.refetch()} className="mt-2 min-h-11 font-semibold underline">Retry</button>
      </div> :
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subscription status</dt><dd className="text-right font-semibold">{labels[summary.status]}</dd></div>
        </dl>}
  </section>;
}

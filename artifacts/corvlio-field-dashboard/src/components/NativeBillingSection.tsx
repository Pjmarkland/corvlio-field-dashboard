import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useUser } from '@clerk/react';
import { ExternalLink } from 'lucide-react';
import { getGetBusinessProfileQueryKey, useGetBusinessProfile, getGetNativeBillingSummaryQueryKey, useGetNativeBillingSummary, useCreateBillingPortal } from '@workspace/api-client-react';
import { billingDate } from '@/lib/billingFormat';
import { openBillingWebsite, openStripeBillingPortal, websiteBillingUrl } from '@/lib/nativeBillingBrowser';

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
  const portal = useCreateBillingPortal();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const summary = query.data;
  const manageable = summary?.billingEnabled === true && summary.hasStripeCustomer;
  const open = async () => {
    if (opening) return;
    setOpening(true); setError('');
    try {
      if (manageable) {
        try {
          const result = await portal.mutateAsync();
          await openStripeBillingPortal(result.url);
        } catch (e) {
          // The gate/customer can change after the read. Never bypass a refusal.
          if (e && typeof e === 'object' && 'status' in e && (e.status === 404 || e.status === 409)) {
            await query.refetch();
            await openBillingWebsite();
          } else { throw e; }
        }
      } else { await openBillingWebsite(); }
    } catch {
      setError('Billing management could not be opened. Please try again.');
    } finally { setOpening(false); }
  };
  const labels = { active: 'Active', past_due: 'Past due', canceled: 'Canceled', not_subscribed: 'No active subscription' };
  if (internal || profile.isLoading) return null;
  return <section className="mt-4 rounded-2xl border border-border bg-card p-5 text-foreground sm:p-6" data-testid="section-native-billing">
    <h2 className="font-bold">Billing</h2>
    <p className="mt-2 text-sm text-muted-foreground">Your account information. Billing management opens in your device’s browser.</p>
    {query.isLoading ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading billing details…</p>
      : query.isError || !summary ? <div className="mt-4 text-sm">
        <p>Billing details are temporarily unavailable.</p><button type="button" onClick={() => void query.refetch()} className="mt-2 min-h-11 font-semibold underline">Retry</button>
      </div> : <dl className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Current plan</dt><dd className="text-right font-semibold">{summary.planName ?? (summary.status === 'not_subscribed' ? 'No plan selected' : 'Not available')}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subscription status</dt><dd className="text-right font-semibold">{labels[summary.status]}</dd></div>
        {summary.nextChargeDate ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Next charge date</dt><dd className="text-right font-semibold">{billingDate(summary.nextChargeDate)}</dd></div> : null}
      </dl>}
    {manageable ? <button type="button" disabled={opening} onClick={() => void open()} data-testid="button-native-manage-billing"
      className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60">
      Manage billing <ExternalLink size={15} aria-hidden="true" />
    </button> : <div className="mt-4 text-sm text-muted-foreground">
      <p>Billing is managed on our website.</p>
      <a href={websiteBillingUrl} onClick={e => { e.preventDefault(); void open(); }} aria-disabled={opening}
        data-testid="link-native-website-billing" className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-foreground underline">
        Manage billing <ExternalLink size={15} aria-hidden="true" />
      </a>
    </div>}
    {opening ? <p role="status" className="mt-3 text-sm text-muted-foreground">Opening your browser…</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-foreground">{error}</p> : null}
  </section>;
}

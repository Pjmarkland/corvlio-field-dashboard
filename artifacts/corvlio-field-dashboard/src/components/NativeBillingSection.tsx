import { Capacitor } from '@capacitor/core';
import { useUser } from '@clerk/react';
import { useState } from 'react';
import { getGetBusinessProfileQueryKey, useGetBusinessProfile, getGetNativeBillingSummaryQueryKey, useCreateBillingPortal, useGetNativeBillingSummary } from '@workspace/api-client-react';
import { billingDate } from '@/lib/billingFormat';
import { openStripeBillingPortal } from '@/lib/nativeBillingBrowser';

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
  const [portalError, setPortalError] = useState<string | null>(null);
  const summary = query.data;
  const labels = { active: 'Active', past_due: 'Past due', canceled: 'Canceled', not_subscribed: 'No active subscription',
    requested:'Awaiting approval',invoiced:'Invoice issued',overdue:'Overdue',paid:'Current',legacy:'Legacy account' };
  if (internal || !profile.isSuccess) return null;
  return <section className="mt-4 rounded-2xl border border-border bg-card p-5 text-foreground sm:p-6" data-testid="section-native-billing">
    <h2 className="font-bold">Billing</h2>
    <p className="mt-2 text-sm text-muted-foreground">Corvlio maintains your billing information. This view is read-only.</p>
    {query.isLoading ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading billing details…</p>
      : query.isError || !summary ? <div className="mt-4 text-sm">
        <p>Billing details are temporarily unavailable.</p><button type="button" onClick={() => void query.refetch()} className="mt-2 min-h-11 font-semibold underline">Retry</button>
      </div> : <>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subscription status</dt><dd className="text-right font-semibold">{labels[summary.status]}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Next invoice date</dt><dd className="text-right font-semibold">{summary.nextInvoiceDate ? billingDate(summary.nextInvoiceDate) : 'Not scheduled'}</dd></div>
        </dl>
        <button
          type="button"
          disabled={!summary.billingEnabled || !summary.hasStripeCustomer || portal.isPending}
          onClick={() => {
            setPortalError(null);
            portal.mutate(undefined, {
              onSuccess: async ({ url }) => {
                try { await openStripeBillingPortal(url); }
                catch { setPortalError('The billing portal could not be opened. Please try again.'); }
              },
              onError: () => setPortalError('The billing portal is temporarily unavailable. Please try again.'),
            });
          }}
          className="mt-5 min-h-11 rounded-xl border border-border px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-native-manage-billing"
        >
          {portal.isPending ? 'Opening billing…' : 'Manage billing'}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">Opens Stripe in your device’s external browser.</p>
        {portalError ? <p role="alert" className="mt-2 text-sm text-destructive">{portalError}</p> : null}
      </>}
  </section>;
}

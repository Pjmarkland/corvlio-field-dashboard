import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link, Redirect } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOwnerBillingQueryKey, useCancelBilling, useCreateBillingCheckout, useCreateBillingPortal,
  useGetOwnerBilling, useResumeBilling, useUpgradeBillingPlan,
  type BillingSnapshot,
  useGetBusinessProfile, getGetBusinessProfileQueryKey,
} from '@workspace/api-client-react';
import { useBillingAvailability } from '@/hooks/useBilling';
import { billingDate, errorText, isAssignedStartup, money, periodLabel, usageText } from '@/lib/billingFormat';
import OwnerInvoicePanel from '@/components/OwnerInvoicePanel';

const MAX_POLLS = 6;

export default function BillingPage() {
  if (Capacitor.isNativePlatform()) return <Redirect to="/dashboard" />;
  return <WebBillingPage />;
}

function WebBillingPage() {
  const { enabled, mode } = useBillingAvailability();
  const profile=useGetBusinessProfile({query:{queryKey:getGetBusinessProfileQueryKey(),retry:false}});
  if(!profile.isSuccess)return null;
  if(profile.data?.isInternal)return <Redirect to="/dashboard" />;
  if (profile.data?.billingMode !== 'stripe') return <main className="mx-auto min-h-screen max-w-3xl bg-background px-4 py-8 text-foreground">
    <Link href="/dashboard" className="inline-flex min-h-11 items-center font-semibold underline">Back to dashboard</Link>
    <h1 className="my-5 text-2xl font-bold">Billing</h1>
    <OwnerInvoicePanel />
  </main>;
  if (!enabled) return <main className="mx-auto min-h-screen max-w-3xl bg-background px-4 py-8 text-foreground">
    <Link href="/dashboard" className="inline-flex min-h-11 items-center font-semibold underline">Back to dashboard</Link>
    <h1 className="my-5 text-2xl font-bold">Billing</h1>
    <p>Stripe billing is temporarily unavailable. No emailed invoice has been created for this Stripe account. Contact support before making a payment.</p>
  </main>;
  return <BillingContent mode={mode === 'live' ? 'live' : 'test'} />;
}

function BillingContent({ mode }: { mode: 'off' | 'test' | 'live' }) {
  const client = useQueryClient();
  const polls = useRef(MAX_POLLS);
  const [pollTick, setPollTick] = useState(0);
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useGetOwnerBilling({
    query: { queryKey: getGetOwnerBillingQueryKey(), retry: false, refetchInterval: () => (polls.current > 0 ? 5000 : false) },
  });
  useEffect(() => { if (dataUpdatedAt) { polls.current = Math.max(0, polls.current - 1); setPollTick((t) => t + 1); } }, [dataUpdatedAt]);
  void pollTick;
  const refresh = () => { polls.current = MAX_POLLS; return client.invalidateQueries({ queryKey: getGetOwnerBillingQueryKey() }); };

  const checkout = useCreateBillingCheckout();
  const portal = useCreateBillingPortal();
  const upgrade = useUpgradeBillingPlan();
  const cancel = useCancelBilling();
  const resume = useResumeBilling();
  const [consent, setConsent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelResult, setCancelResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const portalTried = useRef(false);

  const openPortal = () => {
    setError(null);
    portal.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: (e) => setError(errorText(e)) });
  };
  const wantsPortal = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('portal') === '1';
  const portalMutate = useRef(portal.mutate);
  portalMutate.current = portal.mutate;
  useEffect(() => {
    if (data && wantsPortal && !portalTried.current) {
      portalTried.current = true;
      portalMutate.current(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: (e) => setError(errorText(e)) });
    }
  }, [data, wantsPortal]);

  if (isLoading) return <Shell><p data-testid="billing-loading" className="text-sm text-muted-foreground">Loading billing</p></Shell>;
  if (isError || !data) return <Shell><p data-testid="billing-error" className="text-sm">Billing could not be loaded.</p><button type="button" data-testid="button-billing-retry" onClick={() => void refetch()} className="mt-3 min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">Try again</button></Shell>;

  const { account, usage, plans, policy, timeline } = data as BillingSnapshot;
  const current = plans.find((p) => p.id === account.plan);
  const subscribed = Boolean(account.subscriptionId) && account.status !== 'canceled';
  const cancelling = subscribed && Boolean(account.cancelAt);
  const effectiveCancellation = subscribed ? account.cancelAt ?? cancelResult : null;
  const noNextCharge = effectiveCancellation && account.periodEnd && Date.parse(effectiveCancellation) <= Date.parse(account.periodEnd);
  const renewalBeforeCancellation = effectiveCancellation && account.periodEnd && Date.parse(effectiveCancellation) > Date.parse(account.periodEnd);
  const startupAssigned = isAssignedStartup(account);
  const chooseable = plans.filter((p) => (p.id !== 'startup' || startupAssigned)
    && !(p.testOnly && account.plan === p.id && account.status === 'active'));
  const upgrades = plans.filter((p) => p.billingType === 'recurring' && !p.testOnly
    && p.id !== 'startup' && current && p.monthlyCents > current.monthlyCents);
  const busy = checkout.isPending || upgrade.isPending || cancel.isPending || resume.isPending || portal.isPending;
  const fail = (e: unknown) => setError(errorText(e));

  return <Shell>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span data-testid={`badge-${mode === 'live' ? 'live' : 'test'}-mode`} className="rounded-full bg-muted px-3 py-1 text-xs font-bold uppercase tracking-wide">{mode === 'live' ? 'Live mode' : 'Test mode'}</span>
      <span data-testid="text-calls-never-interrupted" className="text-sm text-muted-foreground">Calls are never interrupted by billing changes.</span>
    </div>
    {error ? <p role="alert" data-testid="billing-action-error" className="mb-4 rounded-xl border border-destructive/40 p-3 text-sm">{error}</p> : null}

    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-billing-current">
      <h2 className="font-bold">Current plan</h2>
      <p data-testid="text-plan" className="mt-2 text-2xl font-800">{current?.label ?? 'No plan yet'}</p>
      {current?.testOnly ? <span data-testid="badge-test-payment" className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">TEST PAYMENT</span> : null}
      <p data-testid="text-status" className="mt-1 text-sm text-muted-foreground">Status: {account.status}</p>
      {account.plan === 'startup' && startupAssigned ? <p data-testid="text-startup-approved" className="mt-1 text-sm">Startup plan, admin approved.</p> : null}
      {current ? <p data-testid="text-price" className="mt-1 text-sm">{current.billingType === 'one_time'
        ? `${money(current.oneTimeCents ?? 0)} one-time test payment; no recurring charge or setup fee.`
        : `${money(current.monthlyCents)} per month`}</p> : null}
      <p data-testid="text-usage" className="mt-3 text-sm font-semibold">{usageText(usage)}</p>
      <p data-testid="text-period" className="text-sm text-muted-foreground">Current period: {periodLabel(usage)}</p>
      {subscribed ? <p data-testid="text-next-charge" className="mt-1 text-sm">Next charge: {noNextCharge ? 'None, plan is ending' : billingDate(account.periodEnd)}{renewalBeforeCancellation ? ' (renewal before cancellation)' : ''}</p> : null}
      {account.status === 'past_due' ? <p data-testid="text-past-due" className="mt-3 text-sm font-semibold">Payment failed. Update your card by {billingDate(account.graceEndsAt)} to keep your plan.</p> : null}
      {cancelling ? <p data-testid="text-cancel-date" className="mt-3 text-sm font-semibold">Cancellation takes effect on {billingDate(account.cancelAt)}.</p> : null}
    </section>

    <section className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      {!subscribed ? <>
        <h2 className="font-bold">Choose a plan</h2>
        <div className="mt-3 space-y-2">
          {chooseable.map((p) => {
            const priceText = p.billingType === 'one_time'
              ? `${money(p.oneTimeCents ?? 0)} one-time charge; no monthly price or setup fee.`
              : `${money(p.monthlyCents)} per month, ${money(p.setupCents)} setup, ${p.callLimit === null ? 'unlimited calls' : `${p.callLimit} calls per month`}`;
            return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3" data-testid={`plan-${p.id}`}>
              <div>
                <p className="text-sm font-bold">{p.label}{p.id === 'startup' ? ' (admin approved)' : ''}{p.testOnly ? ' — TEST ONLY' : ''}</p>
                <p className="text-xs text-muted-foreground">{priceText}</p>
                {p.testOnly ? <p data-testid="text-live-test-activation-warning" className="mt-1 max-w-xl text-xs text-muted-foreground">After payment, normal first-payment activation runs. If this business is awaiting payment and has no phone number, it may purchase and provision a Retell number.</p> : null}
              </div>
              <button type="button" disabled={busy} data-testid={`button-checkout-${p.id}`} onClick={() => { setError(null); checkout.mutate({ data: { plan: p.id } }, { onSuccess: (r) => window.location.assign(r.url), onError: fail }); }} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Checkout</button>
            </div>;
          })}
        </div>
      </> : <>
        <h2 className="font-bold">Manage</h2>
        <button type="button" disabled={busy} data-testid="button-manage-card" onClick={openPortal} className="mt-3 min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Manage card</button>
        {upgrades.length > 0 && !cancelling ? <div className="mt-4 space-y-2">
          {upgrades.map((p) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <p className="text-sm"><strong>{p.label}</strong>, {money(p.monthlyCents)} per month, {p.callLimit === null ? 'unlimited calls' : `${p.callLimit} calls per month`}</p>
            <button type="button" disabled={busy} data-testid={`button-upgrade-${p.id}`} onClick={() => { setError(null); upgrade.mutate({ data: { plan: p.id } }, { onSuccess: () => void refresh(), onError: fail }); }} className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold disabled:opacity-50">Upgrade to {p.label}</button>
          </div>)}
        </div> : null}
      </>}
    </section>

    {subscribed ? <section className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-cancel">
      <h2 className="font-bold">Cancel plan</h2>
      {cancelling ? <>
        <p className="mt-2 text-sm">Your plan ends on {billingDate(account.cancelAt)}. You can resume before that date.</p>
        <button type="button" disabled={busy} data-testid="button-resume" onClick={() => { setError(null); resume.mutate(undefined, { onSuccess: () => { setCancelResult(null); void refresh(); }, onError: fail }); }} className="mt-3 min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Resume plan</button>
      </> : !confirming ? <>
        <p className="mt-2 text-sm text-muted-foreground">Cancellation is by written request and ends on the later of {policy.cancellationNoticeDays} days from now or the end of your current paid period.</p>
        <button type="button" data-testid="button-cancel-start" onClick={() => setConfirming(true)} className="mt-3 min-h-11 rounded-xl border border-border px-4 text-sm font-bold">Request cancellation</button>
      </> : <>
        <label className="mt-2 flex items-start gap-3 text-sm"><input type="checkbox" data-testid="checkbox-cancel-consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" /><span>I understand this is my written notice of cancellation. It takes effect on the later of {policy.cancellationNoticeDays} days from today or the end of my current paid period, and I keep service until then.</span></label>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!consent || busy} data-testid="button-cancel-confirm" onClick={() => { setError(null); cancel.mutate(undefined, { onSuccess: (acct) => { setCancelResult(acct.cancelAt); setConfirming(false); setConsent(false); void refresh(); }, onError: fail }); }} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Confirm written cancellation</button>
          <button type="button" data-testid="button-cancel-back" onClick={() => { setConfirming(false); setConsent(false); }} className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold">Keep plan</button>
        </div>
      </>}
      {cancelResult ? <p data-testid="text-cancel-confirmation" className="mt-3 text-sm font-semibold">Cancellation confirmed. Effective {billingDate(cancelResult)}. You can resume before that date.</p> : null}
    </section> : null}

    {timeline.length > 0 ? <section className="mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-timeline">
      <h2 className="font-bold">Billing history</h2>
      <ul className="mt-3 space-y-2 text-sm">{timeline.map((t) => <li key={t.id} data-testid={`timeline-${t.id}`}><span className="text-muted-foreground">{billingDate(t.createdAt)}</span> {t.detail}</li>)}</ul>
    </section> : null}
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-6 sm:py-10">
    <Link href="/settings" data-testid="link-billing-back" className="text-sm font-semibold text-muted-foreground">Back to settings</Link>
    <h1 className="mb-4 mt-3 text-2xl font-800">Billing</h1>
    {children}
  </div>;
}

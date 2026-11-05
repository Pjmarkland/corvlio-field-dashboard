import { Redirect } from 'wouter';
import { Capacitor } from '@capacitor/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminBillingQueryKey, getGetAdminLivePaymentTestStatusQueryKey, getGetBillingEnforcementQueryKey,
  useCheckAdminBillingReadiness, useConfirmManualInvoiceOverdue,
  useCreateAdminLivePaymentTestCheckout, useGetAdminLivePaymentTestStatus,
  useGetAdminBilling, useGetBillingEnforcement, useReinstateBillingAccount,
  useSetBillingEnforcementMode, useSetBillingEnforcementOverride, useSetStartupEligibility,
} from '@workspace/api-client-react';
import { useBillingAvailability } from '@/hooks/useBilling';
import { billingDate, errorText, money, usageText } from '@/lib/billingFormat';
import { AdminEmpty, AdminError, AdminLoading, AdminShell, formatAdminDate } from './AdminShared';

export default function AdminBillingPage() {
  if (Capacitor.isNativePlatform()) return <Redirect to="/dashboard" />;
  return <WebAdminBillingPage />;
}

function WebAdminBillingPage() {
  const { enabled, settled, mode } = useBillingAvailability();
  if (!settled) return null;
  return <Content billingEnabled={enabled} liveBillingEnabled={enabled && mode === 'live'} />;
}

function Content({ billingEnabled, liveBillingEnabled }: { billingEnabled: boolean; liveBillingEnabled: boolean }) {
  const client = useQueryClient();
  const locationSearch = typeof window === 'undefined' ? '' : window.location.search;
  const search = new URLSearchParams(locationSearch);
  const liveTestId = search.get('adminLivePaymentTestId');
  const checkoutCanceled = search.get('checkout') === 'canceled';
  const createLivePaymentTest = useCreateAdminLivePaymentTestCheckout();
  const livePaymentTestStatus = useGetAdminLivePaymentTestStatus(liveTestId ?? '', { query: {
    queryKey: getGetAdminLivePaymentTestStatusQueryKey(liveTestId ?? ''),
    enabled: liveBillingEnabled && Boolean(liveTestId) && !checkoutCanceled,
    retry: false,
    refetchInterval: query => {
      const status = query.state.data?.status;
      return query.state.data?.webhookReceived || status === 'expired' || status === 'failed' ? false : 2500;
    },
  } });
  const enforcement = useGetBillingEnforcement({ query: {
    queryKey: getGetBillingEnforcementQueryKey(), retry: false, refetchInterval: 30_000,
  } });
  const refreshEnforcement = () => { void client.invalidateQueries({ queryKey: getGetBillingEnforcementQueryKey() }); };
  const setMode = useSetBillingEnforcementMode({ mutation: { onSuccess: refreshEnforcement } });
  const setOverride = useSetBillingEnforcementOverride({ mutation: { onSuccess: refreshEnforcement } });
  const reinstate = useReinstateBillingAccount({ mutation: { onSuccess: refreshEnforcement } });
  const confirmOverdue = useConfirmManualInvoiceOverdue({ mutation: { onSuccess: refreshEnforcement } });
  const readiness = useCheckAdminBillingReadiness();
  const { data, isLoading, isError, refetch } = useGetAdminBilling({ query: {
    queryKey: getGetAdminBillingQueryKey(), enabled: billingEnabled, retry: false,
  } });
  const setEligible = useSetStartupEligibility({ mutation: { onSuccess: () => client.invalidateQueries({ queryKey: getGetAdminBillingQueryKey() }) } });
  const title = 'Billing';
  const eyebrow = 'Founder operations';
  const readinessReason: Record<string, string> = {
    flag_off: 'Billing is off because the billing flag is not enabled.',
    live_mode_flag_off: 'A live key is configured, but the separate live-mode flag is off.',
    live_mode_requires_production: 'Live mode can only run in production.',
    missing_live_credentials: 'The live Stripe key or webhook signing secret is missing or invalid.',
    invalid_production_base: 'The public HTTPS base must match a configured Replit production domain.',
    production_disabled: 'Test billing is disabled in production.',
    missing_test_credentials: 'Test Stripe credentials are incomplete.',
    missing_or_invalid_public_base: 'The public HTTPS API base is missing or invalid.',
    live_ready: 'Live billing is enabled.',
    test_only: 'Test billing is enabled.',
  };
  const main = !billingEnabled
    ? <p className="rounded-xl border border-[#dfe4dc] bg-white/60 p-4 text-sm text-[#526159]">Stripe billing is off. New businesses continue to use emailed invoices; this check does not alter existing billing accounts.</p>
    : isLoading
      ? <AdminLoading label="Loading billing" />
      : isError || !data
        ? <AdminError onRetry={() => void refetch()} />
        : data.length === 0
          ? <AdminEmpty title="No businesses yet" description="Billing accounts appear here once businesses exist." />
          : <div className="overflow-x-auto rounded-2xl border border-[#dfe4dc] bg-white/60">
            <table className="w-full min-w-[820px] text-left text-sm" data-testid="table-admin-billing">
              <thead><tr className="border-b border-[#dfe4dc] text-xs text-[#66736c]"><th className="p-3">Business</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Usage</th><th className="p-3">Flags</th><th className="p-3">Startup eligibility</th></tr></thead>
              <tbody>{data.map((s) => {
                const a = s.account;
                const plan = s.plans.find((item) => item.id === a.plan);
                return <tr key={s.businessId} className="border-b border-[#e1e6df] align-top last:border-0" data-testid={`row-billing-${s.businessId}`}>
                  <td className="p-3 font-bold">{s.businessName}</td>
                  <td className="p-3">
                    {plan?.label ?? a.plan ?? 'None'}
                    {plan?.testOnly ? <span data-testid={`badge-test-payment-${s.businessId}`} className="mt-1 block w-fit rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">TEST PAYMENT · {money(plan.oneTimeCents ?? 0)} ONE-TIME</span> : null}
                  </td>
                  <td className="p-3">{a.status}{a.cancelAt ? `, ends ${billingDate(a.cancelAt)}` : ''}{a.status === 'past_due' ? `, grace ends ${billingDate(a.graceEndsAt)}` : ''}</td>
                  <td className="p-3">{usageText(s.usage)}</td>
                  <td className="p-3">
                    {a.needsAdminReview ? <span data-testid={`flag-review-${s.businessId}`} className="block font-semibold text-[#aa573f]">Needs admin review</span> : null}
                    {a.startupTransitionAt ? <span data-testid={`text-transition-${s.businessId}`} className="block">Startup transition: {billingDate(a.startupTransitionAt)}</span> : null}
                    {!a.needsAdminReview && !a.startupTransitionAt ? 'None' : null}
                  </td>
                  <td className="p-3"><label className="flex items-start gap-2"><input type="checkbox" data-testid={`checkbox-startup-${s.businessId}`} checked={a.startupEligible} disabled={setEligible.isPending} onChange={(e) => setEligible.mutate({ businessId: s.businessId, data: { eligible: e.target.checked } })} className="mt-1 h-4 w-4" /><span>Confirmed business under {s.policy.startupEligibilityBusinessAgeMonths} months</span></label></td>
                </tr>;
              })}</tbody>
            </table>
          </div>;
  const livePaymentTestMessage = checkoutCanceled
    ? 'Checkout was canceled; no payment was recorded.'
    : livePaymentTestStatus.data?.status === 'paid' && livePaymentTestStatus.data.webhookReceived
      ? 'Paid — webhook received.'
      : livePaymentTestStatus.data?.status === 'expired'
        ? 'Checkout expired; no payment was recorded.'
        : livePaymentTestStatus.data?.status === 'failed'
          ? 'Checkout could not be created.'
          : livePaymentTestStatus.isError
            ? 'The test result could not be loaded.'
            : 'Waiting for payment and Stripe webhook confirmation.';

  return <AdminShell title={title} eyebrow={eyebrow} action={<span data-testid="badge-admin-billing-mode" className="rounded-full bg-[#e3eee5] px-3 py-1 text-xs font-bold text-[#2c6b56]">{billingEnabled ? 'Billing on' : 'Billing off'}</span>}>
    {liveBillingEnabled ? <section className="mb-5 rounded-2xl border border-[#dfe4dc] bg-white/70 p-4 sm:p-5" data-testid="panel-admin-live-payment-test">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Live payment test</h2>
          <p className="mt-1 max-w-3xl text-sm text-[#66736c]">Runs a one-time $3 Checkout tied to your verified admin account. It does not create or change a business billing account and includes no setup fee.</p>
        </div>
        <button type="button" data-testid="button-run-admin-live-payment-test"
          disabled={createLivePaymentTest.isPending}
          onClick={() => createLivePaymentTest.mutate(undefined, {
            onSuccess: result => window.location.assign(result.url),
          })}
          className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-white disabled:opacity-50">
          {createLivePaymentTest.isPending ? 'Opening Stripe Checkout…' : 'Run $3 live payment test'}
        </button>
      </div>
      {createLivePaymentTest.isError ? <p role="alert" className="mt-3 text-sm text-[#aa573f]">{errorText(createLivePaymentTest.error)}</p> : null}
      {liveTestId ? <p role="status" data-testid="text-admin-live-payment-test-result" className="mt-3 text-sm font-semibold text-[#526159]">{livePaymentTestMessage}</p> : null}
    </section> : null}
    <section className="mb-6 space-y-5" data-testid="panel-billing-enforcement">
      <div className="rounded-2xl border border-[#dfe4dc] bg-white/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold">Unpaid-client enforcement</h2>
            <p className="mt-1 max-w-3xl text-sm text-[#66736c]">Off prevents warning delivery and suspension. Dry-run records eligible accounts without changing service. On sends day-3/day-5 reminders and may suspend after five business days, with live Stripe checks immediately before suspension.</p>
          </div>
          {enforcement.data ? <span className="rounded-full bg-[#e3eee5] px-3 py-1 text-xs font-bold text-[#2c6b56]" data-testid="badge-enforcement-mode">
            {enforcement.data.mode === 'enforce' ? 'On' : enforcement.data.mode === 'dry_run' ? 'Dry-run' : 'Off'}
          </span> : null}
        </div>
        {enforcement.isLoading ? <p className="mt-4 text-sm text-[#66736c]">Loading enforcement controls…</p> : null}
        {enforcement.isError || !enforcement.data ? <div className="mt-4"><AdminError onRetry={() => void enforcement.refetch()} /></div> : <>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-[190px] text-sm font-semibold text-[#17231f]">Global mode
              <select aria-label="Global enforcement mode" data-testid="select-enforcement-mode" value={enforcement.data.mode}
                disabled={setMode.isPending}
                onChange={(event) => setMode.mutate({ data: { mode: event.target.value as 'off' | 'dry_run' | 'enforce' } })}
                className="mt-1 min-h-11 w-full rounded-xl border border-[#cfd8cf] bg-[#fbfbf7] px-3 text-sm text-[#17231f]">
                <option value="off">Off</option><option value="dry_run">Dry-run</option><option value="enforce">On</option>
              </select>
            </label>
            <p className="text-xs text-[#66736c]">Updated {formatAdminDate(enforcement.data.updatedAt)}{enforcement.data.updatedBy ? ` by ${enforcement.data.updatedBy}` : ''}</p>
          </div>
          {setMode.isError ? <p role="alert" className="mt-2 text-sm text-[#aa573f]">{errorText(setMode.error)}</p> : null}
        </>}
      </div>

      {enforcement.data ? <>
        <section className="rounded-2xl border border-[#dfe4dc] bg-white/70 p-4 sm:p-5">
          <h3 className="font-bold">Account protections and reinstatement</h3>
          <p className="mt-1 text-sm text-[#66736c]">The never-auto-suspend setting is account-specific. Reinstatement restores only accounts suspended by this enforcement system.</p>
          {enforcement.data.businesses.length === 0 ? <p className="mt-3 text-sm text-[#66736c]">No client accounts.</p> : <ul className="mt-3 divide-y divide-[#e1e6df]">
            {enforcement.data.businesses.map((business) => <li key={business.businessId} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`enforcement-business-${business.businessId}`}>
              <div>
                <p className="font-semibold text-[#17231f]">{business.businessName}</p>
                <p className="text-xs text-[#66736c]">{business.billingMode} billing · {business.accountStatus}{business.suspension ? ` since ${formatAdminDate(business.suspension.suspendedAt)} · ${business.suspension.source} invoice ${business.suspension.invoiceId}` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={business.neverAutoSuspend}
                    disabled={setOverride.isPending}
                    data-testid={`checkbox-never-auto-suspend-${business.businessId}`}
                    onChange={(event) => setOverride.mutate({ businessId: business.businessId, data: { neverAutoSuspend: event.target.checked } })}
                    className="h-4 w-4" />
                  Never auto-suspend
                </label>
                {business.suspension ? <button type="button" disabled={reinstate.isPending}
                  data-testid={`button-reinstate-${business.businessId}`}
                  onClick={() => reinstate.mutate({ businessId: business.businessId })}
                  className="min-h-10 rounded-xl bg-[#244d3f] px-3 text-sm font-bold text-white disabled:opacity-60">
                  {reinstate.isPending ? 'Restoring…' : 'Reinstate now'}
                </button> : null}
              </div>
            </li>)}
          </ul>}
          {setOverride.isError ? <p role="alert" className="mt-2 text-sm text-[#aa573f]">{errorText(setOverride.error)}</p> : null}
          {reinstate.isError ? <p role="alert" className="mt-2 text-sm text-[#aa573f]">{errorText(reinstate.error)}</p> : null}
        </section>

        <section className="rounded-2xl border border-[#dfe4dc] bg-white/70 p-4 sm:p-5">
          <h3 className="font-bold">Manual overdue confirmations</h3>
          <p className="mt-1 text-sm text-[#66736c]">Confirm an unpaid, overdue manual invoice to start its five-business-day review period. Nothing is suspended by confirming.</p>
          <ul className="mt-3 divide-y divide-[#e1e6df]">
            {enforcement.data.manualInvoices.filter((invoice) => !invoice.paidAt).map((invoice) => <li key={invoice.invoiceId} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`manual-enforcement-invoice-${invoice.invoiceId}`}>
              <div><p className="font-semibold">{invoice.businessName} · Invoice {invoice.invoiceId}</p>
                <p className="text-xs text-[#66736c]">Due {formatAdminDate(invoice.dueAt)}{invoice.overdueConfirmedAt ? ` · Confirmed ${formatAdminDate(invoice.overdueConfirmedAt)} by ${invoice.overdueConfirmedBy ?? 'admin'}` : ' · Not confirmed'}</p>
              </div>
              {!invoice.overdueConfirmedAt && new Date(invoice.dueAt).getTime() < Date.now() ? <button type="button"
                disabled={confirmOverdue.isPending}
                data-testid={`button-confirm-overdue-${invoice.invoiceId}`}
                onClick={() => confirmOverdue.mutate({ invoiceId: invoice.invoiceId })}
                className="min-h-10 rounded-xl border border-[#cfd8cf] px-3 text-sm font-semibold disabled:opacity-60">
                {confirmOverdue.isPending ? 'Confirming…' : 'Confirm overdue'}
              </button> : null}
            </li>)}
            {enforcement.data.manualInvoices.every((invoice) => invoice.paidAt || invoice.overdueConfirmedAt || new Date(invoice.dueAt).getTime() >= Date.now())
              ? <li className="py-3 text-sm text-[#66736c]">No overdue manual invoices need confirmation.</li> : null}
          </ul>
          {confirmOverdue.isError ? <p role="alert" className="mt-2 text-sm text-[#aa573f]">{errorText(confirmOverdue.error)}</p> : null}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#dfe4dc] bg-white/70 p-4 sm:p-5" data-testid="panel-dry-run-candidates">
            <h3 className="font-bold">Dry-run candidates</h3>
            {enforcement.data.dryRunCandidates.length ? <ul className="mt-3 space-y-3">{enforcement.data.dryRunCandidates.map((candidate) =>
              <li key={candidate.id} className="border-t border-[#e1e6df] pt-3 text-sm">
                <p className="font-semibold">{candidate.businessName ?? `Business ${candidate.businessId ?? 'unknown'}`} · {candidate.source} invoice {candidate.invoiceId ?? 'unknown'}</p>
                <p className="mt-1 text-xs text-[#66736c]">{candidate.reason}</p>
                <p className="mt-1 text-xs text-[#66736c]">{formatAdminDate(candidate.createdAt)}</p>
              </li>)}</ul> : <p className="mt-3 text-sm text-[#66736c]">No dry-run candidates have been recorded.</p>}
          </div>
          <div className="rounded-2xl border border-[#dfe4dc] bg-white/70 p-4 sm:p-5" data-testid="panel-enforcement-audit">
            <h3 className="font-bold">Enforcement audit log</h3>
            {enforcement.data.auditLog.length ? <ul className="mt-3 max-h-[480px] space-y-3 overflow-auto">{enforcement.data.auditLog.map((event) =>
              <li key={event.id} className="border-t border-[#e1e6df] pt-3 text-sm">
                <p className="font-semibold">{event.businessName ?? 'Global setting'} · {event.action.replaceAll('_', ' ')}</p>
                <p className="mt-1 text-xs text-[#66736c]">{event.reason}</p>
                <p className="mt-1 text-xs text-[#66736c]">{formatAdminDate(event.createdAt)}{event.actor ? ` · ${event.actor}` : ''}</p>
              </li>)}</ul> : <p className="mt-3 text-sm text-[#66736c]">No enforcement events recorded.</p>}
          </div>
        </section>
      </> : null}
    </section>
    <section className="mb-5 rounded-2xl border border-[#dfe4dc] bg-white/60 p-4 sm:p-5" data-testid="panel-billing-readiness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-bold">Stripe readiness</h2><p className="mt-1 text-sm text-[#66736c]">Checks configuration and webhook reachability. Secret values are never displayed.</p></div>
        <button type="button" onClick={() => readiness.mutate(undefined)} disabled={readiness.isPending} className="min-h-11 rounded-xl border border-[#dfe4dc] px-4 text-sm font-semibold disabled:opacity-50" data-testid="button-check-billing-readiness">
          {readiness.isPending ? 'Checking…' : 'Check readiness'}
        </button>
      </div>
      {readiness.isError ? <p role="alert" className="mt-3 text-sm text-[#aa573f]">{errorText(readiness.error)}</p> : null}
      {readiness.data ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <p><span className="font-semibold">Mode:</span> {readiness.data.mode}</p>
        <p><span className="font-semibold">Status:</span> {readinessReason[readiness.data.reason] ?? 'Configuration needs review.'}</p>
        <p><span className="font-semibold">Live-mode flag:</span> {readiness.data.liveModeOptIn ? 'On' : 'Off'}</p>
        <p><span className="font-semibold">Runtime:</span> {readiness.data.runningInProduction ? 'Production' : 'Not production'}</p>
        <p><span className="font-semibold">Stripe key:</span> {readiness.data.secretKeyPresent ? `Present (${readiness.data.secretKeyMode.replaceAll('_', ' ')})` : 'Missing'}</p>
        <p><span className="font-semibold">Webhook secret:</span> {readiness.data.webhookSecretValid ? 'Present and valid format' : 'Missing or invalid format'}</p>
        <p><span className="font-semibold">Public HTTPS API base:</span> {readiness.data.publicApiBaseValid ? 'Valid' : 'Missing or invalid'}</p>
        <p><span className="font-semibold">Webhook reachability:</span> {readiness.data.webhookReachable === true ? 'Reachable' : readiness.data.webhookReachable === false ? 'Unreachable' : 'Not checked'}</p>
        <p data-testid="text-admin-web-push-readiness"><span className="font-semibold">Browser push:</span> {readiness.data.webPush.configured
          ? 'Configured'
          : `Missing or invalid ${[
            !readiness.data.webPush.publicKeyPresent ? 'VAPID_PUBLIC_KEY' : '',
            !readiness.data.webPush.privateKeyPresent ? 'VAPID_PRIVATE_KEY' : '',
            !readiness.data.webPush.subjectPresent || !readiness.data.webPush.subjectValid ? 'VAPID_SUBJECT' : '',
          ].filter(Boolean).join(', ')}`}</p>
        {readiness.data.webhookUrl ? <p className="break-all sm:col-span-2"><span className="font-semibold">Webhook endpoint:</span> <code>{readiness.data.webhookUrl}</code></p> : null}
      </div> : null}
    </section>
    {setEligible.isError ? <p role="alert" data-testid="admin-billing-error" className="mb-4 text-sm text-[#aa573f]">{errorText(setEligible.error)}</p> : null}
    {main}
  </AdminShell>;
}

import { Redirect } from 'wouter';
import { Capacitor } from '@capacitor/core';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAdminBillingQueryKey, useCheckAdminBillingReadiness, useGetAdminBilling, useSetStartupEligibility } from '@workspace/api-client-react';
import { useBillingAvailability } from '@/hooks/useBilling';
import { billingDate, errorText, usageText } from '@/lib/billingFormat';
import { AdminEmpty, AdminError, AdminLoading, AdminShell } from './AdminShared';

export default function AdminBillingPage() {
  if (Capacitor.isNativePlatform()) return <Redirect to="/dashboard" />;
  return <WebAdminBillingPage />;
}

function WebAdminBillingPage() {
  const { enabled, settled } = useBillingAvailability();
  if (!settled) return null;
  return <Content billingEnabled={enabled} />;
}

function Content({ billingEnabled }: { billingEnabled: boolean }) {
  const client = useQueryClient();
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
                return <tr key={s.businessId} className="border-b border-[#e1e6df] align-top last:border-0" data-testid={`row-billing-${s.businessId}`}>
                  <td className="p-3 font-bold">{s.businessName}</td>
                  <td className="p-3">{a.plan ?? 'None'}</td>
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

  return <AdminShell title={title} eyebrow={eyebrow} action={<span data-testid="badge-admin-billing-mode" className="rounded-full bg-[#e3eee5] px-3 py-1 text-xs font-bold text-[#2c6b56]">{billingEnabled ? 'Billing on' : 'Billing off'}</span>}>
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
        <p><span className="font-semibold">Stripe key:</span> {readiness.data.secretKeyPresent ? `Present (${readiness.data.secretKeyMode})` : 'Missing'}</p>
        <p><span className="font-semibold">Webhook secret:</span> {readiness.data.webhookSecretValid ? 'Present and valid format' : 'Missing or invalid format'}</p>
        <p><span className="font-semibold">Public HTTPS API base:</span> {readiness.data.publicApiBaseValid ? 'Valid' : 'Missing or invalid'}</p>
        <p><span className="font-semibold">Webhook reachability:</span> {readiness.data.webhookReachable === true ? 'Reachable' : readiness.data.webhookReachable === false ? 'Unreachable' : 'Not checked'}</p>
        {readiness.data.webhookUrl ? <p className="break-all sm:col-span-2"><span className="font-semibold">Webhook endpoint:</span> <code>{readiness.data.webhookUrl}</code></p> : null}
      </div> : null}
    </section>
    {setEligible.isError ? <p role="alert" data-testid="admin-billing-error" className="mb-4 text-sm text-[#aa573f]">{errorText(setEligible.error)}</p> : null}
    {main}
  </AdminShell>;
}

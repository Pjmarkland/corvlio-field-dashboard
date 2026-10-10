import { Redirect } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAdminBillingQueryKey, useGetAdminBilling, useSetStartupEligibility } from '@workspace/api-client-react';
import { useBillingAvailability } from '@/hooks/useBilling';
import { billingDate, errorText, usageText } from '@/lib/billingFormat';
import { AdminEmpty, AdminError, AdminLoading, AdminShell } from './AdminShared';

export default function AdminBillingPage() {
  const { enabled, disabled } = useBillingAvailability();
  if (disabled) return <Redirect to="/admin" />;
  if (!enabled) return null;
  return <Content />;
}

function Content() {
  const client = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetAdminBilling({ query: { queryKey: getGetAdminBillingQueryKey(), retry: false } });
  const setEligible = useSetStartupEligibility({ mutation: { onSuccess: () => client.invalidateQueries({ queryKey: getGetAdminBillingQueryKey() }) } });
  const title = 'Billing';
  const eyebrow = 'Founder operations';
  if (isLoading) return <AdminShell title={title} eyebrow={eyebrow}><AdminLoading label="Loading billing" /></AdminShell>;
  if (isError || !data) return <AdminShell title={title} eyebrow={eyebrow}><AdminError onRetry={() => void refetch()} /></AdminShell>;
  if (data.length === 0) return <AdminShell title={title} eyebrow={eyebrow}><AdminEmpty title="No businesses yet" description="Billing accounts appear here once businesses exist." /></AdminShell>;
  const months = data[0].policy.startupEligibilityBusinessAgeMonths;
  return <AdminShell title={title} eyebrow={eyebrow} action={<span data-testid="badge-admin-test-mode" className="rounded-full bg-[#e3eee5] px-3 py-1 text-xs font-bold text-[#2c6b56]">Test mode</span>}>
    {setEligible.isError ? <p role="alert" data-testid="admin-billing-error" className="mb-4 text-sm text-[#aa573f]">{errorText(setEligible.error)}</p> : null}
    <div className="overflow-x-auto rounded-2xl border border-[#dfe4dc] bg-white/60">
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
            <td className="p-3"><label className="flex items-start gap-2"><input type="checkbox" data-testid={`checkbox-startup-${s.businessId}`} checked={a.startupEligible} disabled={setEligible.isPending} onChange={(e) => setEligible.mutate({ businessId: s.businessId, data: { eligible: e.target.checked } })} className="mt-1 h-4 w-4" /><span>Confirmed business under {months} months</span></label></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </AdminShell>;
}

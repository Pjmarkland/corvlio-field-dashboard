import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { CheckCircle2, Clock3, ExternalLink, FileText, Globe2, Phone, Radio, UserRound } from 'lucide-react';
import { useParams } from 'wouter';
import { getGetAdminBusinessQueryKey, getGetAdminOverviewQueryKey, useGetAdminBusiness, useUpdateAdminBusinessFallbackPhone, useUpdateAdminBusinessRetellPhoneNumber, useUpdateAdminManagedReports, type AdminBusinessDetail, type AdminLeadActivity, type AdminOnboardingAnswers, type AdminBusinessSummary } from '@workspace/api-client-react';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { AdminAge, AdminEmpty, AdminError, AdminLoading, AdminMetric, AdminShell, AdminStatus, BackLink, SectionHeading, formatAdminDate, formatAdminDuration, formatAdminResponse } from './AdminShared';
import FirstClientChecklistSection from './FirstClientChecklistSection';

const E164_PHONE_NUMBER = /^\+[1-9]\d{1,14}$/;
const E164_VALIDATION_MESSAGE = 'Enter a valid E.164 number, for example +14353245513.';
type RetellPhoneNumberValues = { retellPhoneNumber: string };

const ANSWER_FIELDS: Array<{ key: keyof AdminOnboardingAnswers; label: string }> = [
  { key: 'businessName', label: 'Business name' },
  { key: 'agentName', label: 'Receptionist name' },
  { key: 'serviceArea', label: 'Service area' },
  { key: 'businessType', label: 'Business type' },
  { key: 'servicesOffered', label: 'Services offered' },
  { key: 'majorIssueExamples', label: 'Major issue examples' },
  { key: 'personalityToneDescription', label: 'Personality and tone' },
  { key: 'servicesNotOffered', label: 'Services not offered' },
  { key: 'pricingPolicy', label: 'Pricing policy' },
  { key: 'financingPolicy', label: 'Financing policy' },
  { key: 'brandsWorkedWith', label: 'Brands worked with' },
  { key: 'typicalResponseTimeCommitment', label: 'Typical response time' },
  { key: 'warrantyInfo', label: 'Warranty information' },
  { key: 'maintenancePlanOfferings', label: 'Maintenance plans' },
  { key: 'credentialsCertifications', label: 'Credentials and certifications' },
  { key: 'ownerAvailability', label: 'Owner availability' },
  { key: 'emergencyContactInfo', label: 'Emergency contact' },
  { key: 'businessWebsiteUrl', label: 'Business website' },
];

function BusinessRetellPhoneNumberSettings({
  businessId,
  business,
}: {
  businessId: number;
  business: AdminBusinessSummary;
}) {
  const queryClient = useQueryClient();
  const mutation = useUpdateAdminBusinessRetellPhoneNumber();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const form = useForm<RetellPhoneNumberValues>({
    defaultValues: { retellPhoneNumber: business.retellPhoneNumber ?? '' },
  });

  useEffect(() => {
    form.reset({ retellPhoneNumber: business.retellPhoneNumber ?? '' });
    setConfirmation(null);
  }, [business.retellPhoneNumber, form]);

  const review = form.handleSubmit(({ retellPhoneNumber }) => {
    setNotice(null);
    if (!E164_PHONE_NUMBER.test(retellPhoneNumber)) {
      form.setError('retellPhoneNumber', { type: 'validate', message: E164_VALIDATION_MESSAGE });
      return;
    }
    if (retellPhoneNumber === business.retellPhoneNumber) {
      setNotice({ type: 'error', message: 'That number is already assigned to this business.' });
      return;
    }
    setConfirmation(retellPhoneNumber);
  });

  const confirmChange = () => {
    if (!confirmation || mutation.isPending) return;
    mutation.mutate(
      { businessId, data: { retellPhoneNumber: confirmation } },
      {
        onSuccess: (result) => {
          queryClient.setQueryData<AdminBusinessDetail>(
            getGetAdminBusinessQueryKey(businessId),
            (current) => current
              ? { ...current, business: { ...current.business, retellPhoneNumber: result.retellPhoneNumber } }
              : current,
          );
          void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
          setConfirmation(null);
          setNotice({
            type: 'success',
            message: result.changed ? 'Retell number assignment saved and audited.' : 'That number is already assigned to this business.',
          });
        },
        onError: (error) => {
          const payload = error.data as unknown;
          const serverMessage = payload && typeof payload === 'object'
            && 'error' in payload && typeof payload.error === 'string' ? payload.error : null;
          setConfirmation(null);
          setNotice({
            type: 'error',
            message: error.status === 409
              ? 'That number is already assigned to another business.'
              : error.status === 400
                ? 'Enter the number in E.164 format, such as +14353245513.'
                : serverMessage ?? 'The Retell number could not be updated. Please try again.',
          });
        },
      },
    );
  };

  return <section className="admin-panel mb-7 rounded-2xl p-5" data-testid="section-retell-phone-number">
    <div className="mb-4">
      <p className="admin-label">Retell phone number</p>
      <p className="mt-1 text-sm text-[#68766c]">Assign or change the E.164 number used to match this business’s Retell webhooks. This does not change the number’s routing in Retell.</p>
    </div>
    <Form {...form}>
      <form onSubmit={review} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField control={form.control} name="retellPhoneNumber" render={({ field }) => (
          <FormItem className="min-w-0 flex-1">
            <FormLabel>Business Retell number</FormLabel>
            <FormControl>
              <Input {...field} onChange={(event) => {
                form.clearErrors('retellPhoneNumber');
                setNotice(null);
                field.onChange(event);
              }} type="tel" inputMode="tel" autoComplete="tel" maxLength={16}
                placeholder="+14353245513" data-testid="input-admin-retell-phone-number" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <button type="submit" disabled={mutation.isPending}
          data-testid="button-review-retell-phone-number"
          className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-white disabled:opacity-50">
          Review number
        </button>
      </form>
    </Form>
    {confirmation ? <div className="mt-4 rounded-xl border border-[#d8e3d9] bg-[#f1f6f0] p-4"
      data-testid="panel-confirm-retell-phone-number">
      <p className="font-semibold">Confirm this assignment</p>
      <p className="mt-2 text-sm text-[#526158]">
        {business.retellPhoneNumber ?? 'No number assigned'} → {confirmation}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-[#68766c]">
        This changes the app’s business lookup for this number. If Retell sends its webhooks here, future calls will use this business profile. Retell’s own phone routing will not be changed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={mutation.isPending} onClick={() => setConfirmation(null)}
          data-testid="button-cancel-retell-phone-number-change"
          className="min-h-10 rounded-xl border border-[#d7dfd7] px-4 text-sm font-semibold disabled:opacity-50">
          Cancel
        </button>
        <button type="button" disabled={mutation.isPending} onClick={confirmChange}
          data-testid="button-confirm-retell-phone-number-change"
          className="min-h-10 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-white disabled:opacity-50">
          {mutation.isPending ? 'Saving…' : 'Confirm number change'}
        </button>
      </div>
    </div> : null}
    {notice ? <p role={notice.type === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${notice.type === 'error' ? 'text-[#a3432d]' : 'text-[#2c6b56]'}`}
      data-testid="text-retell-phone-number-notice">{notice.message}</p> : null}
  </section>;
}

function SummaryHero({ detail }: { detail: AdminBusinessDetail }) {
  const { business } = detail;
  return <section className="mb-7 rounded-3xl bg-[#244d3f] p-6 text-[#eff6ee] shadow-[0_16px_40px_rgba(36,77,63,.14)] sm:p-8">
    <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
       <div className="flex items-start gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#3b7056] text-xl font-800 text-[#e5f2e6]">{business.businessName.slice(0, 1).toUpperCase()}</div><div><div className="mb-3 flex flex-wrap items-center gap-2">{business.isInternal ? <span className="rounded-full bg-[#e4f0e9] px-2.5 py-1 text-xs font-semibold text-[#d9ecdc]" data-testid="badge-internal-detail">Internal / non-billed</span> : null}<AdminStatus status={business.provisioningStatus} /><span data-testid="badge-account-status" className={`rounded-full px-2.5 py-1 text-xs font-semibold ${business.accountStatus === 'suspended' ? 'bg-[#fae8df] text-[#a3432d]' : 'bg-[#e4f0e9] text-[#2c6b56]'}`}>{business.accountStatus === 'suspended' ? 'Suspended' : 'Active'}</span><span className="font-mono text-[10px] uppercase tracking-wide text-[#bbd9c1]">Business #{business.id}</span></div><h2 className="text-3xl font-800 leading-none tracking-[-.06em] sm:text-5xl">{business.businessName}</h2><p className="mt-3 text-sm text-[#c6ddcb]">{business.ownerName ?? 'Owner details unavailable'} · {business.ownerEmail ?? 'Owner email not recorded'}</p></div></div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-[#75a183]/30 pt-5 text-sm xl:min-w-[350px] xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0"><div><p className="admin-label text-[#9fc5a8]">Retell number</p><p className="mt-1 font-semibold">{business.retellPhoneNumber ?? 'Not provisioned'}</p></div><div><p className="admin-label text-[#9fc5a8]">Created</p><p className="mt-1 font-semibold">{formatAdminDate(business.createdAt)}</p></div><div><p className="admin-label text-[#9fc5a8]">Last sign-in</p><p className="mt-1 font-semibold">{formatAdminDate(business.ownerLastSignInAt)}</p></div><div><p className="admin-label text-[#9fc5a8]">Agreement</p><p className="mt-1 font-semibold">{business.agreementsAcceptedAt ? `Accepted · ${business.agreementsAcceptedVersion ?? 'version not recorded'}` : 'Not accepted'}</p></div></div>
    </div>
  </section>;
}

function AnswerGrid({ onboarding }: { onboarding: AdminOnboardingAnswers }) {
  return <div className="grid gap-3 md:grid-cols-2">
    {ANSWER_FIELDS.map(({ key, label }) => {
      const value = onboarding[key];
      const isWebsite = key === 'businessWebsiteUrl';
      const displayValue = typeof value === 'string' ? value : '';
      return <div key={key} className="rounded-2xl border border-[#e1e6df] bg-[#fbfbf7] p-4" data-testid={`answer-${key}`}><p className="admin-label">{label}</p>{isWebsite && displayValue ? <a href={displayValue} target="_blank" rel="noreferrer" data-testid={`link-answer-${key}`} className="mt-2 inline-flex items-start gap-2 text-sm font-semibold leading-relaxed text-[#2c6b56] underline decoration-[#b9d1bd] underline-offset-4 hover:text-[#244d3f]">{displayValue}<ExternalLink size={13} className="mt-0.5 shrink-0" /></a> : <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${displayValue ? 'text-[#34443b]' : 'text-[#9aa49d]'}`}>{displayValue || 'Not provided'}</p>}</div>;
    })}
  </div>;
}

function EnrichmentPanel({ onboarding }: { onboarding: AdminOnboardingAnswers }) {
  const sources = Object.entries(onboarding.websiteEnrichmentSources ?? {});
  return <div className="rounded-2xl border border-[#d8e3d9] bg-[#e8f1e9] p-5">
    <div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#d3e5d6] text-[#2c6b56]"><Globe2 size={17} /></div><div><p className="admin-label text-[#4c7460]">Website intelligence</p><h3 className="mt-1 font-800 text-[#294a38]">{onboarding.websiteEnrichmentAttemptedAt ? 'Enrichment attempted' : 'No enrichment attempt recorded'}</h3></div></div>
    <p className="mt-4 text-xs text-[#5f7666]">{onboarding.websiteEnrichmentAttemptedAt ? `Attempted ${formatAdminDate(onboarding.websiteEnrichmentAttemptedAt)}.` : 'The website source metadata is empty.'}</p>
    {sources.length ? <div className="mt-4 flex flex-wrap gap-2">{sources.map(([key, value]) => <span key={key} className="rounded-lg border border-[#c7dccb] bg-[#f5faf4] px-2.5 py-1.5 font-mono text-[10px] text-[#4a6d57]"><strong>{key}</strong>: {value}</span>)}</div> : null}
  </div>;
}

function LeadRow({ lead }: { lead: AdminLeadActivity }) {
  const open = lead.status.toLowerCase() === 'pending' || lead.status.toLowerCase() === 'uncontacted';
  return <div className="border-t border-[#e1e6df] px-4 py-4 first:border-t-0 sm:px-5" data-testid={`row-admin-lead-${lead.id}`}><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-800 ${open ? 'bg-[#fae8df] text-[#a6533c]' : 'bg-[#e4f0e7] text-[#2c6b56]'}`}>{(lead.callerName ?? 'L').slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-800 text-[#25362e]">{lead.callerName ?? 'Unknown caller'}</p><span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${open ? 'bg-[#fae8df] text-[#a6533c]' : 'bg-[#e4f0e7] text-[#2c6b56]'}`}>{open ? 'Needs reply' : lead.status}</span></div><p className="mt-1 text-sm text-[#68766c]">{lead.issueReason ?? 'No issue description recorded.'}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#89948c]">{lead.phoneNumber ? <span className="inline-flex items-center gap-1"><Phone size={12} />{lead.phoneNumber}</span> : null}{lead.address ? <span>{lead.address}</span> : null}<span>{formatAdminDate(lead.createdAt)}</span></div></div><div className="hidden text-right sm:block">{open ? <AdminAge value={lead.createdAt} /> : <span className="text-xs text-[#829087]">Contacted {formatAdminDate(lead.contactedAt, 'Not dated')}</span>}</div></div></div>;
}

function CallsPanel({ detail }: { detail: AdminBusinessDetail }) {
  if (detail.calls.length === 0) return <AdminEmpty title="No calls recorded" description="No call data recorded before today." icon={Radio} />;
  return <div className="admin-panel overflow-hidden rounded-2xl"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-[#f1f4ee]"><tr><th className="px-5 py-3 admin-label">Call started</th><th className="px-5 py-3 admin-label">Duration</th><th className="px-5 py-3 admin-label">Outcome</th><th className="px-5 py-3 admin-label">Recorded</th><th className="px-5 py-3 admin-label">Retell ID</th></tr></thead><tbody>{detail.calls.map((call) => <tr key={call.id} className="border-t border-[#e1e6df] text-sm text-[#4d5c53]" data-testid={`row-admin-call-${call.id}`}><td className="px-5 py-4">{formatAdminDate(call.callStartedAt)}</td><td className="px-5 py-4 font-mono">{formatAdminDuration(call.durationMs)}</td><td className="px-5 py-4">{call.outcome ?? 'Not recorded'}</td><td className="px-5 py-4">{formatAdminDate(call.recordedAt)}</td><td className="max-w-[180px] truncate px-5 py-4 font-mono text-xs text-[#819087]" title={call.retellCallId}>{call.retellCallId}</td></tr>)}</tbody></table></div></div>;
}

function BusinessFallbackPhoneSettings({
  businessId,
  detail,
}: {
  businessId: number;
  detail: AdminBusinessDetail;
}) {
  const queryClient = useQueryClient();
  const mutation = useUpdateAdminBusinessFallbackPhone();
  const [draft, setDraft] = useState(detail.fallbackRouting.overridePhoneNumber ?? '');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setDraft(detail.fallbackRouting.overridePhoneNumber ?? '');
  }, [detail.fallbackRouting.overridePhoneNumber]);

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    setNotice(null);
    mutation.mutate(
      {
        businessId,
        data: { fallbackPhoneNumber: draft.trim() || null },
      },
      {
        onSuccess: (fallbackRouting) => {
          queryClient.setQueryData<AdminBusinessDetail>(
            getGetAdminBusinessQueryKey(businessId),
            (current) => current ? { ...current, fallbackRouting } : current,
          );
          setDraft(fallbackRouting.overridePhoneNumber ?? '');
          setNotice({ type: 'success', message: 'Fallback phone saved.' });
        },
        onError: (error) => {
          const payload = error.data as unknown;
          const message = error.status === 400 && payload && typeof payload === 'object'
            && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Could not save the fallback phone. Check the number and try again.';
          setNotice({ type: 'error', message });
        },
      },
    );
  };

  return <section className="admin-panel mb-7 rounded-2xl p-5" data-testid="section-fallback-phone">
    <div className="grid gap-5 md:grid-cols-[1fr_1.1fr] md:items-end">
      <div>
        <p className="admin-label">Resolved fallback destination</p>
        <p className="mt-2 text-xl font-800 tracking-tight text-[#25362e]" data-testid="text-resolved-fallback-phone">{detail.fallbackRouting.resolvedPhoneNumber}</p>
        <p className="mt-2 text-xs leading-relaxed text-[#68766c]">This is where calls should ring if the AI is unavailable. Retell phone-number routing must also be configured; changing this value alone does not activate forwarding.</p>
        <p className="mt-1 text-xs text-[#77847b]">Global default: {detail.fallbackRouting.defaultPhoneNumber}</p>
      </div>
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs font-semibold text-[#34443b]">
          Business-specific fallback
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={detail.fallbackRouting.defaultPhoneNumber}
            data-testid="input-business-fallback-phone"
            className="mt-1.5 min-h-11 w-full rounded-xl border border-[#d8e1d8] bg-white px-3 text-sm text-[#25362e] outline-none focus:ring-2 focus:ring-[#4e8867]"
          />
          <span className="mt-1 block font-normal text-[#77847b]">Enter a US number; it is saved in E.164 format. Leave blank to use the global default.</span>
        </label>
        <button type="submit" disabled={mutation.isPending} data-testid="button-save-fallback-phone" className="min-h-11 shrink-0 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-white disabled:opacity-60">
          {mutation.isPending ? 'Saving…' : 'Save fallback'}
        </button>
      </form>
    </div>
    {notice ? <p role={notice.type === 'error' ? 'alert' : 'status'} data-testid="status-fallback-phone" className={`mt-3 text-sm ${notice.type === 'error' ? 'text-[#a3432d]' : 'text-[#2c6b56]'}`}>{notice.message}</p> : null}
  </section>;
}

function AccountControls({ businessId, business, refresh }: {
  businessId: number;
  business: AdminBusinessSummary;
  refresh: () => void;
}) {
  const [plan, setPlan] = useState<string>(business.chosenPlan ?? 'starter');
  const [planReason, setPlanReason] = useState('');
  const [suspensionReason, setSuspensionReason] = useState(business.accountStatusReason ?? '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const submitPlan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || planReason.trim().length < 3) return;
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch(`/api/admin/invoicing/${businessId}/plan`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, reason: planReason.trim() }),
      });
      if (!response.ok) throw new Error('Plan update failed');
      setPlanReason('');
      setNotice('Plan change saved and recorded.');
      refresh();
    } catch {
      setNotice('Plan change could not be saved. Check billing status and try again.');
    } finally {
      setSaving(false);
    }
  };

  const updateSuspension = async (suspended: boolean) => {
    if (saving || (suspended && suspensionReason.trim().length < 3)) return;
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch(`/api/admin/businesses/${businessId}/suspension`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ suspended, ...(suspended ? { reason: suspensionReason.trim() } : {}) }),
      });
      if (!response.ok) throw new Error('Status update failed');
      setNotice(suspended ? 'Account suspended. Incoming calls use the generic fallback.' : 'Account restored.');
      if (!suspended) setSuspensionReason('');
      refresh();
    } catch {
      setNotice('Account status could not be updated. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="admin-panel mb-7 rounded-2xl p-5" data-testid="section-account-controls">
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submitPlan} className="space-y-3">
        <div><p className="admin-label">Plan management</p><p className="mt-1 text-sm text-[#68766c]">Plan changes are explicit and audited. Existing invoices are not rewritten.</p></div>
        <label className="block text-xs font-semibold text-[#34443b]">Plan
          <select value={plan} onChange={(event) => setPlan(event.target.value)} data-testid="select-admin-business-plan" className="mt-1.5 min-h-11 w-full rounded-xl border border-[#d8e1d8] bg-white px-3 text-sm">
            {business.chosenPlan === 'startup' ? <option value="startup">Startup</option> : null}<option value="starter">Starter</option><option value="professional">Professional</option><option value="managed">Managed</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-[#34443b]">Reason for change
          <input value={planReason} onChange={(event) => setPlanReason(event.target.value)} maxLength={300} minLength={3} data-testid="input-admin-plan-reason" className="mt-1.5 min-h-11 w-full rounded-xl border border-[#d8e1d8] bg-white px-3 text-sm font-normal" />
        </label>
        <button type="submit" disabled={saving || planReason.trim().length < 3 || plan === business.chosenPlan} data-testid="button-save-admin-plan" className="min-h-10 rounded-xl bg-[#244d3f] px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save plan change'}</button>
      </form>
      <div className="space-y-3">
        <div><p className="admin-label">Account status</p><p className="mt-1 text-sm font-semibold text-[#34443b]" data-testid="text-admin-account-status">{business.accountStatus === 'suspended' ? 'Suspended' : 'Active'}</p><p className="mt-1 text-xs text-[#68766c]">Suspension is manual; overdue payment or high usage never suspends an account automatically.</p></div>
        {business.accountStatus === 'suspended'
          ? <button type="button" disabled={saving} onClick={() => void updateSuspension(false)} data-testid="button-restore-admin-business" className="min-h-10 rounded-xl border border-[#c7dccb] px-4 text-sm font-bold text-[#2c6b56] disabled:opacity-50">Restore account</button>
          : <><label className="block text-xs font-semibold text-[#34443b]">Suspension reason
            <input value={suspensionReason} onChange={(event) => setSuspensionReason(event.target.value)} maxLength={300} minLength={3} data-testid="input-admin-suspension-reason" className="mt-1.5 min-h-11 w-full rounded-xl border border-[#d8e1d8] bg-white px-3 text-sm font-normal" />
          </label><button type="button" disabled={saving || suspensionReason.trim().length < 3} onClick={() => void updateSuspension(true)} data-testid="button-suspend-admin-business" className="min-h-10 rounded-xl border border-[#e5c7be] px-4 text-sm font-bold text-[#a3432d] disabled:opacity-50">Suspend account</button></>}
      </div>
    </div>
    {notice ? <p role="status" data-testid="status-admin-account-controls" className="mt-4 text-sm text-[#4f6f5c]">{notice}</p> : null}
  </section>;
}

export default function AdminBusinessPage() {
  const params = useParams<{ businessId: string }>();
  const queryClient = useQueryClient();
  const managedReportsMutation = useUpdateAdminManagedReports();
  const businessId = Number(params.businessId);
  const validId = Number.isInteger(businessId) && businessId > 0;
  const { data, isLoading, isError, error, refetch } = useGetAdminBusiness(businessId, { query: { enabled: validId, queryKey: getGetAdminBusinessQueryKey(businessId), retry: false } });
  const leads = useMemo(() => [...(data?.leads ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [data?.leads]);
  const notFound = !validId || Boolean(error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 404);

  if (!validId) return <AdminShell title="Business detail" eyebrow="Founder operations"><AdminError onRetry={() => undefined} notFound /></AdminShell>;
  if (isLoading) return <AdminShell title="Business detail" eyebrow="Founder operations"><AdminLoading label="Loading business detail" /></AdminShell>;
  if (isError || !data) return <AdminShell title="Business detail" eyebrow="Founder operations"><AdminError onRetry={() => void refetch()} notFound={notFound} /></AdminShell>;

  const { business, onboarding } = data;
  return <AdminShell title={business.businessName} eyebrow="Business detail">
    <BackLink href="/admin">Back to overview</BackLink>
    <SummaryHero detail={data} />
    <BusinessRetellPhoneNumberSettings businessId={businessId} business={business} />
    {!business.isInternal && !business.isSample ? <AccountControls businessId={businessId} business={business} refresh={() => {
      void queryClient.invalidateQueries({ queryKey: getGetAdminBusinessQueryKey(businessId) });
      void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
    }} /> : null}
    <section className="admin-panel mb-7 rounded-2xl p-4 text-sm text-[#34443b]" aria-label="Number setup state">
      <p className="font-semibold">{data.business.isSample ? 'Sample / demo — no live number purchased' : `Provisioning state: ${data.business.provisioningState ?? data.business.provisioningStatus}`}</p>
      {data.business.unusedNumber7Days ? <p className="mt-2 font-semibold text-[#a3432d]">No recorded calls in 7+ days. Review this number in the Retell dashboard; this console does not release or delete numbers.</p> : null}
      {data.business.lastCallAt ? <p className="mt-2">Last recorded call: {formatAdminDate(data.business.lastCallAt)}</p> : null}
    </section>
    <section className="admin-panel mb-7 flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="section-managed-reports">
      <div><p className="admin-label">Managed monthly reports</p><p className="mt-1 text-sm text-[#68766c]">When enabled, this business can view its monthly results report. New accounts default to off.</p><p className="mt-2 text-xs font-semibold text-[#4f6f5c]">{business.managedReportsEnabled ? 'Enabled' : 'Disabled'}</p></div>
      <button type="button" disabled={managedReportsMutation.isPending} data-testid="button-toggle-managed-reports" onClick={() => managedReportsMutation.mutate(
        { businessId, data: { enabled: !business.managedReportsEnabled } },
        { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetAdminBusinessQueryKey(businessId) }) },
      )} className={`min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-55 ${business.managedReportsEnabled ? 'border border-[#d7e2d8] text-[#53675a]' : 'bg-[#244d3f] text-white'}`}>
        {managedReportsMutation.isPending ? 'Saving…' : business.managedReportsEnabled ? 'Disable reports' : 'Enable reports'}
      </button>
      {managedReportsMutation.isError ? <p role="alert" className="text-xs text-[#a3432d]">The report setting could not be saved.</p> : null}
    </section>
    <BusinessFallbackPhoneSettings businessId={businessId} detail={data} />
    {!business.isInternal && !business.isSample
      ? <FirstClientChecklistSection businessId={businessId} items={data.firstClientChecklist} />
      : null}
    <section className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AdminMetric label="Onboarding" value={`${business.onboardingCompletenessPercent}%`} detail={`${business.completedOnboardingFieldCount} of ${business.onboardingFieldCount} fields`} tone={business.onboardingCompletenessPercent === 100 ? 'moss' : 'neutral'} icon={FileText} />
      <AdminMetric label="Total leads" value={business.totalLeadCount} detail={`${business.contactedLeadCount} contacted`} icon={UserRound} />
      <AdminMetric label="Response time" value={formatAdminResponse(business.averageResponseTimeMs)} detail="Average response" icon={Clock3} />
      <AdminMetric label="Push coverage" value={business.pushEnabledDeviceCount} detail={business.pushPlatforms.length ? business.pushPlatforms.join(' · ') : 'No enabled devices'} tone={business.pushEnabledDeviceCount ? 'moss' : 'neutral'} icon={Radio} />
    </section>

    <div className="grid gap-8 xl:grid-cols-[1.2fr_.8fr]">
      <section><SectionHeading eyebrow="Onboarding record" title="Complete answers" detail="The source-of-truth answers captured during business setup." /><div className="admin-panel rounded-2xl p-4 sm:p-5"><AnswerGrid onboarding={onboarding} /><div className="mt-4"><EnrichmentPanel onboarding={onboarding} /></div><div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#e1e6df] bg-[#f7f8f3] p-4 text-sm"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e3eee5] text-[#2c6b56]"><CheckCircle2 size={16} /></span><span><strong className="block text-[#30443a]">Agreements</strong><span className="text-xs text-[#77847b]">{onboarding.agreementsAcceptedAt ? `Accepted ${formatAdminDate(onboarding.agreementsAcceptedAt)} · Version ${onboarding.agreementsAcceptedVersion ?? 'not recorded'}.` : 'No acceptance timestamp recorded.'}</span></span></div></div></section>
      <section><SectionHeading eyebrow="Lead follow-up" title="Leads" detail={`${leads.length} lead${leads.length === 1 ? '' : 's'}, newest first.`} />{leads.length ? <div className="admin-panel overflow-hidden rounded-2xl">{leads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}</div> : <AdminEmpty title="No leads for this business" description="This business has not produced any lead rows yet." icon={UserRound} />}</section>
    </div>

    <section className="mt-10"><SectionHeading eyebrow="Retell operations" title="Call history" detail={`${data.calls.length} recorded call${data.calls.length === 1 ? '' : 's'}.`} /><CallsPanel detail={data} /></section>
  </AdminShell>;
}
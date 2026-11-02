import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, ExternalLink, FileText, Globe2, Phone, Radio, UserRound } from 'lucide-react';
import { useParams } from 'wouter';
import { getGetAdminBusinessQueryKey, useGetAdminBusiness, useUpdateAdminManagedReports, type AdminBusinessDetail, type AdminLeadActivity, type AdminOnboardingAnswers } from '@workspace/api-client-react';

import { AdminAge, AdminEmpty, AdminError, AdminLoading, AdminMetric, AdminShell, AdminStatus, BackLink, SectionHeading, formatAdminDate, formatAdminDuration, formatAdminResponse } from './AdminShared';

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

function SummaryHero({ detail }: { detail: AdminBusinessDetail }) {
  const { business } = detail;
  return <section className="mb-7 rounded-3xl bg-[#244d3f] p-6 text-[#eff6ee] shadow-[0_16px_40px_rgba(36,77,63,.14)] sm:p-8">
    <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
      <div className="flex items-start gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#3b7056] text-xl font-800 text-[#e5f2e6]">{business.businessName.slice(0, 1).toUpperCase()}</div><div><div className="mb-3 flex flex-wrap items-center gap-2"><AdminStatus status={business.provisioningStatus} /><span className="font-mono text-[10px] uppercase tracking-wide text-[#bbd9c1]">Business #{business.id}</span></div><h2 className="text-3xl font-800 leading-none tracking-[-.06em] sm:text-5xl">{business.businessName}</h2><p className="mt-3 text-sm text-[#c6ddcb]">{business.ownerName ?? 'Owner details unavailable'} · {business.ownerEmail ?? 'Owner email not recorded'}</p></div></div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-[#75a183]/30 pt-5 text-sm xl:min-w-[350px] xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0"><div><p className="admin-label text-[#9fc5a8]">Retell number</p><p className="mt-1 font-semibold">{business.retellPhoneNumber ?? 'Not provisioned'}</p></div><div><p className="admin-label text-[#9fc5a8]">Created</p><p className="mt-1 font-semibold">{formatAdminDate(business.createdAt)}</p></div><div><p className="admin-label text-[#9fc5a8]">Last sign-in</p><p className="mt-1 font-semibold">{formatAdminDate(business.ownerLastSignInAt)}</p></div><div><p className="admin-label text-[#9fc5a8]">Agreement</p><p className="mt-1 font-semibold">{business.agreementsAcceptedAt ? 'Accepted' : 'Not accepted'}</p></div></div>
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
    <section className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AdminMetric label="Onboarding" value={`${business.onboardingCompletenessPercent}%`} detail={`${business.completedOnboardingFieldCount} of ${business.onboardingFieldCount} fields`} tone={business.onboardingCompletenessPercent === 100 ? 'moss' : 'neutral'} icon={FileText} />
      <AdminMetric label="Total leads" value={business.totalLeadCount} detail={`${business.contactedLeadCount} contacted`} icon={UserRound} />
      <AdminMetric label="Response time" value={formatAdminResponse(business.averageResponseTimeMs)} detail="Average response" icon={Clock3} />
      <AdminMetric label="Push coverage" value={business.pushEnabledDeviceCount} detail={business.pushPlatforms.length ? business.pushPlatforms.join(' · ') : 'No enabled devices'} tone={business.pushEnabledDeviceCount ? 'moss' : 'neutral'} icon={Radio} />
    </section>

    <div className="grid gap-8 xl:grid-cols-[1.2fr_.8fr]">
      <section><SectionHeading eyebrow="Onboarding record" title="Complete answers" detail="The source-of-truth answers captured during business setup." /><div className="admin-panel rounded-2xl p-4 sm:p-5"><AnswerGrid onboarding={onboarding} /><div className="mt-4"><EnrichmentPanel onboarding={onboarding} /></div><div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#e1e6df] bg-[#f7f8f3] p-4 text-sm"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e3eee5] text-[#2c6b56]"><CheckCircle2 size={16} /></span><span><strong className="block text-[#30443a]">Agreements</strong><span className="text-xs text-[#77847b]">{onboarding.agreementsAcceptedAt ? `Accepted ${formatAdminDate(onboarding.agreementsAcceptedAt)}.` : 'No acceptance timestamp recorded.'}</span></span></div></div></section>
      <section><SectionHeading eyebrow="Lead follow-up" title="Leads" detail={`${leads.length} lead${leads.length === 1 ? '' : 's'}, newest first.`} />{leads.length ? <div className="admin-panel overflow-hidden rounded-2xl">{leads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}</div> : <AdminEmpty title="No leads for this business" description="This business has not produced any lead rows yet." icon={UserRound} />}</section>
    </div>

    <section className="mt-10"><SectionHeading eyebrow="Retell operations" title="Call history" detail={`${data.calls.length} recorded call${data.calls.length === 1 ? '' : 's'}.`} /><CallsPanel detail={data} /></section>
  </AdminShell>;
}
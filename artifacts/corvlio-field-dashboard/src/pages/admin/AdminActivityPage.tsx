import { useMemo } from 'react';
import { ArrowUpRight, CircleAlert, Clock3, Phone, Radio, Users, Wrench } from 'lucide-react';
import { Link } from 'wouter';
import { getGetAdminActivityQueryKey, useGetAdminActivity, type AdminLeadActivity } from '@workspace/api-client-react';

import { AdminEmpty, AdminError, AdminLoading, AdminMetric, AdminShell, SectionHeading, formatAdminDate } from './AdminShared';

function LeadActivityRow({ lead }: { lead: AdminLeadActivity }) {
  const isOpen = lead.status.toLowerCase() === 'pending' || lead.status.toLowerCase() === 'uncontacted';
  const initials = (lead.callerName ?? 'Lead').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <article className="group border-b border-[#e1e6df] px-4 py-5 last:border-b-0 sm:px-6" data-testid={`card-admin-activity-${lead.id}`}>
    <div className="flex items-start gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-800 ${isOpen ? 'bg-[#fae8df] text-[#aa573f]' : 'bg-[#e4f0e7] text-[#2c6b56]'}`}>{initials || 'L'}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-800 text-[#25362e]">{lead.callerName ?? 'Unknown caller'}</h3><span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${isOpen ? 'bg-[#fae8df] text-[#aa573f]' : 'bg-[#e4f0e7] text-[#2c6b56]'}`}>{isOpen ? 'Needs reply' : lead.status}</span>{lead.urgencyLevel ? <span className="font-mono text-[9px] uppercase tracking-wide text-[#8a948d]">{lead.urgencyLevel}</span> : null}</div>
        <p className="mt-1 text-sm leading-relaxed text-[#68766c]">{lead.issueReason ?? 'No issue description recorded.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#8a948d]"><Link href={`/admin/businesses/${lead.businessId}`} data-testid={`link-admin-activity-business-${lead.id}`} className="admin-link inline-flex items-center gap-1 font-semibold text-[#4f6f5c] hover:text-[#244d3f]">{lead.businessName}<ArrowUpRight size={12} /></Link>{lead.phoneNumber ? <span className="inline-flex items-center gap-1"><Phone size={12} />{lead.phoneNumber}</span> : null}{lead.address ? <span className="truncate">{lead.address}</span> : null}</div>
      </div>
      <time className="hidden shrink-0 text-right font-mono text-[10px] text-[#8a948d] sm:block" dateTime={lead.createdAt}>{formatAdminDate(lead.createdAt)}</time>
    </div>
    <time className="mt-3 block pl-[52px] font-mono text-[10px] text-[#8a948d] sm:hidden" dateTime={lead.createdAt}>{formatAdminDate(lead.createdAt)}</time>
  </article>;
}

export default function AdminActivityPage() {
  const { data, isLoading, isError, error, refetch } = useGetAdminActivity({ query: { queryKey: getGetAdminActivityQueryKey(), retry: false } });
  const leads = useMemo(() => [...(data?.recentLeads ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [data?.recentLeads]);
  const notFound = Boolean(error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 404);

  if (isLoading) return <AdminShell title="Lead activity" eyebrow="Founder operations"><AdminLoading label="Loading global lead activity" /></AdminShell>;
  if (isError || !data) return <AdminShell title="Lead activity" eyebrow="Founder operations"><AdminError onRetry={() => void refetch()} notFound={notFound} /></AdminShell>;

  return <AdminShell title="Lead activity" eyebrow="Founder operations" action={<span className="hidden items-center gap-2 text-xs text-[#76837a] sm:flex"><span className="h-2 w-2 rounded-full bg-[#4e8d70]" />Newest first</span>}>
    <section className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AdminMetric label="Businesses" value={data.businessCount} detail="With access to the console" icon={Radio} />
      <AdminMetric label="All leads" value={data.totalLeadCount} detail="Across every business" tone="moss" icon={Users} />
      <AdminMetric label="Uncontacted" value={data.uncontactedLeadCount} detail="Still waiting for a response" tone={data.uncontactedLeadCount ? 'coral' : 'neutral'} icon={CircleAlert} />
      <AdminMetric label="Over 24 hours" value={data.uncontactedOver24HoursCount} detail="Oldest open follow-ups" tone={data.uncontactedOver24HoursCount ? 'coral' : 'neutral'} icon={Clock3} />
    </section>
    <section>
      <SectionHeading eyebrow="Global feed" title="Recent leads" detail="The latest incoming lead activity across the Corvlio portfolio." />
      {leads.length === 0 ? <AdminEmpty title="No lead activity yet" description="When a receptionist captures a lead, it will appear here in newest-first order." icon={Radio} /> : <div className="admin-panel overflow-hidden rounded-2xl">{leads.map((lead) => <LeadActivityRow key={lead.id} lead={lead} />)}</div>}
    </section>
    <section className="mt-10">
      <SectionHeading eyebrow="Reliability" title="Operational failures" detail="Call, lead-email, and phone-provisioning failures requiring review." />
      {data.operationalFailures.length === 0
        ? <AdminEmpty title="No operational failures" description="Recorded pipeline failures will appear here with their alert delivery status." icon={Wrench} />
        : <div className="admin-panel overflow-hidden rounded-2xl">
          {data.operationalFailures.map((failure) => <article key={failure.id} className="border-b border-[#e1e6df] px-4 py-5 last:border-b-0 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-800 text-[#25362e]">{failure.summary}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[#68766c]">{failure.details}</p>
                <p className="mt-2 text-xs text-[#8a948d]">{failure.source.replaceAll('_', ' ')}{failure.businessName ? ` · ${failure.businessName}` : ''}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-wide ${failure.alertSentAt ? 'bg-[#e4f0e7] text-[#2c6b56]' : 'bg-[#fae8df] text-[#aa573f]'}`}>{failure.alertSentAt ? 'Alert sent' : failure.alertAttempts ? 'Retry pending' : 'Alert queued'}</span>
                <time className="mt-2 block font-mono text-[10px] text-[#8a948d]" dateTime={failure.createdAt}>{formatAdminDate(failure.createdAt)}</time>
              </div>
            </div>
            {failure.alertLastError ? <p className="mt-2 text-xs text-[#aa573f]">Last alert error: {failure.alertLastError}</p> : null}
          </article>)}
        </div>}
    </section>
  </AdminShell>;
}
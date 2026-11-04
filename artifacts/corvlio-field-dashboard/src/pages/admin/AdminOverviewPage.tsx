import { useMemo, useState } from 'react';
import { ArrowUpRight, Building2, ChevronDown, ChevronUp, CircleAlert, Smartphone, Users } from 'lucide-react';
import { Link } from 'wouter';
import { getGetAdminOverviewQueryKey, useGetAdminOverview, type AdminBusinessSummary } from '@workspace/api-client-react';

import AdminCallQuality from './AdminCallQuality';
import PendingRetellReleases from './PendingRetellReleases';
import InternalBusinessesSection from './InternalBusinessesSection';
import AppReviewDemoSection from './AppReviewDemoSection';
import UsageAlertSettingsSection from './UsageAlertSettingsSection';
import { AdminAge, AdminEmpty, AdminError, AdminLoading, AdminMetric, AdminShell, AdminStatus, SectionHeading, formatAdminResponse, formatAdminShortDate } from './AdminShared';

type SortKey = 'createdAt' | 'businessName' | 'onboardingCompletenessPercent' | 'totalLeadCount' | 'uncontactedLeadCount' | 'provisioningStatus';

function sortValue(business: AdminBusinessSummary, key: SortKey) {
  const value = business[key];
  if (typeof value === 'string') return value.toLowerCase();
  return value ?? -1;
}

function SortButton({ label, sortKey, activeKey, direction, onSort }: { label: string; sortKey: SortKey; activeKey: SortKey; direction: 'asc' | 'desc'; onSort: (key: SortKey) => void }) {
  const active = activeKey === sortKey;
  return <button type="button" onClick={() => onSort(sortKey)} data-testid={`button-sort-${sortKey}`} className={`inline-flex min-h-9 items-center gap-1.5 text-left font-mono text-[10px] uppercase tracking-[.08em] ${active ? 'text-[#244d3f]' : 'text-[#7b877f] hover:text-[#244d3f]'}`} aria-label={`Sort by ${label}`}>
    {label}{active ? direction === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} /> : null}
  </button>;
}

function BusinessRow({ business }: { business: AdminBusinessSummary }) {
  return <tr className="group border-t border-[#e1e6df] align-top hover:bg-[#f4f7f1]" data-testid={`row-admin-business-${business.id}`}>
    <td className="px-4 py-4 sm:px-5">
      <Link href={`/admin/businesses/${business.id}`} data-testid={`link-admin-business-${business.id}`} className="admin-link block min-w-[190px]">
        <span className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dcebe1] text-xs font-800 text-[#2c6b56]">{business.businessName.slice(0, 1).toUpperCase()}</span><span><strong className="block text-sm font-800 text-[#25362e]">{business.businessName}</strong><span className="mt-0.5 block max-w-[190px] truncate text-xs text-[#647168]">{business.ownerName ?? 'Owner details unavailable'}</span><span className="block max-w-[190px] truncate text-xs text-[#7b877f]">{business.ownerEmail ?? 'Owner email not recorded'}</span></span></span>
      </Link>
    </td>
    <td className="px-4 py-4 sm:px-5">
      {business.isInternal ? <span className="mb-1 mr-1 inline-block rounded-full bg-[#e4f0e9] px-2.5 py-1 text-xs font-semibold text-[#2c6b56]" data-testid={`badge-internal-row-${business.id}`}>Internal / non-billed</span> : null}
      {business.isSample ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Sample / demo</span> : <AdminStatus status={business.provisioningStatus} />}
      {business.accountStatus === 'suspended' ? <span data-testid={`badge-suspended-${business.id}`} className="mt-1 inline-block rounded-full bg-[#fae8df] px-2.5 py-1 text-xs font-semibold text-[#a3432d]">Suspended</span> : null}
      {business.billingReviewReasons.map((reason) => <span key={reason} data-testid={`badge-billing-review-${business.id}`} className="mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{reason}</span>)}
      <p className="mt-2 text-xs text-[#536258]">{business.retellPhoneNumber ?? 'No assigned number'}</p>
      <p className="mt-1 text-xs text-[#536258]">State: {business.provisioningState ?? business.provisioningStatus}</p>
      {business.unusedNumber7Days ? <p className="mt-2 text-xs font-semibold text-[#a3432d]" data-testid={`unused-number-${business.id}`}>No recorded calls in 7+ days — review in provider dashboard</p> : null}
      {business.lastCallAt ? <p className="mt-1 text-xs text-[#536258]">Last call: {new Date(business.lastCallAt).toLocaleDateString()}</p> : null}
    </td>
    <td className="px-4 py-4 sm:px-5"><div className="flex min-w-[110px] items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#e4e9e2]"><div className="h-full rounded-full bg-[#4e8d70]" style={{ width: `${Math.min(100, Math.max(0, business.onboardingCompletenessPercent))}%` }} /></div><span className="font-mono text-xs text-[#526158]">{business.onboardingCompletenessPercent}%</span></div><p className="mt-2 text-xs text-[#7b877f]">{business.completedOnboardingFieldCount}/{business.onboardingFieldCount} fields</p>{business.firstClientChecklistTotalCount > 0 ? <p className="mt-1 text-xs font-semibold text-[#536258]" data-testid={`checklist-progress-${business.id}`}>First-client checklist {business.firstClientChecklistCompletedCount}/{business.firstClientChecklistTotalCount}</p> : null}</td>
    <td className="px-4 py-4 sm:px-5"><p className="font-mono text-sm font-medium text-[#25362e]">{business.totalLeadCount}</p><p className="mt-1 text-xs text-[#7b877f]">{business.contactedLeadCount} contacted</p></td>
    <td className="px-4 py-4 sm:px-5"><p className={`font-mono text-sm font-medium ${business.uncontactedLeadCount ? 'text-[#b2553e]' : 'text-[#6f7b73]'}`}>{business.uncontactedLeadCount}</p>{business.hasUncontactedOver24Hours ? <AdminAge value={business.oldestUncontactedAt} /> : <p className="mt-1 text-xs text-[#7b877f]">No overdue leads</p>}</td>
    <td className="whitespace-nowrap px-4 py-4 text-xs text-[#6e7b72] sm:px-5"><p>{formatAdminShortDate(business.createdAt)}</p><p className="mt-1 text-[11px]">{formatAdminResponse(business.averageResponseTimeMs)} avg reply</p></td>
    <td className="px-4 py-4 text-right sm:px-5"><Link href={`/admin/businesses/${business.id}`} data-testid={`link-admin-open-${business.id}`} aria-label={`Open ${business.businessName}`} className="inline-grid h-9 w-9 place-items-center rounded-xl border border-[#d7dfd7] text-[#637168] hover:border-[#9ebaa7] hover:bg-[#e5f0e7] hover:text-[#244d3f]"><ArrowUpRight size={16} /></Link></td>
  </tr>;
}

export default function AdminOverviewPage() {
  const { data, isLoading, isError, error, refetch } = useGetAdminOverview({ query: { queryKey: getGetAdminOverviewQueryKey(), retry: false } });
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');

  const sortedBusinesses = useMemo(() => [...(data?.businesses ?? [])].sort((a, b) => {
    const aValue = sortValue(a, sortKey);
    const bValue = sortValue(b, sortKey);
    if (aValue < bValue) return direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return direction === 'asc' ? 1 : -1;
    return 0;
  }), [data?.businesses, direction, sortKey]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setDirection(key === 'createdAt' ? 'desc' : 'asc'); }
  };

  if (isLoading) return <AdminShell title="Overview" eyebrow="Founder operations"><AdminLoading /></AdminShell>;
  if (isError || !data) return <AdminShell title="Overview" eyebrow="Founder operations"><AdminError onRetry={() => void refetch()} notFound={Boolean(error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 404)} /></AdminShell>;

  const { metrics } = data;
  return <AdminShell title="Overview" eyebrow="Founder operations" action={<span className="hidden items-center gap-2 text-xs text-[#76837a] sm:flex"><span className="h-2 w-2 rounded-full bg-[#4e8d70]" />Live read-only snapshot</span>}>
    <PendingRetellReleases />
    <InternalBusinessesSection />
    <AppReviewDemoSection />
    <UsageAlertSettingsSection />
    <section className="mb-8 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <div className="relative overflow-hidden rounded-3xl bg-[#244d3f] p-6 text-[#eff6ee] shadow-[0_16px_40px_rgba(36,77,63,.15)] sm:p-8">
        <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full border-[26px] border-[#4e8d70]/25" /><div className="absolute -bottom-24 right-20 h-48 w-48 rounded-full border border-[#bad7c2]/20" />
        <p className="admin-label text-[#b8d6bf]">The operating picture</p>
        <h2 className="mt-4 max-w-lg text-3xl font-800 leading-[.98] tracking-[-.065em] sm:text-5xl">Know where every business stands.</h2>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-[#c9ddd0]">Onboarding, provisioning, lead response, and call coverage in one founder-level view.</p>
        <div className="mt-8 flex flex-wrap gap-2"><span className="rounded-full border border-[#7eae8f]/40 bg-[#356650] px-3 py-1.5 font-mono text-[10px] text-[#d9ecdc]">{metrics.businessCount} businesses tracked</span><span className="rounded-full border border-[#7eae8f]/40 bg-[#356650] px-3 py-1.5 font-mono text-[10px] text-[#d9ecdc]">{metrics.provisionedBusinessCount} provisioned</span></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <AdminMetric label="Total leads" value={metrics.totalLeadCount} detail={`${metrics.uncontactedLeadCount} need a reply`} tone="moss" icon={Users} />
        <AdminMetric label="Over 24 hours" value={metrics.uncontactedOver24HoursCount} detail="Uncontacted leads" tone={metrics.uncontactedOver24HoursCount ? 'coral' : 'neutral'} icon={CircleAlert} />
        <AdminMetric label="No-lead businesses" value={metrics.zeroLeadBusinessCount} detail="Worth a closer look" icon={Building2} />
        <AdminMetric label="Push devices" value={metrics.activePushDeviceCount} detail="Enabled devices" icon={Smartphone} />
      </div>
    </section>

    <section>
      <SectionHeading eyebrow="Portfolio" title="Businesses" detail="Newest businesses first. Select a column to change the sort." action={<Link href="/admin/activity" data-testid="link-admin-activity-overview" className="admin-link inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d5dfd5] bg-[#fbfbf7] px-3 text-xs font-bold text-[#536258] hover:bg-[#e7f1e9] hover:text-[#244d3f]">Open activity <ArrowUpRight size={14} /></Link>} />
      {sortedBusinesses.length === 0 ? <AdminEmpty title="No businesses in the console" description="The founder overview has no businesses to display yet." /> : <div className="admin-panel overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead className="bg-[#f1f4ee]"><tr>
              <th className="px-4 py-3 sm:px-5"><SortButton label="Business" sortKey="businessName" activeKey={sortKey} direction={direction} onSort={handleSort} /></th>
              <th className="px-4 py-3 sm:px-5"><SortButton label="Provisioning" sortKey="provisioningStatus" activeKey={sortKey} direction={direction} onSort={handleSort} /></th>
              <th className="px-4 py-3 sm:px-5"><SortButton label="Onboarding" sortKey="onboardingCompletenessPercent" activeKey={sortKey} direction={direction} onSort={handleSort} /></th>
              <th className="px-4 py-3 sm:px-5"><SortButton label="Leads" sortKey="totalLeadCount" activeKey={sortKey} direction={direction} onSort={handleSort} /></th>
              <th className="px-4 py-3 sm:px-5"><SortButton label="Needs reply" sortKey="uncontactedLeadCount" activeKey={sortKey} direction={direction} onSort={handleSort} /></th>
              <th className="px-4 py-3 sm:px-5"><SortButton label="Joined" sortKey="createdAt" activeKey={sortKey} direction={direction} onSort={handleSort} /></th><th aria-label="Open business" />
            </tr></thead>
            <tbody>{sortedBusinesses.map((business) => <BusinessRow key={business.id} business={business} />)}</tbody>
          </table>
        </div>
      </div>}
    </section>
    <AdminCallQuality />
  </AdminShell>;
}
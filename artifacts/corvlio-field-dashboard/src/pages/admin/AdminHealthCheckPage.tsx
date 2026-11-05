import { Activity, AlertTriangle, Clock3, Mail, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetAdminHealthCheckQueryKey,
  useGetAdminHealthCheck,
} from '@workspace/api-client-react';
import { AdminEmpty, AdminError, AdminLoading, AdminMetric, AdminShell, formatAdminDate, SectionHeading } from './AdminShared';

function successDetail(value: string | null) {
  return value ? `Last success: ${formatAdminDate(value)}` : 'No successful webhook recorded yet';
}

export default function AdminHealthCheckPage() {
  const query = useGetAdminHealthCheck({
    query: {
      queryKey: getGetAdminHealthCheckQueryKey(),
      retry: false,
      refetchInterval: 30_000,
    },
  });

  if (query.isLoading) {
    return <AdminShell title="Health check" eyebrow="Founder operations"><AdminLoading label="Loading Retell health check" /></AdminShell>;
  }
  if (query.isError || !query.data) {
    return <AdminShell title="Health check" eyebrow="Founder operations"><AdminError onRetry={() => void query.refetch()} /></AdminShell>;
  }

  return <AdminShell
    title="Health check"
    eyebrow="Founder operations"
    action={<button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d8e1d8] px-3 text-xs font-bold text-[#52645a] disabled:opacity-60" data-testid="button-refresh-health-check"><RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />Refresh</button>}
  >
    <section className="mb-9 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AdminMetric
        label="Pre-call webhook"
        value={query.data.lastPreCallSuccessfulAt ? formatAdminDate(query.data.lastPreCallSuccessfulAt) : 'Not recorded'}
        detail={successDetail(query.data.lastPreCallSuccessfulAt)}
        icon={Activity}
        tone={query.data.lastPreCallSuccessfulAt ? 'moss' : 'coral'}
      />
      <AdminMetric
        label="Post-call webhook"
        value={query.data.lastPostCallSuccessfulAt ? formatAdminDate(query.data.lastPostCallSuccessfulAt) : 'Not recorded'}
        detail={successDetail(query.data.lastPostCallSuccessfulAt)}
        icon={Clock3}
        tone={query.data.lastPostCallSuccessfulAt ? 'moss' : 'coral'}
      />
      <AdminMetric
        label="Last successful lead email"
        value={query.data.lastSuccessfulLeadEmailAt ? formatAdminDate(query.data.lastSuccessfulLeadEmailAt) : 'Not recorded'}
        detail={query.data.lastSuccessfulLeadEmailAt
          ? `Delivered: ${formatAdminDate(query.data.lastSuccessfulLeadEmailAt)}`
          : 'Tracking begins with newly delivered lead emails.'}
        icon={Mail}
        tone={query.data.lastSuccessfulLeadEmailAt ? 'moss' : 'neutral'}
      />
      <AdminMetric
        label="Open alerts"
        value={query.data.openAlertCount}
        detail={query.data.openAlertCount ? 'Review unresolved incidents below.' : 'No unresolved incidents.'}
        icon={AlertTriangle}
        tone={query.data.openAlertCount ? 'coral' : 'neutral'}
      />
    </section>

    <section>
      <SectionHeading
        eyebrow="Needs attention"
        title="Open system alerts"
        detail="Webhook times update after successful processing. Lead-email time updates only after confirmed delivery."
        action={<Link href="/admin/system-alerts" data-testid="link-health-system-alerts" className="admin-link inline-flex min-h-10 items-center rounded-xl border border-[#d8e1d8] px-3 text-xs font-bold text-[#52645a]">View all alerts</Link>}
      />
      {query.data.openAlerts.length === 0
        ? <AdminEmpty title="No open system alerts" description="New webhook failures and unmatched numbers will appear here if detected." icon={AlertTriangle} />
        : <div className="admin-panel overflow-hidden rounded-2xl">
          {query.data.openAlerts.map((alert) => <article key={alert.id} className="border-b border-[#e1e6df] px-4 py-5 last:border-b-0 sm:px-6" data-testid={`health-open-alert-${alert.id}`}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fae4dc] text-[#a6533c]"><AlertTriangle size={17} /></div>
              <div className="min-w-0">
                <h3 className="text-sm font-800 text-[#25362e]">{alert.summary}</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#68766c]">{alert.details}</p>
                <p className="mt-2 text-xs text-[#849087]">{alert.endpoint} · {alert.category.replaceAll('_', ' ')} · Last seen {formatAdminDate(alert.lastSeenAt)}</p>
              </div>
            </div>
          </article>)}
        </div>}
    </section>
  </AdminShell>;
}

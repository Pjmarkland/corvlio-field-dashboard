import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock3, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminHealthCheckQueryKey,
  getGetAdminSystemAlertsQueryKey,
  useGetAdminSystemAlerts,
  useResolveAdminSystemAlert,
} from '@workspace/api-client-react';
import { AdminEmpty, AdminError, AdminLoading, AdminShell, formatAdminDate, SectionHeading } from './AdminShared';

type AlertFilter = 'open' | 'all';

export default function AdminSystemAlertsPage() {
  const queryClient = useQueryClient();
  const query = useGetAdminSystemAlerts({
    query: {
      queryKey: getGetAdminSystemAlertsQueryKey(),
      retry: false,
      refetchInterval: 30_000,
    },
  });
  const resolveMutation = useResolveAdminSystemAlert();
  const [filter, setFilter] = useState<AlertFilter>('open');

  const alerts = useMemo(() => {
    const allAlerts = query.data?.alerts ?? [];
    return filter === 'open' ? allAlerts.filter((alert) => alert.status === 'open') : allAlerts;
  }, [filter, query.data?.alerts]);

  const refresh = () => {
    void Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: getGetAdminHealthCheckQueryKey() }),
    ]);
  };

  const resolveAlert = (alertId: number) => resolveMutation.mutate({ alertId }, {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetAdminSystemAlertsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetAdminHealthCheckQueryKey() });
    },
  });

  if (query.isLoading) {
    return <AdminShell title="System alerts" eyebrow="Founder operations"><AdminLoading label="Loading system alerts" /></AdminShell>;
  }
  if (query.isError || !query.data) {
    return <AdminShell title="System alerts" eyebrow="Founder operations"><AdminError onRetry={refresh} /></AdminShell>;
  }

  return <AdminShell
    title="System alerts"
    eyebrow="Founder operations"
    action={<button type="button" onClick={refresh} disabled={query.isFetching} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d8e1d8] px-3 text-xs font-bold text-[#52645a] disabled:opacity-60" data-testid="button-refresh-system-alerts"><RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />Refresh</button>}
  >
    <section className="mb-7 grid gap-3 sm:grid-cols-2">
      <div className={`admin-panel rounded-2xl p-5 ${query.data.openCount ? 'border-[#ebc4b9] bg-[#fbefeb]' : ''}`}>
        <p className="admin-label">Open alerts</p>
        <p className={`mt-3 text-3xl font-800 tracking-[-0.06em] ${query.data.openCount ? 'text-[#aa493b]' : 'text-[#244d3f]'}`} data-testid="metric-open-system-alerts">{query.data.openCount}</p>
        <p className="mt-1 text-xs text-[#718078]">Distinct issues; repeat notifications are limited to once per 15 minutes.</p>
      </div>
      <div className="admin-panel rounded-2xl p-5">
        <p className="admin-label">Tracked incidents</p>
        <p className="mt-3 text-3xl font-800 tracking-[-0.06em] text-[#17231f]">{query.data.alerts.length}</p>
        <p className="mt-1 text-xs text-[#718078]">Most recently seen incidents, including resolved alerts.</p>
      </div>
    </section>

    <section>
      <SectionHeading
        eyebrow="Retell webhook monitoring"
        title="Incident history"
        detail="Alerts are grouped by issue. Review the details and resolve issues that are no longer active."
        action={<div className="flex gap-1 rounded-xl border border-[#dfe4dc] bg-[#f8f9f5] p-1" role="group" aria-label="Filter system alerts">
          {(['open', 'all'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-9 rounded-lg px-3 text-xs font-bold capitalize ${filter === value ? 'bg-white text-[#244d3f] shadow-sm' : 'text-[#718078]'}`} data-testid={`button-alert-filter-${value}`}>{value === 'open' ? `Open (${query.data.openCount})` : 'All recent'}</button>)}
        </div>}
      />
      {alerts.length === 0
        ? <AdminEmpty
          title={filter === 'open' ? 'No open system alerts' : 'No incidents recorded'}
          description={filter === 'open' ? 'New Retell webhook failures and unmatched numbers will appear here.' : 'Recent Retell webhook incidents will appear here when recorded.'}
          icon={AlertTriangle}
        />
        : <div className="admin-panel overflow-hidden rounded-2xl">
          {alerts.map((alert) => <article key={alert.id} className="border-b border-[#e1e6df] px-4 py-5 last:border-b-0 sm:px-6" data-testid={`card-system-alert-${alert.id}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-800 text-[#25362e]">{alert.summary}</h3>
                  <span className={`rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-wide ${alert.status === 'open' ? 'bg-[#fae4dc] text-[#a6533c]' : 'bg-[#e4f0e7] text-[#2c6b56]'}`}>{alert.status}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#68766c]">{alert.details}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#849087]">
                  <span>{alert.endpoint} · {alert.category.replaceAll('_', ' ')}</span>
                  {alert.businessName ? <span>{alert.businessName}</span> : null}
                  <span>{alert.occurrenceCount} {alert.occurrenceCount === 1 ? 'occurrence' : 'occurrences'}</span>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-[#849087]">
                  <Clock3 size={12} /> First seen {formatAdminDate(alert.firstSeenAt)} · Last seen {formatAdminDate(alert.lastSeenAt)}
                  {alert.resolvedAt ? <span>· Resolved {formatAdminDate(alert.resolvedAt)}{alert.resolvedBy ? ` by ${alert.resolvedBy}` : ''}</span> : null}
                </p>
              </div>
              {alert.status === 'open' ? <button
                type="button"
                disabled={resolveMutation.isPending}
                onClick={() => resolveAlert(alert.id)}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#c7dccb] px-4 text-xs font-bold text-[#2c6b56] disabled:cursor-wait disabled:opacity-55"
                data-testid={`button-resolve-system-alert-${alert.id}`}
              ><Check size={14} />Resolve</button> : null}
            </div>
          </article>)}
        </div>}
    </section>
  </AdminShell>;
}

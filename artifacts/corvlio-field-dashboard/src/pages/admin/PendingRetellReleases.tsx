import { useQueryClient } from '@tanstack/react-query';
import { getGetPendingRetellReleasesQueryKey, useGetPendingRetellReleases, useCompletePendingRetellRelease } from '@workspace/api-client-react';
import { useState } from 'react';
export default function PendingRetellReleases() {
  const client = useQueryClient();
  const query = useGetPendingRetellReleases({ query: { queryKey: getGetPendingRetellReleasesQueryKey(), retry: false, refetchInterval: 30_000 } });
  const complete = useCompletePendingRetellRelease();
  const [error, setError] = useState('');
  const mark = async (id: number) => {
    if (!window.confirm('Have you manually reviewed and released this resource in Retell? This button only records completion. Do not delete an agent shared by other businesses.')) return;
    setError('');
    try {
      await complete.mutateAsync({ releaseId: id, data: { confirmation: 'MANUALLY RELEASED' } });
      await client.invalidateQueries({ queryKey: getGetPendingRetellReleasesQueryKey() });
    } catch { setError('Could not record manual release. Please retry.'); }
  };
  return <section className="mb-8 rounded-2xl border border-border bg-card p-5 text-foreground" data-testid="section-pending-retell-releases">
    <h2 className="text-xl font-bold">Pending Retell releases</h2>
    <p className="mt-2 text-sm text-muted-foreground">Deleted accounts may still have provider resources. Review and release them manually in Retell.
      No Retell release or deletion is automated. Agents may be shared—do not delete resources used by other businesses.</p>
    {query.isLoading ? <p className="mt-4">Loading pending releases…</p> : query.isError ? <div role="alert" className="mt-4">
      <p>Pending releases could not be loaded.</p><button onClick={() => void query.refetch()} className="mt-2 min-h-11 underline">Retry</button></div>
      : query.data?.length ? <ul className="mt-4 divide-y divide-border">{query.data.map(r => <li key={r.id} className="py-4">
        <h3 className="font-bold">{r.businessName}</h3><p className="mt-1 text-sm text-muted-foreground">Archived business: {r.businessId ?? 'Unlinked purchase'} · Recorded {new Date(r.createdAt).toLocaleString()}</p>
        <p className="mt-2 break-all text-sm">Phone: {r.phoneNumber ?? 'Not recorded—review Retell resources before clearing'}</p>
        <p className="mt-1 break-all text-sm">Agent: {r.agentId ?? 'Not recorded'} · State: {r.provisioningStatus ?? 'Unknown'}</p>
        <button disabled={complete.isPending} onClick={() => void mark(r.id)} className="mt-3 min-h-11 rounded-xl border border-border bg-background px-4 text-sm font-semibold disabled:opacity-50">Mark manually released</button>
      </li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">No pending releases.</p>}
    {error ? <p role="alert" className="mt-3">{error}</p> : null}
  </section>;
}

import { RefreshCw } from 'lucide-react';
import { getGetAdminCallQualityQueryKey, useGetAdminCallQuality, type CallQualityRow } from '@workspace/api-client-react';

import { formatAdminDate, formatAdminDuration } from './AdminShared';

function Captured({ label, value, id }: { label: string; value: boolean | null; id: string }) {
  const text = value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
  const style = value === true ? 'text-foreground font-semibold' : value === false ? 'text-destructive font-semibold' : 'text-muted-foreground italic';
  return <span className="text-xs" data-testid={`text-call-quality-${id}-${label.toLowerCase()}`}><span className="text-muted-foreground">{label}: </span><span className={style}>{text}</span></span>;
}

function CallRow({ call }: { call: CallQualityRow }) {
  return <li className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5" data-testid={`row-call-quality-${call.id}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong className="text-sm text-foreground">{call.businessName}</strong>
      <span className="text-xs text-muted-foreground">{formatAdminDate(call.startedAt)} · {formatAdminDuration(call.durationMs)}</span>
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <Captured id={call.id} label="Name" value={call.nameCaptured} />
      <Captured id={call.id} label="Callback" value={call.callbackCaptured} />
      <Captured id={call.id} label="Issue" value={call.issueCaptured} />
      <Captured id={call.id} label="Address" value={call.addressCaptured} />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      Ending: <span className="text-foreground">{call.ending || 'Not recorded'}</span> · Lead: <span className="text-foreground">{call.leadCreated ? 'Created' : 'Not created'}</span>
      {!call.analysisComplete ? ' · Awaiting analysis' : ''}
    </p>
    {call.needsReview ? <p className="mt-2 text-xs font-semibold text-destructive" data-testid={`text-call-quality-review-${call.id}`}>Needs review{call.reviewReasons.length ? `: ${call.reviewReasons.join('; ')}` : ''}</p> : null}
  </li>;
}

export default function AdminCallQuality() {
  const { data, isLoading, isError, refetch, isFetching } = useGetAdminCallQuality({ query: { queryKey: getGetAdminCallQualityQueryKey(), staleTime: 10000, refetchInterval: 30000 } });
  return <section className="mt-8 rounded-2xl bg-background p-4" data-testid="section-call-quality" aria-label="Call quality">
    <p className="admin-label">Call quality</p>
    <h2 className="mt-1 text-lg font-800 tracking-[-0.035em] text-foreground">Information captured per call</h2>
    <div className="mt-4 rounded-2xl border border-border bg-card text-card-foreground">
      {isLoading ? <div className="space-y-3 p-5" data-testid="state-call-quality-loading">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>
        : isError || !data ? <div className="p-6 text-center" data-testid="state-call-quality-error">
          <p className="text-sm text-muted-foreground">Call quality could not load. Nothing has been substituted.</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} data-testid="button-call-quality-retry" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-bold text-foreground hover:bg-muted"><RefreshCw size={15} /> Try again</button>
        </div> : <>
          <div className="border-b border-border p-4 sm:p-5" data-testid="text-call-quality-summary">
            <p className="text-3xl font-800 tracking-[-0.05em] text-foreground">{data.completePercent == null ? 'Not available' : `${data.completePercent}%`}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Complete means name, callback, issue and address were all captured. Based on the latest 100 recorded inbound calls ({data.completeCalls} of {data.totalCalls} complete). Unknown fields are never assumed captured; pending and historical calls remain in the total.</p>
          </div>
          {data.calls.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground" data-testid="state-call-quality-empty">No recorded inbound calls yet.</p>
            : <ul>{data.calls.map((call) => <CallRow key={call.id} call={call} />)}</ul>}
        </>}
    </div>
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bell } from 'lucide-react';
import { useGetLeadAlertInbox, useReadLeadAlerts, getGetLeadAlertInboxQueryKey, getGetLeadsQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export function LeadAlertBell() {
  const [open, setOpen] = useState(false);
  const { data, isError } = useGetLeadAlertInbox({ query: {
    queryKey: getGetLeadAlertInboxQueryKey(),
    refetchInterval: () => document.visibilityState === 'visible' ? 2000 : false,
    refetchOnWindowFocus: true, staleTime: 0,
  } });
  const read = useReadLeadAlerts();
  const client = useQueryClient();
  const { toast } = useToast();
  const latest = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    const id = data.alerts[0]?.id ?? 0;
    if (latest.current !== null && id > latest.current) {
      const alert = data.alerts[0];
      toast({ title: alert.title, description: alert.body });
      void client.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
    }
    latest.current = Math.max(latest.current ?? 0, id);
  }, [data, client, toast]);
  const markRead = async () => {
    const id = data?.alerts[0]?.id;
    if (!id) return;
    try {
      await read.mutateAsync({ data: { throughId: id } });
      void client.invalidateQueries({ queryKey: getGetLeadAlertInboxQueryKey() });
    } catch { toast({ title: 'Alerts could not be marked read', variant: 'destructive' }); }
  };
  return <div className="relative">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Lead alerts, ${data?.unreadCount ?? 0} unread`} className="relative grid min-h-12 min-w-12 place-items-center rounded-xl border border-border" data-testid="lead-alert-bell">
      <Bell size={19} />{data?.unreadCount ? <span className="absolute right-0 top-0 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" data-testid="lead-alert-count">{data.unreadCount}</span> : null}
    </button>
    {open ? <section aria-label="Unread lead alerts" className="absolute right-0 top-14 z-30 max-h-[65vh] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-xl">
      <h2 className="font-bold">New lead alerts</h2>
      {isError ? <p role="alert" className="mt-3 text-sm">Alerts couldn't load. Try again shortly.</p> : !data ? <p className="mt-3 text-sm">Loading alerts…</p> : !data.enabled ? <p className="mt-3 text-sm text-muted-foreground">Alerts are off. Enable them in Settings.</p> : !data.alerts.length ? <p className="mt-3 text-sm text-muted-foreground">No unread alerts.</p> : <>
        <button type="button" disabled={read.isPending} onClick={() => void markRead()} className="mt-2 min-h-12 text-sm font-semibold text-primary" data-testid="alerts-mark-read">Mark all read</button>
        {data.alerts.map(alert => <Link key={alert.id} href={alert.deepLink} onClick={() => setOpen(false)} className="mt-2 block rounded-xl border border-border p-3"><p className="text-sm font-semibold">{alert.title}</p><p className="mt-1 break-words text-xs text-muted-foreground">{alert.body}</p></Link>)}
      </>}
    </section> : null}
  </div>;
}
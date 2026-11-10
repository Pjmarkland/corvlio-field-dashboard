import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { getGetLeadDetailQueryKey, useGetLeadDetail, useUpdateLeadNotes, type LeadDetail } from '@workspace/api-client-react';
import { ArrowLeft, CalendarClock, Check, Clock3, Copy, MapPin, Phone } from 'lucide-react';
import { LeadContactActions } from '@/components/LeadContactActions';
import { LeadNotesLog } from '@/components/LeadNotesLog';
import { displayIssue, displayName, displayPhone, nameInitials, usablePhone } from '@/lib/leadDisplay';

const MAX_NOTES = 10000;
type Status = 'pending' | 'contacted';

export function formatCallTime(value?: string | null, now = new Date()) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (same(d, now)) return `Today ${time}`;
  if (same(d, yesterday)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

function formatDuration(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function safeRecordingUrl(url?: string | null) {
  const raw = url?.trim();
  if (!raw) return null;
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? raw : null; } catch { return null; }
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return <section className="mt-4 rounded-2xl border border-border bg-card p-4" data-testid={testId}><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{title}</p><div className="mt-2">{children}</div></section>;
}
const Plain = ({ text, testId }: { text: string; testId?: string }) => <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-testid={testId}>{text}</p>;

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch { /* fall through to legacy copy */ }
  const el = document.createElement('textarea');
  el.value = value;
  el.readOnly = true;
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  try {
    el.select();
    el.setSelectionRange(0, value.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch { return false; } finally { document.body.removeChild(el); }
}

function CopyNumber({ value }: { value: string }) {
  const [msg, setMsg] = useState('');
  const copy = async () => { setMsg((await copyText(value)) ? 'Copied' : 'Copy failed'); };
  return <span className="inline-flex items-center gap-2"><button type="button" onClick={() => void copy()} data-testid="button-copy-number" aria-label={`Copy ${value}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-semibold"><Copy size={14} />{value}</button><span role="status" className="text-xs text-muted-foreground">{msg}</span></span>;
}

function Recording({ url }: { url: string }) {
  return <RecordingPlayer key={url} url={url} />;
}
function RecordingPlayer({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return <Section title="Recording" testId="section-recording">{failed ? <p role="alert" className="text-sm">The recording could not be loaded. It may have expired.</p> : <audio controls preload="none" src={url} onError={() => setFailed(true)} className="w-full" data-testid="audio-recording" />}</Section>;
}

function Notes({ lead, queryKey }: { lead: LeadDetail; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const save = useUpdateLeadNotes();
  const [draft, setDraft] = useState(lead.privateNotes ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSaved = useRef(lead.privateNotes ?? '');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mutate = useRef(save.mutate);
  mutate.current = save.mutate;
  const leadId = lead.id;
  useEffect(() => { // adopt server notes only when the user has no unsaved edits
    const server = lead.privateNotes ?? '';
    if (draftRef.current === lastSaved.current && server !== lastSaved.current) { lastSaved.current = server; setDraft(server); }
  }, [lead.privateNotes]);
  const dirty = draft !== lastSaved.current;
  const submit = () => {
    const sent = draft;
    setState('saving');
    mutate.current({ leadId, data: { privateNotes: sent } }, {
      onSuccess: (res) => {
        const saved = (res as Partial<LeadDetail> | undefined)?.privateNotes;
        const server = typeof saved === 'string' ? saved : saved === null ? '' : (sent.trim() ? sent : '');
        lastSaved.current = server;
        qc.setQueryData<LeadDetail>(queryKey, (old) => old ? { ...old, privateNotes: server === '' ? null : server } : old);
        if (draftRef.current === sent) { setDraft(server); draftRef.current = server; setState('saved'); } else setState('idle');
      },
      onError: () => setState('error'),
    });
  };
  return <Section title="Private notes" testId="section-notes">
    <label htmlFor="lead-notes" className="sr-only">Private notes</label>
    <textarea id="lead-notes" data-testid="input-notes" value={draft} maxLength={MAX_NOTES} rows={5} onChange={(e) => { setDraft(e.target.value); if (state !== 'saving') setState('idle'); }} placeholder="Only you can see these notes." className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground" role="status" data-testid="text-notes-state">{state === 'saving' ? 'Saving…' : state === 'error' ? 'Notes were not saved. Try again.' : state === 'saved' && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : `${draft.length}/${MAX_NOTES}`}</span>
      <button type="button" onClick={submit} disabled={!dirty || state === 'saving'} data-testid="button-save-notes" className="min-h-10 rounded-xl border border-border px-4 text-sm font-bold text-primary disabled:opacity-55">Save notes</button>
    </div>
  </Section>;
}

export function LeadDetailView({ leadId, onStatus, savingLeadId }: { leadId: string; onStatus: (id: string, s: Status) => void; savingLeadId: string | null }) {
  const { user, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const scopedKey = [...getGetLeadDetailQueryKey(leadId), user?.id ?? ''] as const;
  const { data, isLoading, isError, error, refetch } = useGetLeadDetail(leadId, { query: {
    queryKey: scopedKey as unknown as ReturnType<typeof getGetLeadDetailQueryKey>,
    enabled: !!leadId && isLoaded && !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: () => document.visibilityState === 'visible' ? 30_000 : false,
    retry: (n, e) => (e as { status?: number })?.status !== 404 && n < 2,
  } });
  const from = typeof window !== 'undefined' ? (window.history.state as { from?: string } | null)?.from : undefined;
  const backHref = from === '/completed' ? '/completed' : '/dashboard';
  const back = <Link href={backHref} className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-leads"><ArrowLeft size={16} /> {backHref === '/completed' ? 'Back to completed' : 'Back to leads'}</Link>;

  if (isLoading || (!data && !isError)) return <div className="animate-pulse" data-testid="detail-loading">{back}<div className="h-16 w-2/3 rounded-2xl bg-muted" /><div className="mt-4 h-40 rounded-2xl bg-muted" /></div>;
  if (isError || !data) {
    const notFound = (error as { status?: number } | null)?.status === 404;
    return <div>{back}<div className="rounded-2xl border border-border bg-card p-6 text-center" role="alert" data-testid={notFound ? 'detail-not-found' : 'detail-error'}><h1 className="text-xl font-800">{notFound ? 'Lead not found' : 'Could not load this lead'}</h1><p className="mt-2 text-sm text-muted-foreground">{notFound ? 'It may have been removed or belongs to another account.' : 'Check your connection and try again.'}</p>{notFound ? null : <button type="button" onClick={() => void refetch()} data-testid="button-retry-detail" className="mt-4 min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">Try again</button>}</div></div>;
  }

  const lead = data;
  const dial = usablePhone(lead.callbackNumber?.trim() || lead.phone);
  const shownPhone = displayPhone(lead.callbackNumber?.trim() || lead.phone);
  const callTime = formatCallTime(lead.callStartedAt) ?? formatCallTime(lead.createdAt);
  const duration = formatDuration(lead.durationMs);
  const contacted = lead.status === 'contacted';
  const saving = savingLeadId === lead.id;
  const urgency = lead.capturedUrgency?.trim();
  const address = lead.address?.trim();
  const recording = safeRecordingUrl(lead.recordingUrl);
  const arrival = formatCallTime(lead.createdAt);
  const contactedAt = contacted ? formatCallTime(lead.contactedAt) : null;
  const byYou = !!user && !!lead.contactedBy && lead.contactedBy === user.id;
  const actor = lead.contactedBy?.trim();
  const first = displayName(lead.name).split(' ')[0];
  const intake = lead.tradeIntakeAnswers?.trim();
  const summary = lead.summary?.trim();
  const transcript = lead.transcript?.trim();
  const availability = lead.availability?.trim();

  return <div className="animate-rise-in" data-testid="lead-detail">
    {back}
    <div className="mb-6 flex items-start gap-4">
      <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-[20px] text-lg font-800 ${lead.urgency === 'urgent' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>{nameInitials(lead.name)}</div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {urgency ? <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#c84b29]" data-testid="badge-urgency">{urgency}</span> : null}
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${contacted ? 'text-[#398660]' : 'text-muted-foreground'}`} data-testid="text-detail-status"><span className={`h-1.5 w-1.5 rounded-full ${contacted ? 'bg-[#49a979]' : 'bg-[#c4bcae]'}`} />{contacted ? 'Contacted' : 'Needs response'}</span>
        </div>
        <h1 className="break-words text-[32px] font-800 leading-none tracking-[-0.055em]" data-testid="text-detail-name">{displayName(lead.name)}</h1>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="text-call-time">{[callTime, duration].filter(Boolean).join(' · ') || 'Receptionist lead'}</p>
      </div>
    </div>
    <div className="mb-4 rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6"><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.17em] text-primary">What they need</p><p className="break-words text-xl font-semibold leading-snug tracking-[-0.02em]" data-testid="text-detail-issue">{displayIssue(lead.issue)}</p></div>
    <div className="grid grid-cols-2 gap-3"><LeadContactActions leadId={lead.id} phone={dial ? (lead.callbackNumber?.trim() || lead.phone) : null} prefix="detail-" large callLabel={`Call ${first}`} textLabel="Send text" /></div>
    <div className="mt-4 space-y-1 rounded-2xl border border-border bg-card p-3">
      <div className="flex min-h-12 items-center gap-3 px-1"><Phone size={16} className="text-muted-foreground" />{dial ? <CopyNumber value={shownPhone} /> : <span className="text-sm font-semibold" data-testid="text-no-phone">{shownPhone}</span>}</div>
      {address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer" data-testid="link-address-map" className="flex min-h-12 items-start gap-3 px-1 py-2 text-sm font-semibold"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" /><span className="break-words">{address}</span></a> : null}
      {availability ? <div className="flex min-h-12 items-start gap-3 px-1 py-2 text-sm"><CalendarClock size={16} className="mt-0.5 shrink-0 text-muted-foreground" /><span className="whitespace-pre-wrap break-words" data-testid="text-availability">{availability}</span></div> : null}
    </div>
    {summary ? <Section title="Issue summary" testId="section-issue-summary"><Plain text={summary} testId="text-summary" /></Section> : null}
    {intake ? <Section title="Trade intake" testId="section-intake"><Plain text={intake} testId="text-intake" /></Section> : null}
    {recording ? <Recording url={recording} /> : null}
    {transcript ? <Section title="Transcript" testId="section-transcript"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="button-toggle-transcript" className="min-h-10 text-sm font-semibold text-primary">{open ? 'Collapse transcript' : 'Expand transcript'}</button>{open ? <div className="mt-2"><Plain text={transcript} testId="text-transcript" /></div> : null}</Section> : null}
    <Section title="Activity" testId="section-activity"><ul className="space-y-2 text-sm">
      {arrival ? <li className="flex items-center gap-2"><Clock3 size={14} className="text-muted-foreground" />Call arrived {arrival}</li> : null}
      {contactedAt ? <li className="flex items-center gap-2" data-testid="activity-contacted"><Check size={14} className="text-[#49a979]" />Contacted {contactedAt}{byYou ? ` by You${user?.fullName ? ` (${user.fullName})` : ''}` : actor ? ` by account ${actor}` : ''}</li> : null}
    </ul></Section>
    <LeadNotesLog key={lead.id} leadId={lead.id} />
    <Notes key={`${user?.id}:${lead.id}`} lead={lead} queryKey={scopedKey} />
    <div className="detail-action-spacer" />
    <div className="detail-action-bar border-t border-border bg-card/95 px-4 py-3 backdrop-blur-md" data-testid="bar-detail-actions"><div className="mx-auto max-w-[1160px]">
      {!contacted ? <button type="button" disabled={saving} onClick={() => onStatus(lead.id, 'contacted')} data-testid={`button-mark-contacted-${lead.id}`} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-55"><Check size={16} /> {saving ? 'Saving…' : 'Mark contacted'}</button>
        : <button type="button" disabled={saving} onClick={() => onStatus(lead.id, 'pending')} data-testid={`button-reopen-${lead.id}`} className="min-h-12 w-full rounded-xl border border-border text-sm font-bold text-foreground disabled:cursor-wait disabled:opacity-55">{saving ? 'Saving…' : 'Reopen lead'}</button>}
    </div></div>
  </div>;
}

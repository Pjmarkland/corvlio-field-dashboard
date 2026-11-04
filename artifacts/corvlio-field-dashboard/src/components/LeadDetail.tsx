import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { getGetBillingAvailabilityQueryKey, getGetLeadDetailQueryKey, getGetLeadsQueryKey, useFlagLeadInformation, useGetBillingAvailability, useGetLeadDetail, useSetLeadSpamStatus, useUpdateLeadNotes, type LeadDetail } from '@workspace/api-client-react';
import { ArrowLeft, Check, ChevronDown, Copy, MapPin, ShieldAlert } from 'lucide-react';
import { LeadContactActions } from '@/components/LeadContactActions';
import { displayPhone, usablePhone } from '@/lib/leadDisplay';

const MAX_NOTES = 500;
type Status = 'pending' | 'contacted' | 'new' | 'called_back' | 'booked' | 'closed';
type OwnerCallStatus = 'new' | 'called_back' | 'booked' | 'closed';

function normalizeOwnerStatus(value: string): OwnerCallStatus {
  if (value === 'booked' || value === 'closed') return value;
  if (value === 'called_back' || value === 'contacted') return 'called_back';
  return 'new';
}

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

export function formatDateTime(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5';

function Section({ title, children, testId, className = '' }: { title: string; children: ReactNode; testId?: string; className?: string }) {
  return <section className={`${cardClass} ${className}`} data-testid={testId}>
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{title}</p>
    <div className="mt-3 text-gray-900">{children}</div>
  </section>;
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
  return <span className="inline-flex min-h-11 items-center gap-2">
    <span className="text-sm font-medium text-gray-700" data-testid="text-caller-phone">{value}</span>
    <button type="button" onClick={() => void copy()} data-testid="button-copy-number" aria-label={`Copy ${value}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50" title="Copy phone number"><Copy size={16} /></button>
    <span role="status" className="text-xs text-gray-500">{msg}</span>
  </span>;
}

function RecordingPlayer({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <p role="alert" className="text-sm text-gray-600" data-testid="text-recording-error">The recording could not be loaded. It may have expired.</p>
    : <audio controls preload="none" src={url} onError={() => setFailed(true)} className="min-h-11 w-full" data-testid="audio-recording" aria-label="Call recording" />;
}

type TranscriptSpeaker = 'ai' | 'caller' | 'unknown';
type TranscriptMessage = { speaker: TranscriptSpeaker; text: string };

export function parseTranscriptMessages(value: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^\s*(agent|assistant|ai|user|caller|customer)\s*:\s*(.*)$/i);
    if (match) {
      const speaker = /^(agent|assistant|ai)$/i.test(match[1]) ? 'ai' : 'caller';
      messages.push({ speaker, text: match[2] });
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    const previous = messages.at(-1);
    if (previous) previous.text += `${previous.text ? '\n' : ''}${text}`;
    else messages.push({ speaker: 'unknown', text });
  }
  return messages.filter((message) => message.text.trim().length > 0);
}

function TranscriptMessages({ transcript }: { transcript: string }) {
  const messages = parseTranscriptMessages(transcript);
  return <div className="space-y-3" data-testid="transcript-messages" aria-label="Call transcript">
    {messages.map((message, index) => {
      const isCaller = message.speaker === 'caller';
      const isUnknown = message.speaker === 'unknown';
      return <div key={`${message.speaker}-${index}`} className={`flex ${isCaller ? 'justify-end' : 'justify-start'}`} data-testid={`transcript-message-${index}`}>
        <div className={`max-w-[88%] rounded-2xl px-3.5 py-3 ${isCaller ? 'rounded-br-md bg-blue-600 text-white' : isUnknown ? 'bg-gray-100 text-gray-800' : 'rounded-bl-md bg-blue-50 text-gray-900'}`}>
          <p className={`mb-1 text-[11px] font-semibold ${isCaller ? 'text-blue-100' : 'text-gray-500'}`}>{isCaller ? 'Caller' : isUnknown ? 'Transcript' : 'AI'}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
        </div>
      </div>;
    })}
  </div>;
}

function Notes({ lead, queryKey }: { lead: LeadDetail; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const save = useUpdateLeadNotes();
  const [draft, setDraft] = useState(lead.privateNotes ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSaved = useRef(lead.privateNotes ?? '');
  const draftRef = useRef(draft);
  const savingRef = useRef(false);
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
    if (savingRef.current || draftRef.current === lastSaved.current) return;
    savingRef.current = true;
    const sent = draft;
    setState('saving');
    mutate.current({ leadId, data: { privateNotes: sent } }, {
      onSuccess: (res) => {
        savingRef.current = false;
        const saved = (res as Partial<LeadDetail> | undefined)?.privateNotes;
        const server = typeof saved === 'string' ? saved : saved === null ? '' : (sent.trim() ? sent : '');
        lastSaved.current = server;
        qc.setQueryData<LeadDetail>(queryKey, (old) => old ? { ...old, privateNotes: server === '' ? null : server } : old);
        if (draftRef.current === sent) { setDraft(server); draftRef.current = server; setState('saved'); } else setState('idle');
      },
      onError: () => { savingRef.current = false; setState('error'); },
    });
  };
  return <Section title="Private notes" testId="section-notes">
    <label htmlFor="lead-notes" className="sr-only">Private notes</label>
      <textarea id="lead-notes" data-testid="input-notes" value={draft} maxLength={MAX_NOTES} rows={5} onBlur={() => { if (draftRef.current !== lastSaved.current) submit(); }} onChange={(e) => { setDraft(e.target.value); if (state !== 'saving') setState('idle'); }} placeholder="Only you can see these notes." className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400" />
    <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500" role="status" data-testid="text-notes-state">{state === 'saving' ? 'Saving…' : state === 'error' ? 'Notes were not saved. Try again.' : state === 'saved' && !dirty ? 'Saved' : `${draft.length}/${MAX_NOTES}${dirty ? ' · Unsaved changes' : ''}`}</span>
       <button type="button" onClick={submit} disabled={!dirty || state === 'saving'} data-testid="button-save-notes" className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-blue-700 disabled:opacity-55">Save notes</button>
    </div>
  </Section>;
}

export function LeadDetailView({ leadId, onStatus, savingLeadId }: { leadId: string; onStatus: (id: string, s: Status) => void; savingLeadId: string | null }) {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const flagMutation = useFlagLeadInformation();
  const spamMutation = useSetLeadSpamStatus();
  const { data: billingAvailability } = useGetBillingAvailability({ query: {
    queryKey: getGetBillingAvailabilityQueryKey(),
    enabled: isLoaded && !!user,
    retry: false,
    staleTime: 60_000,
  } });
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagMessage, setFlagMessage] = useState('');
  const [spamMessage, setSpamMessage] = useState('');
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
  const backHref = from === '/completed' ? '/completed' : from === '/spam' ? '/spam' : '/dashboard';
  const backLabel = backHref === '/completed' ? 'Back to completed' : backHref === '/spam' ? 'Back to spam' : 'Back to leads';
  const pageClass = '-mx-4 -my-6 min-h-[calc(100dvh-9rem)] bg-gray-100 px-4 pb-24 pt-5 text-gray-900 sm:-mx-8 sm:px-8 md:-mx-10 md:-my-10 md:min-h-[calc(100dvh-4rem)] md:px-10 md:pb-8 md:pt-8';
  const pageContainerClass = 'mx-auto max-w-2xl';
  const back = <div className="mb-4 flex items-center gap-3">
    <Link href={backHref} aria-label={backLabel} title={backLabel} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50" data-testid="link-back-leads"><ArrowLeft size={19} /></Link>
    <h1 className="text-xl font-bold tracking-tight text-gray-900" data-testid="text-call-details-title">Call details</h1>
  </div>;

  if (isLoading || (!data && !isError)) return <div className={pageClass} data-testid="lead-detail"><div className={pageContainerClass}>{back}<div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5"><div className="h-7 w-2/3 rounded-lg bg-gray-100" /><div className="mt-5 h-24 rounded-xl bg-gray-100" /></div></div></div>;
  if (isError || !data) {
    const notFound = (error as { status?: number } | null)?.status === 404;
    return <div className={pageClass}><div className={pageContainerClass}>{back}<div className={`${cardClass} text-center`} role="alert" data-testid={notFound ? 'detail-not-found' : 'detail-error'}><h2 className="text-xl font-bold text-gray-900">{notFound ? 'Lead not found' : 'Could not load this lead'}</h2><p className="mt-2 text-sm text-gray-600">{notFound ? 'It may have been removed or belongs to another account.' : 'Check your connection and try again.'}</p>{notFound ? null : <button type="button" onClick={() => void refetch()} data-testid="button-retry-detail" className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white">Try again</button>}</div></div></div>;
  }

  const lead = data;
  const phoneRaw = lead.callbackNumber?.trim() || lead.phone?.trim() || lead.callerId?.trim() || '';
  const dial = usablePhone(phoneRaw);
  const shownPhone = phoneRaw ? displayPhone(phoneRaw) : null;
  const callTime = formatDateTime(lead.callStartedAt ?? lead.createdAt);
  const duration = formatDuration(lead.durationMs);
  const status = normalizeOwnerStatus(lead.status);
  const contacted = status !== 'new';
  const saving = savingLeadId === lead.id;
  const address = lead.address?.trim();
  const recording = safeRecordingUrl(lead.recordingUrl);
  const contactedAt = contacted ? formatCallTime(lead.contactedAt) : null;
  const byYou = !!user && !!lead.contactedBy && lead.contactedBy === user.id;
  const actor = lead.contactedBy?.trim();
  const intake = lead.tradeIntakeAnswers?.trim();
  const summary = lead.summary?.trim();
  const issue = lead.issue?.trim();
  const distinctSummary = summary && (!issue || summary.replace(/\s+/g, ' ').toLowerCase() !== issue.replace(/\s+/g, ' ').toLowerCase())
    ? summary : null;
  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const distinctIntake = intake && ![issue, summary].some((value) => value && normalizeText(value) === normalizeText(intake))
    ? intake : null;
  const transcript = lead.transcript?.trim();
  const availability = lead.availability?.trim();
  const sentiment = lead.sentiment?.trim();
  const urgencyLabel = lead.capturedUrgency?.trim()
    ? lead.urgency === 'urgent' ? 'Urgent' : lead.urgency === 'low' ? 'Low' : 'Normal'
    : null;
  const smsAvailable = billingAvailability?.smsAvailable === true;
  const submitFlag = () => {
    setFlagMessage('');
    flagMutation.mutate({ leadId: lead.id, data: flagReason.trim() ? { reason: flagReason.trim() } : {} }, {
      onSuccess: () => { setShowFlagForm(false); setFlagReason(''); setFlagMessage('Thanks. This lead was sent for review.'); },
      onError: () => setFlagMessage('The report could not be sent. Try again.'),
    });
  };
  const updateStatus = (nextStatus: OwnerCallStatus) => {
    if (nextStatus === status) return;
    onStatus(lead.id, nextStatus);
  };
  const toggleSpam = () => {
    const nextIsSpam = !lead.isSpam;
    setSpamMessage('');
    spamMutation.mutate({ leadId: lead.id, data: { isSpam: nextIsSpam } }, {
      onSuccess: () => {
        queryClient.setQueryData<LeadDetail>(scopedKey, (old) => old ? { ...old, isSpam: nextIsSpam } : old);
        void queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
        setSpamMessage(nextIsSpam
          ? 'Hidden from leads. Future alerts for this caller are suppressed; calls are not blocked. You can undo this here.'
          : 'Lead restored to your leads.');
      },
      onError: () => setSpamMessage('Spam status could not be changed. Try again.'),
    });
  };

  const received = callTime;
  const name = lead.name.trim();
  const hasCallerCard = !!(name || phoneRaw || urgencyLabel);
  const hasNeedsCard = !!(issue || address || availability || received || duration || distinctIntake || sentiment);
  const hasMetadata = !!(address || availability || received || duration || distinctIntake || sentiment);
  const statusLabel = status === 'called_back' ? 'Called back' : status === 'booked' ? 'Booked' : status === 'closed' ? 'Closed' : 'New';

  return <div className={pageClass} data-testid="lead-detail">
    <div className={`${pageContainerClass} animate-rise-in`}>
      {back}
      <div className="space-y-3.5">
        {hasCallerCard ? <section className={cardClass} aria-label="Caller details" data-testid="section-caller">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {name ? <h2 className="break-words text-2xl font-bold leading-tight tracking-tight text-gray-900 sm:text-[28px]" data-testid="text-detail-name">{name}</h2> : null}
              {phoneRaw ? <div className="mt-1"><CopyNumber value={shownPhone || phoneRaw} /></div> : null}
            </div>
            {urgencyLabel ? <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${lead.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`} data-testid="badge-urgency">{urgencyLabel}</span> : null}
          </div>
          {dial ? <div className="mt-4">
            <LeadContactActions leadId={lead.id} phone={phoneRaw} prefix="detail-" large sideBySide callLabel="Call back" textLabel="Text" showText={smsAvailable} />
          </div> : null}
        </section> : null}

        {hasNeedsCard ? <section className={cardClass} aria-label="What they need" data-testid="section-issue">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">What they need</p>
          {issue ? <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed text-gray-800" data-testid="text-detail-issue">{issue}</p> : null}
          {hasMetadata ? <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-gray-100 pt-4">
            {address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer" data-testid="link-address-map" className="min-h-11 min-w-0 rounded-lg py-1 text-left hover:underline">
              <span className="block text-xs font-medium text-gray-500">Address</span><span className="mt-1 block break-words text-sm font-medium text-blue-700"><MapPin size={13} className="mr-1 inline" />{address}</span>
            </a> : null}
            {availability ? <div className="min-h-11 min-w-0 py-1" data-testid="field-availability"><span className="block text-xs font-medium text-gray-500">Available</span><span className="mt-1 block whitespace-pre-wrap break-words text-sm font-medium text-gray-800" data-testid="text-availability">{availability}</span></div> : null}
            {received ? <div className="min-h-11 min-w-0 py-1" data-testid="field-call-time"><span className="block text-xs font-medium text-gray-500">Received</span><span className="mt-1 block text-sm font-medium text-gray-800" data-testid="text-call-time">{received}</span></div> : null}
            {duration ? <div className="min-h-11 min-w-0 py-1" data-testid="field-call-length"><span className="block text-xs font-medium text-gray-500">Call length</span><span className="mt-1 block text-sm font-medium text-gray-800" data-testid="text-call-length">{duration}</span></div> : null}
            {sentiment ? <div className="min-h-11 min-w-0 py-1" data-testid="field-sentiment"><span className="block text-xs font-medium text-gray-500">Sentiment</span><span className="mt-1 block text-sm font-medium text-gray-800" data-testid="text-sentiment">{sentiment}</span></div> : null}
            {distinctIntake ? <div className="col-span-2 min-w-0 py-1" data-testid="field-intake"><span className="block text-xs font-medium text-gray-500">Intake details</span><span className="mt-1 block whitespace-pre-wrap break-words text-sm text-gray-800" data-testid="text-intake">{distinctIntake}</span></div> : null}
          </div> : null}
        </section> : null}

        {distinctSummary ? <Section title="AI summary" testId="section-issue-summary"><Plain text={distinctSummary} testId="text-summary" /></Section> : null}

        <Section title="Call status" testId="section-call-status">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${status === 'called_back' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}`} data-testid="text-detail-status">{statusLabel}</span>
            <button type="button" onClick={() => updateStatus('called_back')} disabled={saving || status === 'called_back'} data-testid={`button-mark-contacted-${lead.id}`} className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-55">{saving ? 'Saving…' : 'Mark called back'}</button>
          </div>
          <label htmlFor="lead-call-status" className="mt-3 block text-xs font-medium text-gray-500">Change status</label>
          <select id="lead-call-status" value={status} onChange={(event) => updateStatus(event.target.value as OwnerCallStatus)} disabled={saving} data-testid="select-call-status" className="mt-1 w-full min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 disabled:opacity-60">
            <option value="new">New</option>
            <option value="called_back">Called back</option>
            <option value="booked">Booked</option>
            <option value="closed">Closed</option>
          </select>
          {saving ? <p className="mt-2 text-xs text-gray-500" role="status">Saving status…</p> : null}
          {contactedAt ? <p className="mt-3 flex items-center gap-2 text-xs text-gray-500" data-testid="activity-contacted"><Check size={14} className="shrink-0 text-green-600" />Owner follow-up recorded {contactedAt}{byYou ? ` by you${user?.fullName ? ` (${user.fullName})` : ''}` : actor ? ` by account ${actor}` : ''}</p> : null}
        </Section>

        {transcript || recording ? <section className={cardClass} data-testid="section-transcript">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="button-toggle-transcript" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900">
            <span>Full transcript</span><ChevronDown size={18} className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open ? <div className="mt-3 space-y-4 border-t border-gray-100 pt-4">
            {transcript ? <TranscriptMessages transcript={transcript} /> : null}
            {recording ? <div className="border-t border-gray-100 pt-4" data-testid="section-recording"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Recording</p><RecordingPlayer key={recording} url={recording} /></div> : null}
          </div> : null}
        </section> : null}

        <Notes key={`${user?.id}:${lead.id}`} lead={lead} queryKey={scopedKey} />

        <Section title="Lead information" testId="section-lead-information">
          <p className="text-sm leading-relaxed text-gray-600">If a detail looks inaccurate, report it for review. Your reason is optional.</p>
          {!showFlagForm ? <button type="button" onClick={() => setShowFlagForm(true)} data-testid="button-flag-lead" className="mt-3 min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">Report inaccurate information</button>
            : <div className="mt-3 space-y-2"><label htmlFor="lead-flag-reason" className="block text-xs font-semibold text-gray-700">Reason (optional)</label><textarea id="lead-flag-reason" data-testid="input-flag-reason" maxLength={500} rows={3} value={flagReason} onChange={(event) => setFlagReason(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900" /><div className="flex gap-2"><button type="button" onClick={submitFlag} disabled={flagMutation.isPending} data-testid="button-submit-flag" className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-55">{flagMutation.isPending ? 'Sending…' : 'Send report'}</button><button type="button" onClick={() => setShowFlagForm(false)} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">Cancel</button></div></div>}
          {flagMessage ? <p role="status" data-testid="text-flag-status" className="mt-2 text-xs text-gray-600">{flagMessage}</p> : null}
        </Section>

        <Section title="Spam controls" testId="section-spam-controls">
          <button type="button" onClick={toggleSpam} disabled={spamMutation.isPending} data-testid="button-toggle-spam" className="min-h-11 w-full rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-55">
            {spamMutation.isPending ? 'Updating…' : lead.isSpam ? 'Undo spam' : 'Mark as spam'}
          </button>
          {spamMessage ? <p role="status" data-testid="text-spam-status" className="mt-2 text-center text-xs text-gray-600">{spamMessage}</p> : null}
        </Section>
      </div>
    </div>
  </div>;
}

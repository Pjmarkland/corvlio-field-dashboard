import { useCallback, useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from '@/lib/supabaseClient';

type LeadNote = { id: number; lead_id: string; note: string; created_at: string };

const MAX_NOTE = 1000;

function formatWhen(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Follow-up log for one lead, saved to and loaded from the Supabase `lead_notes` table.
// Leads themselves stay in the main database; only the lead's id is stored here.
export function LeadNotesLog({ leadId }: { leadId: string }) {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setState('idle'); return; }
    const { data, error } = await supabase
      .from('lead_notes')
      .select('id, lead_id, note, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });
    if (error) { setMessage('Could not load follow-up notes.'); setState('error'); return; }
    setNotes((data ?? []) as LeadNote[]);
    setMessage(null);
    setState('idle');
  }, [leadId]);

  useEffect(() => { setState('loading'); void load(); }, [load]);

  const save = async () => {
    const text = draft.trim();
    if (!supabase || !text) return;
    setState('saving');
    setMessage(null);
    const { error } = await supabase.from('lead_notes').insert({ lead_id: leadId, note: text });
    if (error) { setMessage('Note was not saved. Try again.'); setState('error'); return; }
    setDraft('');
    await load();
  };

  return <section className="mt-4 rounded-2xl border border-border bg-card p-4" data-testid="section-lead-notes">
    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Follow-up notes</p>
    {!supabaseConfigured ? <p className="mt-2 text-sm text-muted-foreground" data-testid="lead-notes-unconfigured">Follow-up notes are not set up on this deployment.</p> : <>
      <label htmlFor={`lead-note-${leadId}`} className="sr-only">Add a follow-up note</label>
      <textarea id={`lead-note-${leadId}`} data-testid="input-lead-note" value={draft} maxLength={MAX_NOTE} rows={3} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Called back, booking Thursday 2pm" className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-base" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground" role="status" data-testid="text-lead-note-state">{state === 'saving' ? 'Saving…' : message ?? `${draft.length}/${MAX_NOTE}`}</span>
        <button type="button" onClick={() => void save()} disabled={!draft.trim() || state === 'saving'} data-testid="button-add-lead-note" className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-primary disabled:opacity-55">Add note</button>
      </div>
      <ul className="mt-3 space-y-2" data-testid="list-lead-notes">
        {state === 'loading' ? <li className="text-sm text-muted-foreground">Loading…</li> : notes.length === 0 ? <li className="text-sm text-muted-foreground">No follow-up notes yet.</li> : notes.map((n) => <li key={n.id} className="rounded-xl bg-background p-3 text-sm" data-testid="item-lead-note"><p className="whitespace-pre-wrap break-words">{n.note}</p><p className="mt-1 text-xs text-muted-foreground">{formatWhen(n.created_at)}</p></li>)}
      </ul>
    </>}
  </section>;
}

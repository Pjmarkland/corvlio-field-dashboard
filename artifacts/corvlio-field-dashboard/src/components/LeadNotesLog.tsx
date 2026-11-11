import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  hasSupabaseConfig,
  insertLeadFollowUpNote,
  listLeadFollowUpNotes,
  type LeadFollowUpNote,
} from '@/lib/supabaseClient';

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function LeadNotesLog({ leadId }: { leadId: string }) {
  const configured = hasSupabaseConfig();
  const [notes, setNotes] = useState<LeadFollowUpNote[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(configured);
  const [loadError, setLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!hasSupabaseConfig()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(false);
    try {
      setNotes(await listLeadFollowUpNotes(leadId));
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    setNotes([]);
    setDraft('');
    setLoadError(false);
    setSaveError(false);
    if (!configured) {
      setIsLoading(false);
      return;
    }
    void loadNotes();
  }, [configured, leadId, loadNotes]);

  const saveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note = draft.trim();
    if (!note || isLoading || isSaving || !configured) return;

    setIsSaving(true);
    setSaveError(false);
    try {
      const saved = await insertLeadFollowUpNote(leadId, note);
      setNotes((current) => [saved, ...current]);
      setDraft('');
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  };

  return <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" data-testid="section-follow-up-notes">
    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Follow-up notes</h2>
    {!configured ? <p className="mt-3 text-sm text-gray-600" role="status" data-testid="text-follow-up-notes-config">
      Notes aren&apos;t configured.
    </p> : <>
      <form className="mt-3 space-y-2" onSubmit={(event) => void saveNote(event)}>
        <label htmlFor={`follow-up-note-${leadId}`} className="sr-only">Add a follow-up note</label>
        <textarea
          id={`follow-up-note-${leadId}`}
          data-testid="input-follow-up-note"
          rows={3}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaveError(false);
          }}
          placeholder="Add a note about the next step…"
          className="min-h-24 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {isSaving ? <p className="text-xs text-gray-500" role="status" data-testid="status-follow-up-saving">Saving note…</p> : <span />}
          <button
            type="submit"
            data-testid="button-save-follow-up-note"
            disabled={!draft.trim() || isLoading || isSaving}
            className="min-h-11 w-full rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
          >
            {isSaving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </form>

      {saveError ? <p className="mt-2 text-xs text-red-700" role="alert" data-testid="error-follow-up-save">
        Couldn&apos;t save the note. Please try again.
      </p> : null}

      <div className="mt-4 border-t border-gray-100 pt-3">
        {isLoading ? <p className="text-sm text-gray-500" role="status" data-testid="status-follow-up-loading">Loading notes…</p>
          : loadError ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="error-follow-up-load">
            <p className="text-sm text-red-700">Couldn&apos;t load follow-up notes.</p>
            <button type="button" onClick={() => void loadNotes()} data-testid="button-retry-follow-up-notes" className="min-h-11 self-start rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 sm:self-auto">
              Retry
            </button>
          </div>
            : notes.length === 0 ? <p className="text-sm text-gray-500" data-testid="text-follow-up-empty">No follow-up notes yet.</p>
              : <ol className="space-y-3" data-testid="list-follow-up-notes">
                {notes.map((entry) => <li key={entry.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3" data-testid={`follow-up-note-${entry.id}`}>
                  <time dateTime={entry.created_at} className="block text-xs font-medium text-gray-500" data-testid={`time-follow-up-note-${entry.id}`}>
                    {formatCreatedAt(entry.created_at)}
                  </time>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{entry.note}</p>
                </li>)}
              </ol>}
      </div>
    </>}
  </section>;
}

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { supabase, supabaseConfigured } from '@/lib/supabaseClient';

type ClassNote = {
  id: string;
  note: string;
  created_at: string;
};

export default function SupabaseTest() {
  const [notes, setNotes] = useState<ClassNote[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function loadNotes() {
    if (!supabase) return;
    setStatus('loading');
    setError(null);
    const { data, error: readError } = await supabase
      .from('class_notes')
      .select('id, note, created_at')
      .order('created_at', { ascending: false });

    if (readError) {
      setError(readError.message);
      setStatus('error');
      return;
    }
    setNotes(data ?? []);
    setStatus('idle');
  }

  useEffect(() => {
    void loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveNote() {
    if (!supabase || !draft.trim()) return;
    setStatus('saving');
    setError(null);
    const { error: writeError } = await supabase.from('class_notes').insert({ note: draft.trim() });

    if (writeError) {
      setError(writeError.message);
      setStatus('error');
      return;
    }
    setDraft('');
    await loadNotes();
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Supabase connection test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supabaseConfigured && (
            <p className="text-sm text-red-600">
              Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Set them in your environment
              and reload.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-2">
            <Textarea
              placeholder="Write a sample note…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!supabaseConfigured || status === 'saving'}
            />
            <Button
              onClick={() => void saveNote()}
              disabled={!supabaseConfigured || !draft.trim() || status === 'saving'}
            >
              {status === 'saving' ? 'Saving…' : 'Save note'}
            </Button>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">
              Saved notes {status === 'loading' ? '(loading…)' : `(${notes.length})`}
            </h2>
            <ul className="space-y-1">
              {notes.map((n) => (
                <li key={n.id} className="text-sm text-gray-600 border-b pb-1">
                  {n.note}
                  <span className="block text-xs text-gray-400">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

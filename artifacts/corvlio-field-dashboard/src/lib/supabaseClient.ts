import { createClient } from '@supabase/supabase-js';

export type LeadFollowUpNote = {
  id: string;
  lead_id: string;
  note: string;
  created_at: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

export function hasSupabaseConfig(): boolean {
  return supabase !== null;
}

export async function listLeadFollowUpNotes(leadId: string): Promise<LeadFollowUpNote[]> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('lead_notes')
    .select('id, lead_id, note, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as LeadFollowUpNote[];
}

export async function insertLeadFollowUpNote(
  leadId: string,
  note: string,
): Promise<LeadFollowUpNote> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('lead_notes')
    .insert({ lead_id: leadId, note })
    .select('id, lead_id, note, created_at')
    .single();

  if (error) throw error;
  if (!data) throw new Error('Supabase did not return the saved note.');
  return data as LeadFollowUpNote;
}

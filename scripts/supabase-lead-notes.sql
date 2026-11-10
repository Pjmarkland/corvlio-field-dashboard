-- Lead Notes (ENT 3603 Activity #22). Run in Supabase -> SQL Editor.
-- Leads live in the main app database; this table stores only the lead's id.
create table if not exists public.lead_notes (
  id bigint generated always as identity primary key,
  lead_id text not null,
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists lead_notes_lead_id_idx on public.lead_notes (lead_id, created_at desc);

alter table public.lead_notes enable row level security;

-- Prototype policies: the app uses Clerk (not Supabase Auth) so there is no per-user
-- identity in Postgres. Anon may read/insert only; no update or delete.
-- Use demo data only. Tighten before real client data goes in (see notes in submission).
create policy "anon can read lead notes" on public.lead_notes for select to anon using (true);
create policy "anon can add lead notes" on public.lead_notes for insert to anon with check (true);

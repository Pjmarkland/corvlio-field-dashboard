-- Additive DEVELOPMENT migration only. Existing rows retain NULL values.
-- Production schema changes must go through the approved Replit Publish flow.
-- No backfill, destructive changes, or provider mutations.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS private_notes text,
  ADD COLUMN IF NOT EXISTS contacted_by text;

-- DEVELOPMENT ONLY. Additive; no backfill or changes to existing business answers.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS other_policies text;

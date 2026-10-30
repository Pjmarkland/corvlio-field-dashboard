BEGIN;
CREATE TABLE IF NOT EXISTS email_health_attempts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  actor_user_id text,
  recipient text,
  status text NOT NULL,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_health_attempts_finished_idx ON email_health_attempts(finished_at);
ALTER TABLE operational_failures ADD COLUMN IF NOT EXISTS alert_blocked boolean NOT NULL DEFAULT false;
COMMIT;

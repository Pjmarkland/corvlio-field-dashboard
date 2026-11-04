BEGIN;
CREATE TABLE IF NOT EXISTS account_deletions (
  clerk_user_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending',
  business_ids integer[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS pending_retell_releases (
  id serial PRIMARY KEY,
  source_key text NOT NULL,
  business_id integer,
  business_name text NOT NULL,
  phone_number text,
  agent_id text,
  provisioning_status text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_retell_releases_source_unique ON pending_retell_releases(source_key);
CREATE TABLE IF NOT EXISTS pending_billing_cancellations (
  id serial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  business_id integer NOT NULL,
  business_name text NOT NULL,
  subscription_id text,
  checkout_session_id text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claim_until timestamptz,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS pending_billing_cancellations_due_idx
  ON pending_billing_cancellations(status,next_attempt_at);
-- Accounting rows must outlive deleted business profiles. Remove only the FK;
-- the immutable numeric business ID and invoice snapshot remain on each invoice.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'manual_invoices'::regclass
    AND c.confrelid = 'businesses'::regclass
    AND c.contype = 'f';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE manual_invoices DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
-- Stop in-flight onboarding and text-keyed notification writers from restoring
-- data after deletion. Integer-FK lead/call/billing rows already fail without a business.
CREATE OR REPLACE FUNCTION guard_deleted_account_data() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text; business_key text;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    actor := NEW.clerk_user_id; business_key := NEW.id::text;
  ELSIF TG_TABLE_NAME IN ('notification_devices', 'provisioning_attempts') THEN
    actor := NEW.clerk_user_id; business_key := NEW.business_id::text;
  ELSE
    business_key := NEW.business_id::text;
  END IF;
  IF actor IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor, 0));
    IF EXISTS(SELECT 1 FROM account_deletions WHERE clerk_user_id = actor) THEN
      RAISE EXCEPTION 'Account deletion prevents new data' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF business_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('deleted-business:' || business_key, 0));
    IF EXISTS(SELECT 1 FROM account_deletions WHERE business_key = ANY(business_ids::text[])) THEN
      RAISE EXCEPTION 'Deleted business prevents new data' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['businesses','notification_devices','notification_events',
    'notification_seen_leads','notification_poll_state','provisioning_attempts','retell_pending_calls']
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'guard_deleted_account_' || target) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_deleted_account_data()',
        'guard_deleted_account_' || target, target);
    END IF;
  END LOOP;
END $$;
COMMIT;

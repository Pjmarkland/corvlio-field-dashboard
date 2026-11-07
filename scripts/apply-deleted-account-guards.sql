-- Protect deleted accounts from having business and account-linked notification
-- or provisioning rows recreated. This changes only one function and six triggers;
-- it does not alter tables, columns, constraints, or data. Existing matching
-- triggers are left in place; a conflicting trigger definition stops the script.
--
-- Rollback: drop these six triggers, then drop
-- public.guard_deleted_account_data(). Do this only if no other trigger depends
-- on the function.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_deleted_account_data()
RETURNS trigger
LANGUAGE plpgsql
AS $guard$
DECLARE
  actor text;
  business_key text;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    actor := NEW.clerk_user_id;
    business_key := NEW.id::text;
  ELSIF TG_TABLE_NAME IN ('notification_devices', 'provisioning_attempts') THEN
    actor := NEW.clerk_user_id;
    business_key := NEW.business_id::text;
  ELSE
    business_key := NEW.business_id::text;
  END IF;

  IF actor IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor, 0));
    IF EXISTS (
      SELECT 1
      FROM public.account_deletions AS deletion
      WHERE deletion.clerk_user_id = actor
    ) THEN
      RAISE EXCEPTION 'Account deletion prevents new data'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF business_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('deleted-business:' || business_key, 0));
    IF EXISTS (
      SELECT 1
      FROM public.account_deletions AS deletion
      WHERE business_key = ANY(deletion.business_ids::text[])
    ) THEN
      RAISE EXCEPTION 'Deleted business prevents new data'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$guard$;

DO $guards$
DECLARE
  target record;
  target_table regclass;
  expected_function oid := 'public.guard_deleted_account_data()'::regprocedure;
  existing_trigger record;
BEGIN
  IF to_regclass('public.account_deletions') IS NULL THEN
    RAISE EXCEPTION
      'Required table public.account_deletions is missing; no guards were applied';
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      ('businesses', 'guard_deleted_account_businesses'),
      ('notification_devices', 'guard_deleted_account_notification_devices'),
      ('notification_events', 'guard_deleted_account_notification_events'),
      ('notification_poll_state', 'guard_deleted_account_notification_poll_state'),
      ('notification_seen_leads', 'guard_deleted_account_notification_seen_leads'),
      ('provisioning_attempts', 'guard_deleted_account_provisioning_attempts')
    ) AS expected(table_name, trigger_name)
  LOOP
    target_table := to_regclass(format('public.%I', target.table_name));
    IF target_table IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing; no guards were applied',
        target.table_name;
    END IF;

    SELECT trigger.oid, trigger.tgfoid, trigger.tgtype, trigger.tgenabled
    INTO existing_trigger
    FROM pg_trigger AS trigger
    WHERE trigger.tgrelid = target_table
      AND trigger.tgname = target.trigger_name
      AND NOT trigger.tgisinternal;

    IF FOUND THEN
      IF existing_trigger.tgfoid <> expected_function
        OR existing_trigger.tgtype <> 23
        OR existing_trigger.tgenabled NOT IN ('O', 'A') THEN
        RAISE EXCEPTION
          'Trigger public.% conflicts with the expected enabled BEFORE INSERT OR UPDATE guard',
          target.trigger_name;
      END IF;
    ELSE
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_account_data()',
        target.trigger_name,
        target.table_name
      );
    END IF;
  END LOOP;
END;
$guards$;

COMMIT;

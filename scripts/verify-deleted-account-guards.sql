-- Read-only status of the deleted-account guard function and six triggers.
WITH expected_triggers(table_name, trigger_name) AS (
  VALUES
    ('businesses', 'guard_deleted_account_businesses'),
    ('notification_devices', 'guard_deleted_account_notification_devices'),
    ('notification_events', 'guard_deleted_account_notification_events'),
    ('notification_poll_state', 'guard_deleted_account_notification_poll_state'),
    ('notification_seen_leads', 'guard_deleted_account_notification_seen_leads'),
    ('provisioning_attempts', 'guard_deleted_account_provisioning_attempts')
),
guard_function AS (
  SELECT to_regprocedure('public.guard_deleted_account_data()')::oid AS function_oid
)
SELECT
  'function' AS object_type,
  'public.guard_deleted_account_data()' AS object_name,
  guard_function.function_oid IS NOT NULL AS present,
  guard_function.function_oid IS NOT NULL AS matches_expected,
  COALESCE(pg_get_functiondef(guard_function.function_oid), 'MISSING') AS definition
FROM guard_function

UNION ALL

SELECT
  'trigger' AS object_type,
  format('public.%I.%I', expected_triggers.table_name, expected_triggers.trigger_name) AS object_name,
  trigger.oid IS NOT NULL AS present,
  trigger.oid IS NOT NULL
    AND trigger.tgfoid = guard_function.function_oid
    AND trigger.tgtype = 23
    AND trigger.tgenabled IN ('O', 'A') AS matches_expected,
  COALESCE(pg_get_triggerdef(trigger.oid, true), 'MISSING') AS definition
FROM expected_triggers
CROSS JOIN guard_function
LEFT JOIN pg_trigger AS trigger
  ON trigger.tgrelid = to_regclass(format('public.%I', expected_triggers.table_name))
  AND trigger.tgname = expected_triggers.trigger_name
  AND NOT trigger.tgisinternal
ORDER BY object_type, object_name;

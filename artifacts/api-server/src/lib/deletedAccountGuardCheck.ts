import { pool } from "@workspace/db";

const DELETED_ACCOUNT_GUARDS_QUERY = `
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
    SELECT
      to_regprocedure('public.guard_deleted_account_data()')::oid AS function_oid,
      to_regclass('public.account_deletions') AS deletion_table
  )
  SELECT
    'public.guard_deleted_account_data()' AS object_name,
    function_oid IS NOT NULL AND deletion_table IS NOT NULL AS ready
  FROM guard_function

  UNION ALL

  SELECT
    format('public.%I.%I', expected_triggers.table_name, expected_triggers.trigger_name) AS object_name,
    trigger.oid IS NOT NULL
      AND trigger.tgfoid = guard_function.function_oid
      AND trigger.tgtype = 23
      AND trigger.tgenabled IN ('O', 'A') AS ready
  FROM expected_triggers
  CROSS JOIN guard_function
  LEFT JOIN pg_trigger AS trigger
    ON trigger.tgrelid = to_regclass(format('public.%I', expected_triggers.table_name))
    AND trigger.tgname = expected_triggers.trigger_name
    AND NOT trigger.tgisinternal
  ORDER BY object_name
`;

interface GuardCheckRow {
  object_name: string;
  ready: boolean;
}

export async function verifyDeletedAccountGuards(): Promise<void> {
  let rows: GuardCheckRow[];
  try {
    ({ rows } = await pool.query<GuardCheckRow>(DELETED_ACCOUNT_GUARDS_QUERY));
  } catch {
    throw new Error(
      "The API cannot verify the deleted-account guards in its configured database. No database changes were attempted.",
    );
  }

  const missing = rows.filter((row) => !row.ready).map((row) => row.object_name);
  if (rows.length !== 7 || missing.length > 0) {
    const details = missing.length ? missing.join(", ") : "the guard check returned an incomplete result";
    throw new Error(
      `Required deleted-account guards are missing or disabled: ${details}. Apply scripts/apply-deleted-account-guards.sql through the approved database SQL workflow, then restart. API startup does not run database DDL.`,
    );
  }
}

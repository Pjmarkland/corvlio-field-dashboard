import { pool } from "@workspace/db";
import { logger } from "./logger";

const REPAIR_SCRIPT = "scripts/apply-deleted-account-guards.sql";
const EXPECTED_GUARD_OBJECTS = [
  "public.guard_deleted_account_data()",
  "public.businesses.guard_deleted_account_businesses",
  "public.notification_devices.guard_deleted_account_notification_devices",
  "public.notification_events.guard_deleted_account_notification_events",
  "public.notification_poll_state.guard_deleted_account_notification_poll_state",
  "public.notification_seen_leads.guard_deleted_account_notification_seen_leads",
  "public.provisioning_attempts.guard_deleted_account_provisioning_attempts",
] as const;

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

export interface DeletedAccountGuardStatus {
  status: "present" | "missing" | "unknown";
  missing: string[];
}

let currentStatus: DeletedAccountGuardStatus = {
  status: "unknown",
  missing: [],
};

export function getDeletedAccountGuardStatus(): DeletedAccountGuardStatus {
  return { ...currentStatus, missing: [...currentStatus.missing] };
}

export async function verifyDeletedAccountGuards(): Promise<DeletedAccountGuardStatus> {
  let rows: GuardCheckRow[] = [];
  try {
    ({ rows } = await pool.query<GuardCheckRow>(DELETED_ACCOUNT_GUARDS_QUERY));
  } catch {
    currentStatus = { status: "unknown", missing: [] };
    logger.error(
      { repairScript: REPAIR_SCRIPT },
      `Could not verify deleted-account guards; API startup will continue. Review ${REPAIR_SCRIPT} and /api/healthz.`,
    );
    return getDeletedAccountGuardStatus();
  }

  const readyByName = new Map(rows.map((row) => [row.object_name, row.ready === true]));
  const missing = EXPECTED_GUARD_OBJECTS.filter((objectName) => readyByName.get(objectName) !== true);
  const incomplete = rows.length !== EXPECTED_GUARD_OBJECTS.length;
  currentStatus = {
    status: missing.length > 0 ? "missing" : incomplete ? "unknown" : "present",
    missing: [...missing],
  };

  if (currentStatus.status === "missing") {
    logger.error(
      { missing: currentStatus.missing, repairScript: REPAIR_SCRIPT },
      `Deleted-account guards missing or disabled: ${currentStatus.missing.join(", ")}. API startup will continue; review ${REPAIR_SCRIPT} and /api/healthz.`,
    );
  } else if (currentStatus.status === "unknown") {
    logger.error(
      { repairScript: REPAIR_SCRIPT },
      `Deleted-account guard check returned an incomplete result; API startup will continue. Review ${REPAIR_SCRIPT} and /api/healthz.`,
    );
  }

  return getDeletedAccountGuardStatus();
}

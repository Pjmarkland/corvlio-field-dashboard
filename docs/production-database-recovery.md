# Production database recovery — review only

No production schema, settings, deployment or data were changed by this work.

## Findings and limitations

- Production logs on 2026-10-16 show business-cache reads failing at 17:42 UTC,
  Retell pre-call fallback and post-call HTTP 500 responses at 17:43–17:44,
  and authenticated leads/inbox HTTP 503 responses at 18:57–18:58.
- The account-deletion guard returns those 503s when its ledger lookup fails.
  Existing logging hides the underlying driver error.
- Both `SELECT 1` and a production schema inspection were attempted through the
  supported read-only production query tool. Both stopped with:
  **Production database read replicas are unavailable for this project.**
  The publish schema-diff inspection failed with the same error.
- This is not a PostgreSQL error from the primary and does not prove that the
  primary is paused, that credentials are wrong, or that tables are missing.
  The production schema has NOT been verified.

## First: check for a paused database

The owner reported running out of credits earlier that day. Replit documents that
a disabled/paused production database can require manual unpausing.

1. Open **Database → Production → Settings**.
2. If **Unpause database** appears, resolve any outstanding billing/credit issue
   and use that control. This is an owner action; no agent action was taken.
3. In the production SQL console, run `SELECT 1 AS reachable, now() AS checked_at;`.
   If this fails, retain the actual error. A database outage cannot be repaired
   by bypassing the account-deletion guard or by a schema migration.

Reference: https://docs.replit.com/help/database

## Check every declared table and column

In the workspace Shell, run this generator (it opens no database connection):

```sh
pnpm --filter @workspace/scripts exec tsx ../lib/db/src/schemaAudit.ts
```

Copy its SELECT-only output into the **production database SQL console**.
It compares all exported Drizzle tables/columns, including `account_deletions`,
`pending_retell_releases`, businesses, leads, notifications, Retell records and
billing. Empty results mean no declared names are missing; this does not verify
types, indexes, custom triggers or row data.

## If the audit reports missing schema

Replit-managed production schemas are updated through **Publish**, not a Shell
command pointed at production.

1. Review the existing schema declarations under `lib/db/src/schema/`. The
   deletion ledger and retained-provider-release tables are already declared.
2. When ready to release, open **Publishing → Publish/Republish** and review the
   production schema diff before confirming.
3. Approve only intended additive changes. Stop if the diff proposes unexpected
   drops, truncation or drop-and-recreate renames; resolve renames in the UI.
   Do **not** select an overwrite-production-data option.

Do not run `scripts/migrate-account-deletion.mjs` against production, append DDL
to a deployment build command, or add startup-time schema creation. That SQL
script includes custom triggers; those are not modeled by the table/column audit.
It is not a supported production recovery command.

## Code hardening prepared for review

- Driver cause/code logging without SQL parameters or connection strings.
- Only confirmed missing-ledger errors allow read-only requests by identities
  that still own a business. Tombstoned identities remain blocked when the ledger
  exists; missing-ledger writes and all connectivity/permission errors fail closed.
  Deleted businesses are removed atomically with their deletion tombstone.
- At most 8 normal + 2 advisory connections per API process, 5-second pool
  acquisition/connection deadlines and 10-second idle eviction. Idle connection
  errors are handled without crashing the process. Advisory-lock acquisition
  SQL has a 15-second server-side statement deadline, preventing indefinitely
  blocked provisioning locks from consuming the advisory pool.
- The separate advisory pool remains necessary to avoid deadlocking query
  clients behind session-lock holders. Connection limits still multiply by live
  autoscale instances and rollout overlap; no per-process pool can guarantee
  global database capacity without knowing those limits.
- The five-minute retry sweep/backoff and immediate creation-triggered lead
  alerts remain unchanged. Retell changes are diagnostic logging only.

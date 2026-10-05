# Clear eight released test phone numbers — prepare/manual execution only

File: `recovery/clear-eight-released-test-phone-numbers.sql`.

This file was statically reviewed against the existing application/schema source.
It was **not executed**, including on development or production. No production
database connection, Retell request, or publish is needed to prepare it.
Static checks do not replace PostgreSQL's validation when you run the preview.

## Exact scope and necessary generated-column exception

The one UPDATE explicitly sets only `retell_phone_number = NULL`, and only for:

| Business ID | Required current phone |
| --- | --- |
| 4 | +15044749596 |
| 5 | +15717091218 |
| 6 | +19363031397 |
| 7 | +17626001677 |
| 8 | +17753679736 |
| 9 | +16205089615 |
| 10 | +19144514613 |
| 11 | +15167249532 |

**Important:** the existing `retell_phone_normalized` column is stored/generated
from `retell_phone_number`. PostgreSQL necessarily changes it to NULL too. It
cannot retain its old value while the source phone becomes NULL. The preview
shows this and the apply phrase explicitly acknowledges this exception. If
"no other column" includes preserving that generated value, **do not apply**:
that requirement cannot be met without changing the schema, which this file
does not do.

No other editable field changes: `updated_at`, owner/Clerk linkage, agent ID,
provisioning state, sample flag, alerts preference, and all other fields stay
identical. IDs 1–3, ID 12 / Corvlio / +16624994839, and every other business are
protected by a before/after whole-table comparison under a writer-blocking lock.
There is no lead update or other-table write. Normal database index maintenance
still occurs automatically.

The file refuses apply if any of the eight rows is missing, already NULL,
or has a different phone, or if a number is shared with another business.
It also checks the protected rows and refuses unexpected triggers, rules,
inheritance/partitioning, row-level security, generated expressions/columns,
or phone-referencing foreign keys. An exception aborts the whole batch.

## Exactly how to run it manually

1. Open the **production** database SQL runner and verify it is not development.
2. Copy the **entire SQL file** into the runner. Leave
   `confirmation text := 'PREVIEW ONLY';` unchanged.
3. Run **the whole file as one batch**. Do not select individual statements.
   Do not add transaction `BEGIN`/`COMMIT`: the console wraps the transaction.
   The `BEGIN` inside the `DO` block is procedural syntax, not transaction control.
4. Review the results: eight per-row previews, each
   `MATCH - WOULD CLEAR TO NULL`, and the JSON summary with `mode: "preview"`,
   `eligible: true`, `blockers: []`, and `rows_updated: 0`.
   If the runner shows only the last result set, expand the summary's `rows`
   array: it contains the same eight previews.
5. Only if you approve those exact rows **and the generated-column effect**,
   change the one editable line to:

   ```sql
   confirmation text := 'PRODUCTION: CLEAR RELEASED PHONES 4-11; ACCEPT GENERATED NORMALIZATION';
   ```

6. Run the **entire file again as one batch**. It rechecks all state under a lock.
   Success reports `mode: "apply"`, `rows_updated: 8`, IDs 4–11, and
   `preservation_verified: true`. The row preview deliberately shows the old
   values reviewed immediately before the change.
7. Save the results. Do not reapply: a later run refuses because the phones are
   already NULL. If you get a mismatch, timeout, or other refusal, stop; do not
   remove the safety checks or edit target pairs.

This is a one-off manual data cleanup, not a migration, startup/build hook,
or automatic provisioning action.

## App behavior after the manual apply

- **Dashboard and existing leads:** business accounts and lead data remain.
  Phone-dependent displays show no assigned number; Settings shows `Pending`.
  Reload/refresh an already-open app to pick up the changed profile.
- **Onboarding/login:** the app's configured check uses existence of the
  Clerk-linked business row, not its phone. These owners are **not sent back to
  onboarding because their phone is NULL**. Owner links and business rows remain
  intact. A genuinely different/unlinked login still needs setup. This is a
  source-code assessment, not a fresh inspection of production.
- **Provisioning status:** stored `provisioning_state` is untouched. Without a
  number, the leads API returns that stored state. A business whose stored state
  is `ready` can therefore still report `ready` despite having no number; this
  phone-only cleanup deliberately does not correct that flag. NULL is not a
  purchase trigger.
- **Demo call:** a missing number is rejected before provider access. The UI
  explains no number will be purchased; the no-call greeting preview remains.
  Demo calling is already disabled in production.
- **Alerts and scheduled retries:** alert preferences, unread alerts, devices,
  and queued emails/push remain. Delivery checks the business/lead/preferences,
  not whether its Retell number is present. Already queued alerts can still send.
  The retry worker does not purchase or replace phone numbers.
- **Pre-call webhook:** fresh database lookup no longer maps those released
  numbers to the test businesses. Requests for them get generic, no-business
  variables. No server restart is required for the lookup change.
- **Post-call webhook:** delayed events addressed to a cleared number become
  unknown-business events and are ignored; they do not create new leads/alerts.
- **Re-onboarding:** the existing-account guard does not automatically buy a
  replacement. However, an explicitly submitted setup request can reattach a
  previously journaled purchased number if one exists. Nothing in this file or
  the scheduled worker submits that request.
- **Corvlio:** row 12 and +16624994839 retain the same settings and mapping.

## Non-executing static check

Run `node scripts/check-released-test-phone-sql.mjs` to check the file's frozen
target list, preview default, confirmation gate, bounded UPDATE, preservation
checks, and absence of transaction wrappers/other writes. This script only reads
local files; it does not connect to a database or execute SQL.

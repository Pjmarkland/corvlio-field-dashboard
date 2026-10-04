# Corvlio existing-number recovery — manual review only

Prepared from read-only checks on 2026-10-04. No production write or publish was performed.

## Decision

Use `recovery/corvlio-existing-number.sql`, not a new permanent admin feature.
This is a manual, database-owner-authorized data insertion, not an app claim endpoint.
It therefore does not use ADMIN_EMAILS: access is controlled by the production SQL editor.
It makes zero HTTP/Retell calls and does not buy, provision, configure, transfer, or release numbers.
It is not imported by the app, run during build/startup, or attached to Publish.
Do not turn it into an automatic migration.

## Exact production findings

Email: `pjmarkland08@gmail.com`.

| ID | Business | Recorded Clerk ID | Phone / agent | Created and updated (UTC) |
|---|---|---|---|---|
| 1 | Pjs company | user_3JVhBQOcZqDEYShLub8a7S49rLE | Both NULL | 2026-09-18 17:28:02.091943 |
| 2 | Pjs company | user_3JVjDbcAMFuIEvpXZYUD9jxBtWq | Both NULL | 2026-09-18 17:39:52.113095 |

Both rows remain unchanged. There is no production business named Corvlio, no business
with normalized phone `16624994839`, and no provisioning attempt for `+16624994839`.
There are 10 production businesses and 0 production leads; neither older PJ business
has call records. The development Corvlio business has 0 leads.
These are present-state counts, not proof of historical lead preservation.

Production app tables do not provide an authoritative email-to-current-session mapping.
There is no local users/sessions table. The two IDs above are business-link history,
not proof of PJ's current signed-in production Clerk identity.
The Clerk setup is external; managed Replit Clerk dashboard access is unavailable.
Never choose either historical ID based only on email. Never copy the development
Clerk ID `user_3K2xZZqDscJ2qct9xlf9XBp3jR5` into production.

Production has valid unique indexes on clerk_user_id and retell_phone_normalized.
Phone normalization is a stored generated digit-only value. No user triggers exist
on businesses at the time of review. The script rechecks all these protections.

## Exact planned change

If the verified production login has no business and the number remains unassigned:
insert exactly ONE new businesses row, with a fresh production ID, linked to the
verified production Clerk ID and existing number `+16624994839`.
Do not copy development business ID 5: production ID 5 is a different business.
Do not change rows 1 or 2, or any other existing row.
No leads, call records, devices, provisioning attempts, notifications, or users are copied.
No production table or index is created, altered, dropped, or reseeded.

Copy these exact development values:

| Field | Value |
|---|---|
| business_name | Corvlio |
| business_type | AI Receptionist |
| agent_name / receptionist name | NULL — no name stored in this development business; do not invent one |
| personality_tone_description | Warm, kind, helpful |
| business_hours | Mon-Fri 09:00-17:00 |
| time_zone | America/New_York |
| service_area | `Estero/Fort Myers ` — trailing space preserved |
| retell_phone_number | +16624994839 |
| retell_agent_id | agent_57af301bd0aa3994b83b3a2ee9 |
| owner_email | Pjmarkland08@gmail.com |
| owner_phone | NULL |
| lead_alerts_enabled | true |
| is_sample | false |
| provisioning_state | pending — preserved; app reports ready from the existing phone, not by buying another |
| typical_response_time_commitment | Within 24 hours |
| owner_availability | Anytime |
| emergency_contact_info | 8634463029 |
| business_website_url | Corvlio.com |
| website_enrichment_sources | {"typicalResponseTimeCommitment":"https://corvlio.com/"} |
| website_enrichment_attempted_at | 2026-09-30T11:59:53.219Z |
| agreements_accepted_at | 2026-09-30T11:59:53.192Z |

Copy empty strings exactly for major_issue_examples, services_not_offered,
pricing_policy, financing_policy, brands_worked_with, warranty_info,
maintenance_plan_offerings, and credentials_certifications.

Do NOT copy the source clerk_user_id, id, created_at, updated_at, or generated phone column.
Production generates the new ID and digit-only phone; row timestamps use insertion time.
The snapshot was checked field-for-field against the current development record.

## Critical conflict

If PJ's real production ID is either older recorded ID, that login already owns a business.
The one-business-per-Clerk-ID rule makes adding a second business to that same login
incompatible with leaving the older business untouched. The script refuses and writes
nothing. Stop and request a separately approved ownership plan; do not unlink an older
business, invent a new identity, or create a replacement account as a workaround.

## Application order

1. PJ opens the PUBLISHED app, signs in as pjmarkland08@gmail.com, and stops at onboarding.
   Do not submit the form or click any number-provisioning controls.
   In desktop browser Developer Tools → Console, run this read-only expression:

   ```js
   ({
     userId: window.Clerk?.user?.id,
     primaryEmail: window.Clerk?.user?.primaryEmailAddress?.emailAddress,
     emailVerification: window.Clerk?.user?.primaryEmailAddress?.verification?.status
   })
   ```

   Confirm the app is the published production URL, the primary email is PJ's,
   and verification is "verified". Share only these results in chat, never cookies,
   tokens, keys, full request headers, or session credentials.
   If Clerk is undefined or the email is not verified, stop. The project's external
   Clerk administrator can alternatively verify the user in the external PRODUCTION
   Clerk instance. Do not use a development Auth user listing as production proof.

2. In this Replit project, the database owner opens the Database tool, selects
   Production, and opens My Data → SQL runner. Open the SQL file in the workspace
   Files area and copy the ENTIRE file. Change only input 1 to the verified user ID
   and input 3 to:
   `PRODUCTION SESSION VERIFIED: pjmarkland08@gmail.com`
   Leave input 2 at `PREVIEW ONLY`. Run it as one transaction.
   Review eligible, blockers, copied_fields_and_target_user, and existing owner/phone IDs.
   This preview allocates no ID and writes no business data. Save the result.
   With the untouched placeholder inputs the preview is intentionally blocked.
   If eligible is false, stop. The agent can discuss the result from chat.
   If the SQL runner cannot execute the whole transaction, do not split it.
   Report the error and stop; a separately authorized database operator must run
   the intact transaction with a PostgreSQL client.

3. When the identity and preview are satisfactory, the project owner may manually
   click Publish on Replit to publish the existing routing build. The agent does
   not publish. Review any database/schema prompt; stop on unexpected changes.
   This recovery adds no schema changes, and Publish does not execute this SQL
   or copy development rows into production.
   The existing routing guards remain in this build; linked owners bypass setup/welcome.

4. Re-run PREVIEW ONLY in Production immediately before applying. If eligible is true,
   replace only input 2 with the exact phrase:
   `INSERT CORVLIO +16624994839 FOR VERIFIED PRODUCTION USER`
   Run the entire SQL file once. Do not change the copied payload or remove checks.
   Save recovery_review_result with the SQL and identity evidence as the review/audit
   record. There is no permanent audit table or app audit feed for this manual option.
   A repeat with the same identity and unchanged recovered settings is a no-op.
   If recovered settings have since changed, the script refuses rather than overwriting.
   Any error aborts the transaction. If the runner leaves it open, issue ROLLBACK
   before another query. Never COMMIT a failed transaction piecemeal.

5. Ask the agent in chat to verify production READ-ONLY: new Corvlio row and its
   exact identity/phone, unchanged old rows, and no unintended business modifications.
   Save the pre-apply preview so there is a baseline to compare against.
   Read-replica verification can lag briefly. PJ then refreshes the published app
   (or signs out and back in) and should reach the dashboard without submitting setup.

## What can be done from chat

The agent can prepare/review SQL, run isolated development tests, compare safe session
identity results, and read production to verify before/after. It will not execute
production mutations or publish. Only the project/database owner performs the SQL
apply and Publish clicks on the Replit website.

## Risks and limits

- SQL trusts the operator's production-session identity verification; SQL cannot ask
  Clerk whether an ID belongs to that verified email. Guessing an ID can expose the
  recovered business to the wrong person. Keep apply blocked until identity is proven.
- The script takes a short business-table writer lock during apply (3-second lock
  timeout, 15-second statement timeout). Business reads continue. Other business
  writes may briefly wait; lock timeout means stop/retry, not bypass the lock.
- Insertion advances the normal business-ID sequence. A failed/rolled-back insert can
  leave an ID gap. No existing row is modified and the sequence is not reseeded.
- No Retell requests were made during this preparation. Number existence was verified
  in the earlier read-only investigation, not freshly rechecked here. The snapshot's
  shared agent ID is preserved. Do not infer that webhook delivery, live call routing,
  transfer behavior, or SMS has been verified. No test call has been made.
- Adding the mapping enables the app's existing production lookup by owner and phone.
  Future inbound webhooks can then create leads and existing enabled alerts can run.
  The SQL itself creates no lead, notification, or provisioning attempt.
- Retell must already deliver to the intended production webhook for live intake.
  If it delivers elsewhere or has a stale explicit business identifier, stop and
  investigate read-only; this SQL deliberately makes no Retell configuration changes.
- The snapshot is fixed. If PJ changes development settings before applying, stop
  and re-review rather than silently importing an updated version.
- Current zero lead counts cannot certify preservation of historical leads.
- Real production-session sign-in and post-recovery behavior remain unverified until
  PJ provides the actual session ID and performs the authorized manual recovery.
  Prior browser verification was blocked by a synthetic Clerk fixture.

## Verification completed

12 PostgreSQL recovery tests passed using an isolated development temporary table
and temporary ID sequence, all rolled back. They verify the real source snapshot,
no-write preview/no sequence allocation, exact copying, repeat safety, formatted
phone conflicts, either older owner conflict, invalid/development IDs, missing
identity attestation, explicit confirmation, preserving later edits, independent
phone uniqueness, missing indexes, and changed normalization. Apply also verifies
the writer lock is held.

66 frontend tests and 141 API tests passed. Frontend type check and production build
passed. Existing-owner onboarding/welcome routing regression tests remain included.
The build has non-blocking chunk-size and sourcemap warnings.
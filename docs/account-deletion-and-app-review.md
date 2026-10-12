# Account deletion and App Store review

This feature is implemented in the development app. It has **not** been published
or applied to production in this change. No real account, business, or provider
resource was deleted, and no reviewer seed was executed.

## In-app flow

“Account deletion exists in-app.”

Settings → Delete account → read the irreversible warning → type `DELETE` →
Permanently delete account. Users without a configured business can also delete
their account from the unconfigured-account screen.

The authenticated `DELETE /api/account/me` accepts only
`{"confirmation":"DELETE"}`. Identity comes from verified Clerk authentication,
never from caller-supplied IDs. Web cookie requests must have a matching origin;
authenticated native bearer requests are allowed.

The app clears its private query cache and signs out after accepted deletion.
If Clerk sign-out fails, the app opens a public, data-free retry screen rather
than leaving the user inside the dashboard. Normal sign-out also continues when
push unregister fails; failure is logged without token details.

## Data and provider boundaries

- Owned leads, call records, demo calls, notifications, push registrations,
  onboarding/business data and eligible local billing records are removed in
  one PostgreSQL transaction.
- Other businesses are not selected or deleted. Billing's existing per-business
  advisory locks are used before subscription checks.
- A minimal durable deletion identifier survives cleanup. Clerk identity
  deletion happens after the commit, with retry and already-deleted handling.
  API and database guards prevent a pending-deletion identity or stale
  notification worker from recreating deleted data.
- No Retell delete/release API is called. Assigned phone/agent resources and
  incomplete purchase evidence go to the admin's Pending Retell releases list.
  The retained data is limited to identifying the archived business and provider
  resources, not owner contact details, caller content or credentials.
- Agents can be shared. Admins must review other assignments before releasing
  anything. “Mark manually released” only records manual completion and clears
  retained resource details; it does not make any Retell request.

## Subscription rule and Apple review caveat

As requested, active/past-due paid subscriptions (and other unresolved paid
states or pending Checkout) block deletion and direct the owner to support.
This guard applies even when billing UI is disabled or the app is native.

**This rule should be reviewed before App Store submission.** Apple says apps
outside highly regulated industries should not require a phone call, email,
chat, or another support flow to complete account deletion. For auto-renewable
subscriptions, Apple also requires an immediate-deletion option. Implementing
the requested support block is not a guarantee of App Store compliance.
An unpaid reviewer account can use the direct in-app flow, but that does not
resolve the policy question for paid customers.

Official source:
https://developer.apple.com/support/offering-account-deletion-in-your-app/

## Sign-in options

No Clerk provider or tenant settings were changed.

- Email/password using the app's own account system does not by itself require
  Sign in with Apple. Google is not required.
- If Google or another third-party/social provider is offered for the primary
  account, guideline 4.8 generally requires an equivalent privacy-preserving
  login option unless a listed exception applies. Sign in with Apple is the
  standard choice.
- If Apple login is enabled, verify Apple token revocation on account deletion;
  do not assume deleting a Clerk identity proves the Apple tokens were revoked.
- For review, an existing verified email/password identity with accessible demo
  data avoids requiring a reviewer to control a private mailbox or social login.
  Reviewer credentials belong in App Store Connect, not in this repository.

Official sources:
https://developer.apple.com/app-store/review/guidelines/#login-services
https://developer.apple.com/support/offering-account-deletion-in-your-app/

## Reviewer seed compatibility

The manual reviewer helper remains attached to an existing verified Clerk
identity, with ownership/real-call conflict refusal. It creates no Clerk user,
Retell resource, or alert. Its mocked safety tests still pass.

No seed was run. Development and production identities/databases are separate;
passing development tests does not create or verify a production reviewer login.
The deletion guard prevents recreating an account already being deleted.

## Future approved release prerequisites

- Apply `scripts/migrate-account-deletion.sql` through the approved production
  migration process **before** enabling the new server code. It includes the
  bookkeeping tables and data-resurrection guards. A table-only schema push is
  not a substitute for these triggers.
- `scripts/migrate-account-deletion.mjs` is deliberately development-only.
- The signed `user.deleted` safeguard at `/api/webhooks/clerk` is **inactive**
  without `CLERK_WEBHOOK_SIGNING_SECRET` and matching external Clerk webhook
  configuration. Neither was added or changed here.
- An externally deleted identity still does not bypass paid-subscription
  safeguards. Such cleanup returns an error for retry/manual review.
- Native packaged binaries, real Clerk deletion, Apple token revocation and
  real provider release are not verified by mocked browser or database tests.

Tests use mocked Clerk calls and, for SQL cleanup/isolation/trigger verification,
connection-local `pg_temp` tables with a `pg_temp`-only search path. Fixtures and
deletions cannot resolve the real application tables.

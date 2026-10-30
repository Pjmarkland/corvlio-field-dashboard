# Corvlio development/test billing

**Billing remains OFF. Nothing has been published, no Stripe resources have been
created, and no live Retell or production data has been changed.**

## Settings and safety

`config.json` is the sole billing price/policy configuration. Prices are USD cents:

| Plan | Monthly | One-time setup | Calls |
|---|---:|---:|---:|
| Startup | $500 | $250 | 100 |
| Starter | $750 | $300 | 150 |
| Professional | $1,000 | $300 | Unlimited |
| Managed | $1,250 | $300 | Unlimited |

Startup requires admin approval of a business under 18 months old, then an
admin-assigned Startup plan. Its six-month Starter review date is recorded and
shown to admins; it never changes the subscription automatically.

- `BILLING_ENABLED` defaults off. Missing/invalid test credentials or public base
  disable billing. `sk_live_` keys are refused with a key-free log.
- `NODE_ENV=production` disables billing even if someone supplies a test key.
- Calls, lead capture, Retell configuration and numbers never depend on billing.
- Hosted Checkout and a card/invoice-only hosted Customer Portal are used.
  Portal cancellation and plan changes are disabled to prevent policy bypass.
- Setup is charged once per business; explicit upgrades do not add setup fees.
- Failed payments start five business days from the earliest observed failed
  charge, not from the latest retry. Defaults: UTC, Monday-Friday, no holiday
  exclusions. The timezone and excluded dates/weekdays are named settings.
- Stripe automatic retries are not disabled or replaced.
- After grace, only `needsAdminReview` and an admin notice are added. No suspension.
- 80% and 100% notices/flags are unique per business, audience, threshold and
  billing period. No automatic upgrade, per-call fee, blocking or throttling.
- Usage counts distinct real call IDs in completed lead captures with nonblank
  transcript, summary or caller issue. Retell completion evidence is used where
  available; older end-of-call lead captures without a call record are included.
  Contacted/new lead status is irrelevant. Dates use the Stripe period, otherwise
  UTC calendar month; the end is exclusive.
- Written cancellation records the verified actor and request time. Stripe
  `cancel_at` is the later of the configured notice end (30 days) and paid-period
  end. It is not immediate cancellation or `cancel_at_period_end`. Resume is only
  allowed before the effective date.
- Late fees are a disabled placeholder, not a fee calculation. The legal cap
  has not been specified. Retention, number holds/releases and offboarding are
  manual; unspecified durations remain null rather than invented.

## Database

`lib/db/migrations/billing-test-only.sql` is additive. It creates
`billing_accounts`, `billing_events`, and `billing_notices`, plus unique customer
and subscription indexes. It has been applied to **development only**. There is
no startup DDL, production migration, replacement database or data backfill.
Stripe card numbers, CVCs, raw webhook payloads and signed Checkout URLs are not
stored in these tables.

Webhook event claims, state changes and notice inserts share a transaction and a
business-scoped advisory lock. SDK Price lookup keys incorporate plan, price type,
currency and amount, with matching idempotency keys for creation. An open Checkout
is reused or expired before replacing it, avoiding two payable sessions.
Unknown customers are ignored; email or untrusted metadata never relinks a tenant.

The durable notification outbox reuses existing Gmail OAuth and APNs delivery.
Email and iOS device progress are saved separately; missing delivery configuration
stays queued. No eligible device means push is skipped, not falsely delivered.
Android delivery is not added by this billing change. Notices also remain visible
through billing status/flags and the event timeline. Transport is at-least-once:
an abrupt process failure after provider acceptance but before progress commit
can repeat a delivery; logical notice creation remains deduplicated.

## Future test configuration — do not add live keys

No credentials were requested or changed. The following **new development
secrets** are absent and required before a real Stripe test:

- `STRIPE_SECRET_KEY`: a Stripe test/sandbox secret starting `sk_test_`.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for this specific test endpoint,
  starting `whsec_`.

Development **non-secret settings**:

- `PUBLIC_API_BASE_URL`: an HTTPS development base, e.g.
  `https://your-development-host`. A trailing `/api` is supported. Return URLs
  preserve a configured path prefix and lead back to `/billing`.
- `BILLING_ENABLED=true`: explicitly opt in only after test configuration.

No publishable Stripe key is needed for server-created hosted redirects. Existing
Gmail, APNs, Clerk and admin secrets are reused unchanged. Production is disabled.

The root Stripe SDK and `stripe-replit-sync` prerequisites are installed. No native
Stripe connection was connected and no managed sync, webhook registration,
backfill or Stripe resource initialization was run: this delivery intentionally
supports the requested offline/mocked build. Managed connection/sync setup is not
claimed as completed and must not initialize live billing implicitly.

### Stripe Dashboard webhook steps (future, test mode only)

1. Select the intended **test/sandbox** account in Stripe Dashboard.
2. Open **Workbench → Webhooks** (or the account's Webhooks page), and add an
   endpoint/event destination for **your account**, not connected accounts.
3. Use `https://your-development-host/api/billing/webhook`. If the configured
   development base includes an artifact prefix, preserve it. Never use a
   production endpoint for this implementation.
4. Select these exact event types:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Reveal that endpoint's signing secret and add it through development Secrets
   as `STRIPE_WEBHOOK_SECRET`; do not paste it into chat or source.
6. Configure the test secret and HTTPS base, then explicitly enable the flag and
   restart the API and dashboard. Do not publish or redeploy.
7. Complete a real hosted **test** Checkout. Synthetic Dashboard test events
   with unrelated sample customers are intentionally ignored by tenant binding.
8. Replay a real mapped event; confirm its event ID and logical notice are not
   duplicated. Exercise failed invoice retries, paid recovery, cancel/resume,
   and owner A/B isolation using test customers only.

The application lazily creates test Prices via lookup keys on an authorized
Checkout/Upgrade. No customer-facing card form or live API action is needed here.

## Agreement differences requiring the user's review

The agreement was not edited. Section 3 still says excess call volume moves a
client to the next tier; this implementation only flags and suggests an upgrade.
It also says failed payments can lead to suspension and describes a 1.5% monthly
late fee (or lower legal maximum); this implementation only requests admin review
and does not calculate late fees. Align the document with the approved policy
before considering any live rollout. This implementation is not legal advice.

## Offline verification

`pnpm --filter @workspace/api-server test` and the dashboard test command run
mocked SDK/service tests. Signature tests use local Stripe HMAC helpers and local
HTTP only: no external Stripe, Retell, email or APNs request. Billing can be
developed and verified without credentials.

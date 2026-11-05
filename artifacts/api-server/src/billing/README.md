# Corvlio Stripe billing

**Billing remains OFF by default. No credentials or flags were changed, no Stripe
resources were created, nothing was published, and no production data was changed.**

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

- `BILLING_ENABLED` defaults off. Test billing is limited to non-production
  runtimes and requires an `sk_test_` or `rk_test_` key plus an HTTPS public API
  base.
- Live billing additionally requires `STRIPE_LIVE_MODE_ENABLED=true`, production
  runtime, an `sk_live_` or `rk_live_` key, a `whsec_` webhook secret, and a
  public HTTPS base whose hostname is in `REPLIT_DOMAINS`.
- The four standard plan prices are locked in `config.json`. Checkout lazily creates one
  Stripe Product per plan, then separate monthly and one-time setup Prices.
- `Live Test $3` is a separate, live-mode-only, one-time payment with no monthly
  price or setup fee. Its single `config.json` entry is hidden unless the current
  owner has a verified primary email listed in `ADMIN_EMAILS`; checkout is also
  guarded server-side by the existing admin middleware. Stripe creates its
  one-time Price at runtime. The Checkout session and PaymentIntent are marked
  as test payments, and the admin billing view labels the activated account.
- A paid Live Test session uses the same first-paid activation marker and worker
  as a subscription's first paid invoice. If the selected business is awaiting
  payment and has no Retell number, the existing activation flow may purchase
  and provision one. Use a controlled business whose activation you intend to
  complete. A business can complete this test payment only once.
- New businesses use emailed invoices while Stripe is off. When Stripe is enabled,
  new businesses are assigned to Stripe billing; existing manual accounts remain
  on emailed invoices. Checkout refuses all manual-mode businesses until an
  explicit migration path is approved, preventing accidental duplicate charges.
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
The Drizzle business schema now also accepts `billing_mode='stripe'`; no database
push was run for this change. Production schema changes must go through the normal
Publish migration flow before live billing is enabled. Do not apply production DDL
manually.
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

## Mode setup and readiness

No credentials, flags, Stripe resources or webhooks were changed or created by this
work. Before live billing is enabled, the owner must configure these workspace
settings through the Secrets/environment UI:

- Secret `STRIPE_SECRET_KEY`: live Stripe secret beginning `sk_live_` or
  restricted live key beginning `rk_live_`.
- Secret `STRIPE_WEBHOOK_SECRET`: signing secret for the production webhook.
- Non-secret `PUBLIC_API_BASE_URL`: production HTTPS API base; a trailing `/api`
  is supported.
- Non-secret `BILLING_ENABLED=true`.
- Non-secret `STRIPE_LIVE_MODE_ENABLED=true` (separate, default-off opt-in).

The admin Billing page has a readiness check that reports only secret presence
and key mode, validates the base URL, and probes the webhook endpoint with an
unsigned request. The probe only targets a hostname listed in `REPLIT_DOMAINS`;
it never calls Stripe or returns secret values. A reachable webhook responds with
the expected unauthorized status to that unsigned probe.

After the production schema is applied through Publish, configure the endpoint
in Stripe Dashboard for **your account**, not connected accounts. The URL is
shown by the readiness check and ends in `/api/billing/webhook`. Select these
exact event types:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

The readiness check is informational only; it does not enable billing. The app
must be explicitly restarted after configuration changes. Test mode remains
available only with explicit test credentials outside production.

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

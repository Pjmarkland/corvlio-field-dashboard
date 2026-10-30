# Manual invoice onboarding — development review

This flow uses the existing Gmail OAuth sender. It makes **no Square or Stripe
API calls**. The existing Stripe implementation and its disabled gates are
unchanged. Nothing in this work publishes or updates production.

## Review screens

- `/onboarding`: required plan selection; Startup requests require a stated
  business age of 0–17 completed months and subsequent admin approval.
- `/dashboard`: invoice history, current payment instructions and payment status.
  Initial unpaid accounts have no assigned Retell number.
- `/admin/invoices`: all businesses, Startup approval, per-invoice payment
  confirmation, email delivery status and editable payment instructions.

Native clients show plan names and payment status, not prices, invoice amounts,
bank instructions or checkout. The native link opens the web dashboard in the
system browser. Founder/admin screens remain web-only.

## Before testing email delivery

1. Open **Admin → Invoices** in the development app.
2. Save payment instructions and/or an optional HTTPS payment link. Do not put
   bank login credentials, account passwords or payment-provider API tokens here.
   These instructions are visible to clients.
3. The worker will pick up queued invoices after the settings save. Until then,
   delivery is `awaiting_instructions`; no incomplete payment email is sent.
4. The existing Gmail OAuth sending configuration must be working. No Square,
   Stripe or new provider secrets are needed. If the sender is unavailable,
   delivery is `unconfigured` and will be retried without claiming success.
5. Use a mailbox you control when reviewing actual delivery. A test that marks a
   first invoice paid can purchase a real Retell number using the existing
   provider configuration and provisioning budget. The automated checks performed
   for this build do not send real emails or purchase numbers.

The payee is **Markland Ventures LLC (DBA Corvlio)**. Initial invoices contain the
selected plan's first month and one setup fee. Due dates are five calendar days
after issue. Invoices are displayed in the dashboard; a PDF is not required.

## Billing schedule and confirmation

- Startup creates no invoice until approved. Approval is idempotent.
- Each initial invoice has a stable `initial` business/period key. Monthly
  invoices have stable month-index keys and contain no additional setup fee.
- Monthly anniversaries are calculated in UTC from the first confirmed payment,
  preserving the original day when short months require clamping.
- One polite reminder is queued three days after an unpaid invoice's due date,
  only after its initial email was confirmed sent. There are no automatic late
  fees, automatic subscription charges or overdue service suspension.
- Payment is manually confirmed per invoice with the verified admin identity,
  timestamp and reference. Repeated confirmation does not rewrite that evidence.
- The first confirmed payment enables the existing guarded provisioning path.
  Existing caps, account locking and purchase recovery remain authoritative.
  A failed/capped/uncertain purchase is not blindly retried.
- Existing businesses with no chosen manual plan are left unchanged. No invoices
  are backfilled or payment gates applied to them.
- Active manually paid accounts use the existing paid-account support boundary
  for account deletion, rather than silently deleting unresolved billing.

## Duplicate prevention and delivery uncertainty

Database uniqueness prevents multiple invoices for the same business/period and
multiple invoice/reminder outbox records. Workers atomically claim each email
before sending it; concurrent processes cannot claim the same delivery.

Gmail does not provide an idempotency key for `messages.send`. If a send times out,
the app cannot know whether Gmail accepted it. Such a delivery is
`needs_review`, not automatically resent. An interrupted `sending` claim becomes
`needs_review` after 15 minutes. Inspect Gmail's Sent folder before sending a
manual replacement. This deliberately favors preventing duplicate emails over
silently retrying an uncertain send.

The worker runs every minute while the API is running and catches up on startup.
An Autoscale deployment that sleeps is not a guaranteed wall-clock scheduler.
Before live use, arrange always-running execution or an approved scheduled
invocation if invoice delivery must occur on the anniversary without app traffic.
No hosting or deployment settings were changed here.

## Future payment links

Payment instructions and the optional HTTPS link are separate from invoice
generation and settlement. A Square or Stripe-hosted link can be pasted into
settings without code changes. A future verified provider webhook should resolve
the local invoice and use the settlement service; a browser return URL is never
proof of payment.

## Verification

Normal tests use mocked external services:

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/corvlio-field-dashboard exec vitest run
pnpm run typecheck
```

Opt-in PostgreSQL integration tests use temporary development business records,
clean them up by ID, and never call Gmail or Retell:

```sh
RUN_MANUAL_INVOICE_DB_TESTS=true pnpm --filter @workspace/corvlio-field-dashboard exec vitest run --root ../api-server --config ../api-server/vitest.config.ts tests/integration/manualInvoicing.integration.test.ts
```

Development adds four nullable business fields and three tables:
`invoice_settings`, `manual_invoices`, `invoice_emails`. Production must receive
reviewed additive schema changes through Publish if/when the owner approves a
release. Do not run a custom production migration script.

# Square: Stage 1 only

This is an isolated operator-run Sandbox experiment, not an enabled signup/payment integration.
No app endpoint invokes it. It never updates a business, records a real payment, sends app
billing emails, calls Retell, or accesses Square production.

## Configuration

Add values yourself in workspace Secrets, never in chat:

- `SQUARE_ACCESS_TOKEN`: **Sandbox** access token
- `SQUARE_LOCATION_ID`: matching USD Sandbox location
- `SQUARE_ENVIRONMENT`: `sandbox` (also the default when absent)

Reserved for the later integration: `SQUARE_APPLICATION_ID`,
`SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_NOTIFICATION_URL`.
The proof does not need a webhook or public callback.

## Run the experiment

```sh
pnpm --filter @workspace/scripts square:sandbox start sandbox-proof-001 professional
```

Use a new run ID for a genuinely new experiment. Supported plans and amounts come from
the existing invoice policy; Professional is $300 setup + $1,000 first month.
Startup additionally requires `--startup-approved` for the experiment, not a real approval.

Open the returned Square-hosted invoice URL. Use only official
[Sandbox test card values](https://developer.squareup.com/docs/devtools/sandbox/payments).
Select **Save my card on file**. The invoice is shared by URL, not email; its customer uses
`square-proof@example.test`. Never enter a real card.

After paying:

```sh
pnpm --filter @workspace/scripts square:sandbox complete sandbox-proof-001 --accept-sandbox-autopay-terms
```

That flag authorizes this test only. It is **not** a substitute for the real signup consent
record required in Stage 2.

The script verifies the invoice/customer/order/location/currency, full expected amount,
completed card payments and absence of refunds. Only a saved card for that customer permits
subscription creation. No card reports **Autopay setup incomplete**; multiple cards require
explicit selection rather than guessing. The next-month date uses the Square location's
timezone, with month-end clamping and proration disabled. The recurring price excludes setup.

Rerun `complete` with the **same run ID** to confirm the saved subscription without
creating another. Stable API idempotency keys and an exclusive local lock protect retries.
Local progress is saved under ignored `.local/square-sandbox/` (test IDs/config only,
no access tokens or card numbers). Do not delete this progress while recovering a timeout.
After an interrupted process, inspect the matching Sandbox resources before removing its lock.
Review/cancel test subscriptions in the Sandbox Dashboard after testing.

## Verification and limits

```sh
node --test scripts/square-sandbox/client.test.mjs
```

Local tests verify request construction and safety checks; **they do not prove Square
accepted these requests or that its hosted save-card handoff works for this account**.
An actual hosted-page payment and saved-card check are required before Stage 1 can pass.
The proof does not wait a calendar month to prove the next recurring collection.

The additive development migration adds `businesses.billing_mode` with default `manual`
and permits only `manual` or `square`. No business is switched. Existing manual behavior is
unchanged; invoice creation/reminder scheduling/email delivery exclude Square-mode records.
There is intentionally no switch UI yet. Stage 2/3 must implement consent, secure switching,
webhooks, owner/admin status, cancellation and controlled migration of outstanding invoices
before any real business can opt in. Bank payers remain on manual monthly invoices.
Native payment/price screens and disabled Stripe code are untouched.

---
name: Manual invoice boundaries
description: Manual payment rollout scope, legacy-account safety and Gmail delivery uncertainty.
---

Emailed invoices remain the default while Stripe is off. New businesses use the
active provider mode at creation; existing manual-mode businesses remain on emailed
invoices and cannot be converted automatically.

**Why:** The user authorized live Stripe under the LLC but requires a separate
default-off gate and a single billing path per business. Existing manual invoices
must not be replaced with a second charge path.

**How to apply:** Manual remains the default. The user has authorized an optional
Square card-autopay integration in the development workspace, with a mandatory
stop after its Sandbox proof and billing-mode foundation. Do not proceed to signup
consent, webhooks or admin integration until the user authorizes the next stages.
Square must be the only invoice/reminder sender for Square-mode businesses; bank
payers remain on monthly manual invoices.

**Why:** The user explicitly requested staged implementation, one billing owner
per business, unchanged manual behavior and unchanged payment-gated provisioning.

Do not retroactively invoice or disable existing businesses when adding
onboarding payment gates.

**Why:** The request concerns new signups; existing accounts must retain service
without an unapproved billing migration.

**How to apply:** Preserve the legacy/non-enrolled distinction and protect
approval/payment evidence from stale or concurrent onboarding retries.

Treat uncertain Gmail invoice sends as requiring review, not automatic retries.

**Why:** Gmail messages.send has no idempotency key; a timeout can occur after
delivery. Retrying an ambiguous send can produce duplicate financial notices.

**How to apply:** Atomically claim deliveries before external sends, expose
uncertain outcomes, and require checking Sent mail before replacing a notice.

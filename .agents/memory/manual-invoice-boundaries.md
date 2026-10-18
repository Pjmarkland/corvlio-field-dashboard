---
name: Manual invoice boundaries
description: Manual payment rollout scope, legacy-account safety and Gmail delivery uncertainty.
---

Manual invoice onboarding is a separate payment phase. Keep the Stripe
implementation intact and disabled; do not activate a payment-provider API as a
side effect of working on this flow.

**Why:** The user explicitly requested provider-free invoices while their payment
provider setup is blocked, with manual confirmation and future hosted links.

**How to apply:** Use admin-edited payment instructions and manually verified
settlement until the user explicitly authorizes a provider integration.

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

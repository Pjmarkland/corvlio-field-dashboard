---
name: Billing policy boundary
description: User-approved billing policy and the default-off live Stripe boundary.
---

The user chose flag-only call overages, five business days to cure followed only
by admin review, and no automated suspension. Late fees remain disabled because
the legal cap is unspecified. Startup's six-month Starter transition is an admin
review date, not an automated switch. Written cancellation requires the later of
30 days' notice and the current paid-period end; offboarding remains manual.

Stripe is authorized for live use under the LLC, but billing must remain off until
the owner explicitly enables it. The first cleared payment is the activation
boundary for the service line; keep that distinct from signing up or submitting
Checkout.

**Why:** The user wants Stripe live under the LLC and the line to go live only
after the first payment clears.

**How to apply:** Keep live mode behind its separate default-off flag. A paid
Stripe invoice must enter the established payment-gated provisioning flow once;
never silently fall back to test mode or convert manual accounts.

**Why:** These are the user's explicit implementation overrides. The client
agreement still describes automatic next-tier movement, possible suspension and
late fees. The user intends to edit that document; do not implement its conflicting
automation or silently edit the agreement.

**How to apply:** Preserve these overrides during billing maintenance and flag
the agreement differences for user review.

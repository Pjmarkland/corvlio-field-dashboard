---
name: Billing policy boundary
description: User-approved billing policy and the default-off live Stripe boundary.
---

Call overages remain flag-only. Unpaid-client enforcement is explicitly
authorized: the global mode defaults Off, Dry-run cannot change service, and On
permits day-3/day-5 warnings followed by suspension after five business days.
Fail open on missing or uncertain data, and re-verify Stripe live immediately
before suspension. Manual invoices require admin overdue confirmation; each
account can be marked never-auto-suspend. Late fees remain disabled because the
legal cap is unspecified. Startup's six-month Starter transition is an admin
review date, not an automated switch. Written cancellation requires the later
of 30 days' notice and the current paid-period end; offboarding remains manual.

Stripe is authorized for live use under the LLC, but billing must remain off until
the owner explicitly enables it. The first cleared payment is the activation
boundary for the service line; keep that distinct from signing up or submitting
Checkout.

**Why:** The user wants Stripe live under the LLC and the line to go live only
after the first payment clears.

**How to apply:** Keep live mode behind its separate default-off flag. A paid
Stripe invoice must enter the established payment-gated provisioning flow once;
never silently fall back to test mode or convert manual accounts.

**Why:** These are the user's explicit implementation rules. The client
agreement also describes automatic next-tier movement and late fees; do not
implement those or silently edit the agreement.

**How to apply:** Preserve these rules during billing maintenance. Keep live
Stripe itself behind its separate default-off billing flag.

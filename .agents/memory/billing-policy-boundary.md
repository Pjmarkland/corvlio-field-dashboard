---
name: Billing policy boundary
description: User-approved test billing overrides of the unaligned client agreement.
---

The user chose flag-only call overages, five business days to cure followed only
by admin review, and no automated suspension. Late fees remain disabled because
the legal cap is unspecified. Startup's six-month Starter transition is an admin
review date, not an automated switch. Written cancellation requires the later of
30 days' notice and the current paid-period end; offboarding remains manual.

**Why:** These are the user's explicit implementation overrides. The client
agreement still describes automatic next-tier movement, possible suspension and
late fees. The user intends to edit that document; do not implement its conflicting
automation or silently edit the agreement.

**How to apply:** Preserve these overrides during billing maintenance and flag
the agreement differences for user review. Billing work is development/test-only;
do not use live keys, touch live Retell or production data, publish or redeploy.

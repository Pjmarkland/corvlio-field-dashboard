---
name: Account deletion boundaries
description: User-required manual provider release and the App Store subscription-deletion policy conflict.
---

Account deletion must not automatically release Retell numbers or delete agents.
Use minimal retained resource details for an admin's manual review; shared agents
must not be removed as though they belonged exclusively to a deleted owner.

**Why:** The user explicitly requires preserving Retell resources for manual
release, protecting other businesses and avoiding irreversible provider changes.

**How to apply:** Preserve this boundary in deletion endpoints, signed identity
webhooks, retries, and future admin tools. Do not add provider deletion to an
otherwise local cleanup flow.

The user requested active/past-due external-subscription refusal with support handoff,
even when billing UI is disabled. This creates an App Store policy question:
Apple's account-deletion guidance generally forbids mandatory support flows for
apps outside highly regulated industries, and requires an immediate-deletion
option for auto-renewable subscriptions.

**Why:** The requested financial safeguard and Apple's direct-deletion guidance
are not automatically compatible. Passing an unpaid reviewer account's deletion
flow does not settle compliance for paid customers.

**How to apply:** Keep the requested safeguard unless the user approves changing
it. Flag the policy conflict before submission; do not claim App Store compliance
or approval based solely on the existence of the Delete account button.

Ordinary manual-invoice accounts may self-delete; pending invoices and reminder
jobs must be canceled as part of removing their data. A previously paid manual
invoice is not an active external subscription. Admin and internal-business
owner accounts must be blocked from in-app self-deletion with a clear reason.

**Why:** The user explicitly requested pending-invoice cancellation and protection
of admins and Corvlio's internal owner during App Store hardening.

**How to apply:** Preserve both UI explanations and server-side protection.
Exercise real Clerk deletion only on explicitly disposable test identities;
never test destructive behavior on an admin, internal owner, or existing client.

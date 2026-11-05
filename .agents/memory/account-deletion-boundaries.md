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

Owners can delete in-app regardless of subscription status, without a support
handoff. Cancel test-mode Stripe subscriptions immediately; expire pending Checkout
sessions; persist retries and alert admins if provider cancellation cannot be
confirmed. Keep outstanding invoices due, retain invoice/payment ledger records,
cancel reminder jobs, and alert PJ/admins about balances. Never enable live Stripe
as part of this flow. Admin and internal-business owner accounts remain protected.

**Why:** The user explicitly changed the deletion policy to unblock App Store
readiness while preserving collection of unpaid balances and financial records.

**How to apply:** Keep this behavior in the in-app flow and signed Clerk deletion
webhook. Exercise destructive deletion only on disposable test identities; never
use an admin, internal owner, or existing client. Review Apple policy separately
before claiming App Store compliance.

Account deletion must also remove support submissions, push registration
credentials, owner SMS history, and business-linked alert/audit content. Retained
invoice and balance records should use a generic deleted-account name while
preserving the financial ledger and the minimum provider references needed for
cleanup.

**Why:** The user asked to remove or anonymize all account-linked data while the
existing deletion policy requires retaining accounting records and provider
cleanup references.

**How to apply:** Include every new business- or identity-scoped data store in
deletion cleanup, retry guards, tests, and the public retention explanation.

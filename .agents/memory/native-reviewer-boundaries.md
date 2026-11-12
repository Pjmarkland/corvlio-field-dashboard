---
name: Native billing and reviewer boundaries
description: Native payment exclusion, isolated App Store reviewer data, and the owner-approved review-account auth exemption.
---

Native Capacitor iOS/Android Settings and Billing may show a read-only summary:
plan name, status and next invoice date only, with no prices, plan comparison,
checkout, upgrade actions or payment forms. “Manage billing” opens the website
billing portal in the OS external browser only after an explicit owner action and
only when Stripe is enabled and a Stripe customer exists. Never use an in-app
browser. Hide Billing entirely for internal businesses. Direct native payment and
plan-selection routes remain blocked; manual-mode web accounts keep emailed invoices.

**Why:** The user requires a price-free native summary and external-browser portal
management, while Stripe itself remains separately gated.

**How to apply:** Keep native purchase routes excluded even if cached server
availability says enabled. Summary reads must not activate billing, write
accounts or call Stripe. Create a portal session only from the explicit button
action. Native legal pages must not reintroduce financial copy.

Reviewer demo data stays isolated from real businesses and calls,
and attached only to an existing Clerk identity. Never provision a phone, create
a Clerk user, or automatically seed on startup.

**Why:** The user requested sample data for Apple's reviewer, with repeatability
and refusal to modify businesses containing real call data.

**How to apply:** Preserve ownership-conflict refusal and synthetic-data
provenance checks when maintaining the reviewer seed. Development and production
Clerk identities and databases are separate; never imply a development seed
populates the published app.

The owner approved a Device Trust exemption only for the existing App Review demo
account, not a global protection change or an exemption for other accounts.

**Why:** Apple reviewers cannot read the demo account's verification emails.

**How to apply:** Authorize through the exact verified demo identity in the
published server's own Clerk instance. Leave enrolled MFA and initial address
verification intact. A post-authentication hook requires an owner-authenticated
request first; do not claim it can exempt an account before its first sign-in.

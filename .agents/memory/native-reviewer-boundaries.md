---
name: Native billing and reviewer boundaries
description: User-required native payment exclusion and isolated App Store reviewer data.
---

Native Capacitor iOS/Android Settings and Billing may show a read-only summary:
plan name, status and next invoice date only, with no prices, plan comparison,
checkout, upgrade actions or payment forms. “Manage billing” opens the website
billing page in the OS external browser, never an in-app browser or a directly
created Stripe portal. Hide Billing entirely for internal businesses.
Direct native payment and plan-selection routes remain blocked. Preserve the
regular web/PWA billing experience and the existing production billing guard.

**Why:** The user explicitly refined App Store hardening to three read-only
fields and a website-only external management action. They prohibited publishing,
email, secret changes, and enabling production billing.

**How to apply:** Keep native purchase routes excluded even if cached server
availability says enabled. Summary reads must not activate billing, write
accounts or call Stripe. Native legal pages must not reintroduce financial copy.

Reviewer demo data is manually seeded, isolated from real businesses and calls,
and attached only to an existing Clerk identity. Never provision a phone, create
a Clerk user, or automatically seed on startup.

**Why:** The user requested sample data for Apple's reviewer, with repeatability
and refusal to modify businesses containing real call data.

**How to apply:** Preserve ownership-conflict refusal and synthetic-data
provenance checks when maintaining the reviewer seed. Development and production
Clerk identities and databases are separate; never imply a development seed
populates the published app.

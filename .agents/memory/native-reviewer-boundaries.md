---
name: Native billing and reviewer boundaries
description: User-required native payment exclusion and isolated App Store reviewer data.
---

Keep all Stripe billing, subscription, upgrade, Checkout, and customer-portal
surfaces out of native Capacitor iOS and Android builds, including direct routes.
Preserve the regular web/PWA billing experience and the production billing guard.

**Why:** The user explicitly requested "hide Stripe checkout in the iOS build"
and extended that exclusion to both native platforms for App Store review.

**How to apply:** Future billing entry points need native exclusion even if
cached server availability says enabled. Native legal pages must not reintroduce
the product's financial copy.

Reviewer demo data is manually seeded, isolated from real businesses and calls,
and attached only to an existing Clerk identity. Never provision a phone, create
a Clerk user, or automatically seed on startup.

**Why:** The user requested sample data for Apple's reviewer, with repeatability
and refusal to modify businesses containing real call data.

**How to apply:** Preserve ownership-conflict refusal and synthetic-data
provenance checks when maintaining the reviewer seed. Development and production
Clerk identities and databases are separate; never imply a development seed
populates the published app.

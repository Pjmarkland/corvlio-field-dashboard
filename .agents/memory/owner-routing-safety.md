---
name: Owner routing safety
description: Distinguish setup-route protection from missing development-to-production business ownership.
---

Treat setup routing and missing production ownership as separate problems. A routing-only fix must not claim to reconnect an owner's business when the production identity has no matching business.

**Why:** A reported onboarding redirect exposed both an unguarded setup route and a business configured only in development. Production also contained multiple legacy business records associated with the same email, so email alone was not a safe ownership-recovery decision.

**How to apply:** Check production identity and business linkage read-only first. Keep routing checks read-only and fail closed on lookup errors. Never automatically copy development data, resubmit onboarding, purchase a replacement number, or relink by email to make a redirect disappear. Any ownership recovery requires separately verified identity, an unambiguous intended business, and explicit authorization.
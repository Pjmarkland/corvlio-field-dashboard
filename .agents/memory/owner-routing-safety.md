---
name: Owner routing safety
description: Distinguish setup-route protection from missing development-to-production business ownership.
---

Treat setup routing and missing production ownership as separate problems. A routing-only fix must not claim to reconnect an owner's business when the production identity has no matching business.

**Why:** A reported onboarding redirect exposed both an unguarded setup route and a business configured only in development. Production also contained multiple legacy business records associated with the same email, so email alone was not a safe ownership-recovery decision.

**How to apply:** Check production identity and business linkage read-only first. Keep routing checks read-only and fail closed on lookup errors. Never automatically copy development data, resubmit onboarding, purchase a replacement number, or relink by email to make a redirect disappear. Any ownership recovery requires separately verified identity, an unambiguous intended business, and explicit authorization.

Additive-only ownership recovery must refuse a target identity that already owns a different business; do not resolve that conflict by silently moving or clearing the existing link.

**Why:** The user explicitly requires preserving older production businesses and reusing an existing phone without provisioning another. With one business per identity, adding another business to an already-linked identity conflicts with those preservation requirements.

**How to apply:** Verify the real production session independently of email-matching historical rows. Surface incompatible constraints and request a separately approved plan rather than bypassing uniqueness or creating a replacement identity.
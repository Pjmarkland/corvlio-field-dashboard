---
name: Stripe SDK compatibility
description: SDK-version payment parameters and invalidation of cached Checkout policies.
---

Use the installed Stripe SDK's version-specific request fields instead of casting
older parameter names past type errors.

**Why:** Stripe SDK 23 defaults to the Endive API; its Checkout request uses
`allowed_payment_method_types`, not the older `payment_method_types`.
An unchecked legacy field can compile after a cast but still fail at Stripe.

**How to apply:** Check current request types and versioned documentation when
changing Checkout restrictions. When a restriction changes, invalidate pending
session fingerprints and version creation idempotency keys together: otherwise
an old payable session can be reused, or Stripe can reject a changed request
under an already-used key. Do not initialize billing to check this offline.

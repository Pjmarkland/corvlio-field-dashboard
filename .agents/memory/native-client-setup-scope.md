---
name: Native client setup boundary
description: Product scope for Corvlio's client-facing native app and setup flow.
---

The native app is for Corvlio clients only. Native setup collects business details and required legal acceptances, but does not expose plan selection, subscription prices, checkout, payment links, or billing choices. Plan assignment and activation remain admin-managed on the web.

**Why:** the user said, “i only want clients using the app”.

**How to apply:** keep native admin routes hidden, keep native billing read-only without plan or payment actions, and require admin confirmation of the first payment before activation.

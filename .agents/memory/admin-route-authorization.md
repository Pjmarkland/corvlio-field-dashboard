---
name: Admin route authorization
description: Deliberate server-side authorization behavior for founder-only views.
---

Render browser admin routes without client-side role redirects; let protected admin APIs return 404 for signed-out and unlisted users. Hiding the routes in native shells is a presentation constraint, not an authorization control.

**Why:** Access must be decided server-side using the user's verified Clerk email against `ADMIN_EMAILS`, with the same not-found response for unauthorized and signed-out requests. A client-side redirect bypasses the intended 404 behavior and must not be mistaken for security.

**How to apply:** For founder-only views, keep `requireAdmin` on every data endpoint, show the API's 404 state in the UI, and keep admin links out of owner navigation. Keep admin actions read-only unless explicitly requested.
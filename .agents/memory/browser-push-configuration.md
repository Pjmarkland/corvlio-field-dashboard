---
name: Browser push configuration
description: VAPID requirements and safe admin readiness reporting for desktop browser notifications.
---

Browser push is not ready unless `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and an explicit valid `VAPID_SUBJECT` are configured. Admin readiness may show presence and validation status, but must not return key or subject values.

**Why:** A silent default subject made deployment readiness ambiguous; all required settings should be visible as missing before desktop alerts are enabled.

**How to apply:** Preserve the three-variable requirement when changing browser-push setup. Accept a valid `mailto:` or HTTPS subject and keep key material out of logs and admin responses.

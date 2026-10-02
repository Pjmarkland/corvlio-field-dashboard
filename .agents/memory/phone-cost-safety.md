---
name: Phone cost safety and live-call rollout
description: Standing product constraints on sample accounts, replacement purchases, and pre-call authentication.
---

Sample-filled onboarding submissions are demo accounts, never real number purchases or website scraping. An existing account must not automatically purchase a second or replacement number.

**Why:** The owner explicitly requested cost protection without breaking existing live calls.

**How to apply:** Keep demo provenance through edits and retries. A pending account must not be treated as a fresh purchase request; uncertain provider outcomes require verification, not automatic retries. Preserve evidence of completed purchases so recovery reuses the purchased number.

Missing pre-call webhook signatures must remain log-and-allow during the compatibility rollout. Invalid signatures can be rejected because Retell explicitly documents inbound signature support.

**Why:** The owner required live-call continuity; documented support does not prove every existing number is already sending a signature.

**How to apply:** Do not enforce presence until real inbound traffic has been checked and the rollout has been explicitly approved.

The admin console is read-only, including unused-number flags.

**Why:** The owner requested review indicators, not number releases or account mutations.

**How to apply:** Never wire a review flag into automatic number deletion, release, or reprovisioning.
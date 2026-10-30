---
name: Retell onboarding fallback
description: The onboarding database write must survive Retell phone provisioning failures.
---

Core business onboarding persistence must not depend on Retell phone provisioning succeeding; a failed provisioning attempt is represented by nullable Retell fields and a pending response.

**Why:** Retell can reject an otherwise valid onboarding request, such as with an invalid inbound agent, and blocking the database write loses the customer's submitted setup.

**How to apply:** Keep the business save as the durable first-class operation, log provisioning failures server-side, and make the UI treat a missing phone number with a pending flag as a successful non-blocking setup.
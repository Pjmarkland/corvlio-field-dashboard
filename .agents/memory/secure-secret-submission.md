---
name: Secure secret submission
description: Platform behavior when collecting a secret through the secure workspace flow
---

The secure secret request only stages a form; the secret is not available until the platform reports that it was added. Verify secret existence metadata before restarting a dependent workflow.

**Why:** Checking immediately after requesting the secret can correctly report the key as absent because the user has not completed the secure form yet.

**How to apply:** After the added-secret confirmation, verify existence without reading the value, restart the exact managed workflow, and inspect fresh startup logs. Do not claim downstream credential validity unless a safe operation exercises it.
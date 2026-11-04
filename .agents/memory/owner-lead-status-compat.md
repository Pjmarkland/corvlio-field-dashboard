---
name: Owner lead status compatibility
description: Distinguish dashboard list statuses from detail workflow statuses while preserving older stored values.
---

The lead detail workflow uses canonical `new`, `called_back`, `booked`, and `closed` statuses. The owner list remains the two-state `pending` / `contacted` view. Accept legacy update values and map legacy stored values when reading; include every contacted-like status in summary counts.

**Why:** Existing owner list clients depend on the two-state contract, while owners need more precise follow-up outcomes on a call.

**How to apply:** When changing lead status storage or UI, verify the write/read path, list mapping, summary counts, and compatibility with older rows together.

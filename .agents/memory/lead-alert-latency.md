---
name: Lead alert latency
description: Preserve immediate creation-triggered delivery when reducing background database work.
---

Database-cost changes may slow the scheduled notification retry sweep, but must
not delay alerts when new leads are created.

**Why:** The user explicitly requires new-lead alerts to continue being delivered
immediately, independently of the retry worker's interval and failure backoff.

**How to apply:** Keep creation-triggered delivery independent of the scheduled
sweep's idle check, lease, and backoff. Slow owner email must not delay a new
lead's push delivery.

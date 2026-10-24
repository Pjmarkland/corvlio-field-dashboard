---
name: Lead alert latency
description: Preserve immediate creation-triggered delivery when reducing background database work.
---

Database-cost changes may slow the scheduled notification retry sweep, but must
not delay alerts when new leads are created.

Browser Web Push shares the new-lead event, but must keep its subscription and
delivery state independent from the native APNs/FCM path. A Web Push failure
must not alter native push retry or polling behavior.

**Why:** The user explicitly requires new-lead alerts to continue being delivered
immediately, independently of the retry worker's interval and failure backoff,
and explicitly asked not to change native iOS/Android push behavior.

**How to apply:** Keep creation-triggered delivery independent of the scheduled
sweep's idle check, lease, and backoff. Slow owner email must not delay a new
lead's push delivery. Enqueue browser deliveries from the same business-owned
event, but dispatch them through a separate channel and subscription table.

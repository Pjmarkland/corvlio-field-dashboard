---
name: Internal business policy
description: Corvlio's own sales account is a real, non-billed internal business, not a sample/demo account.
---

Corvlio's own sales line belongs to an internal business with real lead capture and owner push alerts. It must never enter plan selection, invoicing, overdue reminders, Square billing, or payment-gated provisioning.

**Why:** The user explicitly requested an internal, non-billed account for Corvlio's own sales leads. A sample/demo account is not equivalent because sample accounts suppress real alerts.

**How to apply:** Preserve the distinction between internal businesses and samples. Adding billing features must keep internal businesses excluded at both the API and worker boundaries. Retell agent IDs are supplied by the owner; never invent one or change the provider merely to fill a local field.

Development verification must not release queued email or run provider provisioning as a side effect of restarting the app.

**Why:** The user required development-only work with no email, secret changes, Retell changes, or publishing. Previously queued work can otherwise run immediately on startup, independently of the requested test.

**How to apply:** Keep development background workers paused unless intentionally enabled for a separately authorized delivery/provisioning check. Use mocked providers for simulations and delete simulated leads and their notification/call records afterward. This is not a production delivery policy.

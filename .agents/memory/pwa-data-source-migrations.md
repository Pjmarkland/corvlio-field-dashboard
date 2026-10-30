---
name: PWA data-source migrations
description: How to prevent installed Corvlio clients from retaining obsolete data behavior across major data-source changes.
---

When replacing a persisted data source, treat the PWA shell, browser storage, in-memory user caches, and authenticated HTTP responses as one migration boundary. Version the app-shell cache, remove only obsolete storage keys, reload when the new worker takes control, and make user-specific data private and non-cacheable.

**Why:** Removing seed data from current source did not update already installed clients. An unchanged service-worker cache allowed the pre-migration bundle and its origin-wide lead storage to survive an account switch and display fabricated leads.

**How to apply:** Use this whenever lead ownership, authentication scope, or the source of dashboard data changes. Preserve unrelated settings and never use broad browser-data deletion as the migration mechanism.
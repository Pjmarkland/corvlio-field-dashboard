---
name: Google Sheets row writes
description: Concurrency boundary for updating a sheet row selected by a stable record ID.
---

Freshly locate the stable record ID for every status action and never persist row numbers. Treat this as safe for ordinary row insertion and reordering, but not as a strict transaction against a sort occurring between the lookup and values update. Strict concurrency requires a lock-bearing Apps Script or equivalent server-side conditional operation.

**Why:** Google Sheets values endpoints expose neither an ETag nor a spreadsheet revision precondition for conditional writes. The current Google OAuth grant covers spreadsheets only, so it cannot deploy Apps Script infrastructure.

**How to apply:** Keep browser requests free of spreadsheet IDs, resolve the business sheet server-side, fail closed on blank/duplicate IDs, and use locked infrastructure before promising safety against simultaneous edits.
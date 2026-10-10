---
name: Editable route state
description: Keep editable route component identity stable while the owner workspace polls and updates leads.
---

Use stable components or Route children for editable pages, not a newly created inline function in the Route component prop.

**Why:** The owner workspace rerenders for live lead refreshes and status mutations. A new component function remounts the editor even when its URL is unchanged, discarding unsaved drafts.

**How to apply:** When adding or changing owner-side forms, verify draft preservation across parent refreshes and mutation-state changes as well as the form's own query refetches.

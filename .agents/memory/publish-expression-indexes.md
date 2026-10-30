---
name: Publish expression indexes
description: The Publish schema diff can truncate nested comma-containing PostgreSQL index expressions.
---

Use a stored generated column plus a column-only unique index for phone normalization rather than a nested `NULLIF(regexp_replace(...))` expression index.

**Why:** A valid PostgreSQL expression index was truncated during Publish migration generation, producing invalid SQL. Moving the expression into a generated column survived database introspection and retained normalization and uniqueness semantics.

**How to apply:** Validate both source-generated and database-introspected migration SQL on a development-only structure clone. Keep production changes additive and access production only through the read-only replica. Replacing an existing development index is an exception to a no-drop rule and requires explicit user permission; that exception does not authorize other drops.
---
name: Production database diagnostic limits
description: Distinguish replica-tool availability from primary database failures during incident investigation.
---

If production query or schema-diff tooling reports that read replicas are
unavailable, the query has not reached the primary database. Do not report that
as a PostgreSQL error, evidence of credit suspension, or proof of missing schema.

**Why:** Both the trivial production query and schema-diff inspection can stop at
replica resolution while the published API has a separate, unreported driver
failure. Repeating those tool calls does not expose the primary's actual error.

**How to apply:** State the inspection limit explicitly. Obtain the primary
driver error from sanitized API cause logging or the owner's production SQL
console, and check the production database's Settings for a paused state.
Never substitute a successful development query or HTTP health check for
production database verification.

# PostgreSQL Row-Level Security Rollout Plan

**Status:** Planning only. No database roles, grants, RLS policies, or RLS table settings were changed for this phase.

## Why RLS needs a staged rollout

The API authenticates users with Clerk and scopes normal reads and writes in application queries. Database access is currently pooled through a shared API connection, and requests do not yet establish a transaction-local database identity. Enabling RLS before those two pieces are designed would either deny legitimate requests or leave service access broader than intended.

RLS is an additional containment layer. It does not replace Clerk authentication, API authorization, input validation, or business ownership checks. It also cannot protect against arbitrary SQL execution by a runtime role that can set any custom session variable; keep the runtime role least-privileged and continue preventing SQL injection.

## Scope and invariants

- Tenant ownership is based on the persisted business-to-Clerk-user relationship, not email matching or client-supplied business IDs.
- Every tenant-owned row must resolve to exactly one business. Orphans and ambiguous ownership must be investigated, not silently reassigned.
- Administrative access, Retell/webhook processing, notification delivery, and scheduled workers need explicit service paths; they must not gain access by bypassing all policies.
- Preserve existing product behavior, audit trails, webhook deduplication, and retention rules.
- Do not run the role or policy changes described below until they have a separately approved production rollout.

## Rollout stages

### 1. Inventory and ownership audit

1. Inventory every table and every query path, including API routes, background workers, Retell webhooks, billing, notifications, and support/admin tools.
2. Classify each table as tenant-owned, shared reference data, operational state, or privileged administrative data.
3. For each tenant-owned table, document its direct `business_id` or the unambiguous join path to `businesses`.
4. Find null, orphaned, and multiply-owned rows. Resolve them through an explicit support workflow; never infer ownership from matching email addresses.
5. Add and validate indexes for each business ownership lookup before enabling policies.

### 2. Design least-privilege database roles

Prepare a separate reviewed change for:

- A migration/owner role that owns schema objects and is not used by the running API.
- A runtime API role that is not a superuser, table owner, or `BYPASSRLS` role.
- Restricted worker roles or equivalent narrowly scoped access for scheduled jobs and provider webhooks.
- A deliberate administrative access path that can only be entered after the server has completed the existing Clerk admin guard and audit step.

Document required grants and rotation before creating or altering any role. Do not grant the ordinary runtime role table ownership or unrestricted membership in the migration/admin role.

### 3. Add transaction-local request identity

1. Wrap each tenant-scoped unit of work in one database transaction.
2. Immediately after Clerk authentication and business authorization, set the verified Clerk user ID with transaction-local `set_config('app.clerk_user_id', value, true)` or an equivalent `SET LOCAL` operation.
3. Keep the setting transaction-local; never set it on a pooled connection for the lifetime of the session.
4. Ensure all Drizzle queries in the unit of work use the same transaction connection. Audit helper functions that currently use the global pooled `db` handle.
5. Do not populate identity settings from request bodies, query parameters, or headers supplied by a client.
6. Define a separate, reviewed database access path for admin and worker work. Do not add an `is_admin` custom setting that any ordinary request can set as a policy bypass.

### 4. Implement and test policies in development

Start with a low-risk pilot table and use both `ENABLE ROW LEVEL SECURITY` and, after owner/role behavior is verified, `FORCE ROW LEVEL SECURITY` where appropriate.

Policy patterns to review for each table:

- On `businesses`, allow a tenant runtime transaction to see only rows whose stored `clerk_user_id` matches the transaction-local verified identity.
- On child tables with `business_id`, allow rows only when that business is visible to the transaction identity.
- On shared or operational tables, deny tenant access by default and grant only the specific role and operations each worker or API path requires.
- Separate admin access from tenant access. Verify its database authorization path cannot be activated by ordinary user-controlled input.

Add integration tests using at least two businesses and verify that reads, inserts, updates, deletes, joins, aggregates, and bulk operations cannot cross business boundaries. Include pool reuse, transaction rollback, missing identity, admin, worker, webhook, and orphan-row cases. Compare query plans and latency before expanding the pilot.

### 5. Observe, expand, and roll back safely

1. Run policies in a development database with production-shaped fixtures and no real customer sends or provider provisioning.
2. Add non-sensitive metrics for policy denials and missing transaction context; do not log row contents or caller data.
3. Expand table groups only after isolation tests and product-flow tests pass.
4. Prepare a reviewed migration and an explicit rollback before any production rollout. Rollback must restore the prior role/policy behavior without deleting business data.
5. Apply production DDL only through the approved production release process, never through a development database command.

## Readiness checklist

- [ ] Full table/query/worker inventory and owner mapping reviewed.
- [ ] All tenant rows have an explicit, unambiguous business owner.
- [ ] Runtime, migration, admin, and worker roles and grants reviewed by the database owner.
- [ ] Transaction-local identity is set only after server-side Clerk/business authorization.
- [ ] No connection-pool path can reuse another request's identity context.
- [ ] Cross-business isolation, admin, webhook, worker, and pool-reuse tests pass.
- [ ] Monitoring, rollout, and rollback are approved.
- [ ] Production changes are scheduled separately; this plan alone does not authorize them.

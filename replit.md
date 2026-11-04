# Corvlio Field Dashboard

An installable field dashboard for Corvlio clients to spot new AI receptionist leads, respond quickly, and track follow-up from a phone.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string; `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` — Web Push key pair (Replit Secrets; `VAPID_SUBJECT` is optional and defaults to Corvlio support)
- `VITE_NATIVE_API_BASE_URL` — the configured public API origin used by native Capacitor builds. Keep it aligned with `PUBLIC_API_BASE_URL`; web PWA builds leave it unset and use same-origin relative paths.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/corvlio-field-dashboard` — the React/Vite PWA, including the mobile feed, lead detail, stats, settings, Clerk auth routes, manifest, and service worker.
- `artifacts/api-server` — the shared Express service, Clerk Frontend API proxy, and protected Google Sheets lead reader.
- `public/manifest.webmanifest` and `public/sw.js` — install metadata and offline app-shell support.

## Architecture decisions

- Lead data comes from one fixed Google Sheet through a protected API endpoint. The server refreshes short-lived Google OAuth access tokens from server-only credentials and normalizes the sheet rows before returning them.
- The current Google Sheets integration is intentionally single-owner and read-only. Per-business sheet selection and status write-back are future work.
- Clerk is the authentication provider for the single business-owner account; the public root route stays useful for signed-out visitors, while field routes require a signed-in session.
- Native `tel:` and `sms:` links are used for one-tap contact actions. Native push remains on its existing APNs/FCM path; desktop-browser alerts use VAPID Web Push with business-scoped subscriptions and a separate delivery queue.
- The PWA uses a standalone manifest and a conservative service worker that never caches API or auth requests, and opens lead details when a push is clicked.

## Product

Corvlio Field Desk gives owner-operators a quick glance at today's newest Google Sheet leads, urgency, issue, address, and contact status. It includes one-tap call/text actions, completed-call history, live lead totals, settings, and branded owner sign-in.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Security Rules

- Keep `/api/admin/*` and `/admin` protected by server-side Clerk authorization. Non-admins receive the same generic 404 as unknown routes; client-side visibility is not authorization.
- Admin access requires the signed-in user's primary verified Clerk email to match `ADMIN_EMAILS`. The owner must enable MFA on every admin account and ensure `ADMIN_EMAILS` contains each admin's verified primary email; never print or expose secret values.
- Preserve Clerk's virtual routing and native cookie bridge behavior. Only allow the fixed native app origins, same-origin Clerk proxy paths, and length- and character-validated `__client` cookie values.
- Retell webhooks must keep their existing compatibility rule: missing signatures remain accepted during rollout, while present invalid or stale signatures are rejected. Keep call/event deduplication and business scoping intact.
- Do not log raw auth headers, cookies, Clerk tokens, caller names, transcripts, full phone numbers, or unfiltered provider/database errors. Mask phone/email text and prefer stable error names and allowlisted operational details.
- Android app backups stay disabled in both the manifest and Android data-extraction rules.
- Apply schema changes to the development database only with the documented DB push command. Do not apply RLS policies or change database roles without a separately approved rollout.
- Keep the frontend CSP and other browser security headers in its deployment response-header configuration. Do not weaken the policy to fix an asset or auth issue without checking the specific required origin.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

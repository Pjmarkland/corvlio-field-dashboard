# Corvlio Field Dashboard

An installable field dashboard for Corvlio clients to spot new AI receptionist leads, respond quickly, and track follow-up from a phone.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/corvlio-field-dashboard` — the React/Vite PWA, including the mobile feed, lead detail, stats, settings, Clerk auth routes, manifest, and service worker.
- `artifacts/api-server` — the shared Express service and Clerk Frontend API proxy.
- `public/manifest.webmanifest` and `public/sw.js` — install metadata and offline app-shell support.

## Architecture decisions

- The first build uses realistic seeded leads with local persistence so the core field workflow is usable before the optional Google Sheets sync is connected.
- Clerk is the authentication provider for the single business-owner account; the public root route stays useful for signed-out visitors, while field routes require a signed-in session.
- Native `tel:` and `sms:` links are used for one-tap contact actions; browser push is intentionally labeled as a future connection until a push provider is selected.
- The PWA is the first delivery target, with a standalone manifest and a conservative service worker that never caches API or auth requests.

## Product

Corvlio Field Desk gives owner-operators a quick glance at today's newest leads, urgency, issue, address, and contact status. It includes one-tap call/text actions, completed-call history, response-time stats, settings, and branded owner sign-in.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

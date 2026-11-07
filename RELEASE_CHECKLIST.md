# Release checklist

Run these checks from the Replit development workspace. Do not use the smoke command against production.

1. Run `pnpm run typecheck`.
2. Run `pnpm run test`.
3. Run `pnpm run smoke`. It refuses to run outside Replit development, uses temporary database fixtures plus test-only route fixtures, and reports the live development guard status from `/api/healthz`.
4. Build the native web assets with `pnpm --filter @workspace/corvlio-field-dashboard run build:native`.
5. Run `pnpm run preflight:ios`. It checks the Clerk publishable key without displaying it, confirms the production build is present and newer than source, and verifies the generated page points to a bundle containing that key.
6. Publishing does not install SQL-created functions or triggers. The API logs an error and continues booting if deleted-account guards are missing or disabled; `/api/healthz` reports their status. Applying `scripts/apply-deleted-account-guards.sql` through the approved database SQL workflow is recommended, but is not required for the API to boot.
7. Publish only after the code checks pass.
8. After publishing, run `scripts/verify-deleted-account-guards.sql` in the approved SQL console. Confirm all seven rows show `present` and `matches_expected` as true. Check the API logs and `/api/healthz` guard details, verify `/healthz`, and verify the intended iOS sign-in/build on a device. If guards are missing, the apply script is the optional repair step.

For iOS, `pnpm --filter @workspace/corvlio-field-dashboard run native:sync` runs the native build, preflight, and Capacitor sync in that order.

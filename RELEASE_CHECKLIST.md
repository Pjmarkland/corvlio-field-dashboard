# Release checklist

Run these checks from the Replit development workspace. Do not use the smoke command against production.

1. Run `pnpm run typecheck`.
2. Run `pnpm run test`.
3. Run `pnpm run smoke`. It refuses to run outside Replit development and uses temporary database fixtures plus test-only route fixtures.
4. Build the native web assets with `pnpm --filter @workspace/corvlio-field-dashboard run build:native`.
5. Run `pnpm run preflight:ios`. It checks the Clerk publishable key without displaying it, confirms the production build is present and newer than source, and verifies the generated page points to a bundle containing that key.
6. Before publishing API code that requires the deleted-account guards, review `scripts/apply-deleted-account-guards.sql`. If production is missing the function or any trigger, run that script manually through the approved production SQL workflow. Replit Publish does not install SQL-created functions or triggers. The API startup self-check does not make database changes and will stop the API if guards are missing or disabled.
7. Publish only after the checks pass and any required manual database step is complete.
8. After publishing, run `scripts/verify-deleted-account-guards.sql` in the production SQL console. Confirm all seven rows show `present` and `matches_expected` as true. Check the API logs for the successful guard self-check, verify `/healthz`, and verify the intended iOS sign-in/build on a device.

For iOS, `pnpm --filter @workspace/corvlio-field-dashboard run native:sync` runs the native build, preflight, and Capacitor sync in that order.

# Corvlio launch-readiness report

**Prepared:** November 4, 2026  
**Scope:** Launch-readiness code changes in this workspace only. No production data was inspected, no production schema was changed, and the app was not published.

## Implemented in this workspace

- Account suspension and restoration are explicit admin actions with an audit record and reason. A suspended business receives the generic inbound fallback; analyzed and delayed post-call processing checks suspension before creating a lead. Billing status and usage do not suspend accounts or change plans automatically.
- Admin overview badges and recurring operational alerts cover manual invoices beyond the grace period, Stripe past-due accounts beyond the cure period, and call allowances exceeded.
- Admin plan changes for active businesses require a reason and are audited. Existing unpaid invoices are not rewritten.
- Founder operational alerts include push delivery for supported incidents. `GET /api/health/launch` is available for an independent uptime monitor. An in-app notification cannot be relied on while PostgreSQL or the API is unavailable, so configure an external monitor for the health endpoint.
- Retell fallback incidents include only a masked caller number.
- Owners can download their own data as CSV or JSON, submit support requests in Settings, and test call forwarding from the forwarding help flow.
- An admin support inbox shows saved requests, urgency, and email-delivery status.

The repository's existing post-merge setup applied these schema changes to the **development** database. Production schema changes are not applied until the owner reviews and confirms them through Publish. This app was not published.

## Development verification

- API tests: **761 passed, 8 skipped** across 75 files.
- Dashboard tests: **230 passed** across 38 files.
- Workspace library, API server, and dashboard typechecks: **passed**.
- `GET /api/health/launch`: **200**, reporting the development database available.
- The signed-out preview rendered the sign-in page. Protected owner and admin screens were not visually inspected because the preview browser has no authenticated session.
- The browser console showed three CSP-blocked inline scripts and Clerk's development-key warning. The security policy was not loosened; verify authentication with the production Clerk configuration before App Store review.

## Owner steps: verify PostgreSQL backup and restore

These steps have not been run against production. First confirm that the published app uses Replit-managed PostgreSQL. If the app uses an external PostgreSQL provider, use that provider's backup and restore process instead.

### 1. Confirm the production database

1. Open the workspace **Database** tool.
2. Open the database selector and choose **Production**.
3. Confirm the database contains records created by the published app. Do not reveal or copy connection strings into chat, screenshots, or support tickets.
4. If there is no Production database, or the live records are elsewhere, stop and identify the database the published app actually uses before relying on these steps.

### 2. Enable and verify scheduled backups

1. In the Production database, open **Settings**.
2. Expand **Advanced → Scheduled backups**.
3. Under **Keep backups for**, choose the longest retention period available for the account's needs and plan.
4. Open **View all backups** and confirm that a recent restore point appears. Record the displayed time and retention period in the owner's operations log.
5. Also confirm the available point-in-time restore window in the production database settings.

Seeing a restore point verifies that Replit lists a backup; it does **not** prove that the application has completed a restore drill.

### 3. Restore during an approved recovery event

Do not click Restore on the live database just to test it. A restore changes the production database state and connected services may briefly reconnect. Get owner approval, choose a recovery time, and notify anyone using the app before proceeding.

For a scheduled backup:

1. Open **Database → Production → Settings → Advanced → Scheduled backups**.
2. Select **View all backups**.
3. Select **Restore** on the intended restore point.
4. Type `restore`, then select **Continue**.
5. Wait for the database to reconnect. Verify the app's sign-in, business profile, lead list, and newest expected records before resuming normal use.

For a point-in-time restore:

1. Open **Database → Production → Settings** and expand the restore settings.
2. Select the intended timestamp and confirm the restore.
3. After reconnecting, run the same application checks above and confirm the selected recovery point with the owner.

For a development database checkpoint rollback, choose the checkpoint in the rollback flow and select **Database** under **Additional rollback options**. A code rollback without that option does not restore the development database, and a development rollback does not restore production.

**Restore drill status:** Unverified. The steps above describe the owner-controlled recovery path; no production restore was performed. Replit's documented production restore acts on the production database, so do not use it as a non-destructive test. If the owner wants a rehearsal, first arrange a separate staging database and confirm a safe restore target with Replit; do not point a rehearsal at live production.

## Owner steps: prepare App Store review access

Apple requires a complete review path and working access for account-based features. No App Store Connect submission, reviewer sign-in, or native build was verified in this task.

### 1. Prepare the sample business and reviewer account

1. Sign in to the Corvlio founder dashboard with an admin account and open **Admin → Overview → App Review Demo**.
2. If no demo business exists, select **Create demo**. If refreshing an existing demo, select **Reset demo data** and confirm the prompt. This creates or replaces only the tagged App Review Demo profile and its eight fictional leads; it does not create an identity-provider account, buy a phone number, or change unrelated businesses.
3. Create a separate Clerk reviewer account using an email address dedicated to App Review. Sign in to that account once so it exists.
4. In **App Review Demo**, enter the exact reviewer email and select **Link reviewer account**. The default requires an exact verified email match. Use **Allow unverified email (admin override)** only when the owner confirms the exact existing Clerk account; it does not create an account or send an email.
5. Confirm the dashboard shows **Reviewer account linked** and **8 fictional leads ready**.
6. Sign in to the submitted app build with the reviewer account and verify that the demo business and fictional leads load. Do not use founder or administrator credentials for reviewer access.

### 2. Complete App Store Connect review information

1. In **App Store Connect → My Apps → [Corvlio app] → App Review → App Review Information**, enter a reachable reviewer contact name, phone number, and email.
2. Mark that the app requires a demo account. Add the dedicated reviewer account credentials in Apple's secure App Store Connect fields, not in this report, source code, or chat.
3. Ensure the account remains active and its credentials remain valid throughout review. If the sign-in flow requires an authentication code or special setup, provide reviewer-safe instructions in **Notes**.
4. In **Notes**, explain Corvlio's purpose and target audience, the demo sign-in path, where to find the sample leads, and any feature that is not obvious. Identify the authentication and hosted backend services the app uses.
5. Keep the required backend services available during review. Test the submitted build on a supported physical device and record the exact device and OS version tested.
6. If the app offers auto-renewable subscriptions, follow Apple's review instructions for an account with an expired subscription so the purchase flow can be inspected.
7. Before submitting, verify the reviewer account again from a clean sign-in. Do not reset or unlink the demo while review is in progress.

**Review status:** Preparation controls exist in the founder dashboard, but reviewer access and the submitted native build have not been tested. App Review approval cannot be guaranteed.

## References

- [Replit: Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery)
- [Replit: Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production)
- [Apple: Provide information for a complete review](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

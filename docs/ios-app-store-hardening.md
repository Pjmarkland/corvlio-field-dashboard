# iOS billing, deletion, and APNs release checks

This work is development-only. Nothing here authorizes publishing, email,
secret changes, live payment-provider changes, or Retell changes.

## Native billing

Settings links to the native read-only `/billing` screen. Its only account
fields are plan, status, and next invoice date (or “Not scheduled”).
“Manage billing” uses the OS external browser to open the website `/billing`;
it never creates a checkout or portal session in the app. Internal businesses
cannot view the screen. The web route can show existing manual invoices even
while Stripe remains disabled.

## Account deletion

The app requires exact `DELETE` confirmation. Verified allowlisted admins and
internal business owners are protected server-side and receive a clear reason.
Ordinary manual-invoice accounts can delete themselves even if an earlier
manual invoice was paid. Pending invoice/reminder jobs and invoice data are
removed transactionally with owned app data; Clerk deletion follows commit.
Clerk outages retain an idempotent deletion job for retry. A minimal deletion
tombstone prevents stale requests from resurrecting deleted data.

Retell resources are not released automatically. Minimal provider identifiers
are retained for manual resource review, with the business name replaced by
“Deleted account.” Existing unresolved external subscription obligations still
block self-service deletion. This remaining policy needs review before claiming
Apple account-deletion compliance for subscribers; it must not be tested by
deleting an actual customer's or admin's account.

## APNs

- App/bundle ID: `com.corvlio.fielddashboard`.
- Expected Apple key ID supplied by the owner: `HAKH49Q772`.
- `APNS_KEY`, `APNS_KEY_ID`, and `APNS_TEAM_ID` are present; values were not
  displayed or altered. Presence does not validate Apple's permissions or
  establish that the supplied key belongs to the intended team.
- Xcode Debug uses the development push entitlement and reports `sandbox`.
- Xcode Release uses the production push entitlement and reports `production`.
- A native Capacitor bridge reports this build environment when registering
  a device. The API stores it per token, so development and distribution tokens
  can coexist without routing one to the other environment.
- Production tokens use `api.push.apple.com`; sandbox tokens use
  `api.sandbox.push.apple.com`. Legacy tokens without metadata default to
  production on a deployed server, sandbox locally, unless a valid `APNS_ENV`
  override is intentionally configured. No such override is needed for new
  clients.

### Still requires the owner / a Mac

1. Confirm key `HAKH49Q772` has APNs access for the correct Apple Developer team
   and app, including the environments used. Confirm Push Notifications is
   enabled for this App ID and the distribution profile has been regenerated
   if necessary. No private key needs to be pasted into chat.
2. Build/sync the updated native app and archive the **Release** configuration.
   The custom native push-environment bridge requires a new native build; a
   web-only refresh of an older installed binary cannot add it.
3. On the exported signed app, inspect its actual entitlement, not just source:
   `codesign -d --entitlements :- Payload/App.app`
   It must contain `aps-environment = production` for TestFlight/App Store.
4. After separately approved publishing/distribution, register a physical
   TestFlight iPhone, grant notifications, and verify foreground/background/
   terminated delivery and lead deep links. Current automated APNs tests mock
   the provider; Linux cannot run Xcode signing or prove physical delivery.

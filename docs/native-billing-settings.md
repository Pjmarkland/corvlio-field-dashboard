# Native Settings billing

The current App Store hardening contract is documented in
`ios-app-store-hardening.md`. Native Billing shows subscription status and next
invoice date only; it never shows prices or plan comparisons. “Manage billing”
requests an authenticated Stripe portal session when Stripe is enabled and the
owner has a Stripe customer, then opens that portal in the OS external browser.
Internal businesses are excluded. Native checkout and plan-selection surfaces
remain blocked. With Stripe disabled, manual-mode web accounts continue to use
emailed invoices; existing Stripe-mode accounts are not silently converted.

The live-capable code remains disabled by default. No publishing, credential
changes, Stripe resource creation or production-data changes are part of this work.

- Capacitor iOS/Android Settings shows stored plan name, subscription status,
  and a future next charge date when recorded. Canceled/non-recurring accounts,
  expired/invalid dates and cancellations effective before renewal have no next
  charge date shown.
- `/api/billing/native-summary` is authenticated and owner-scoped. It performs
  only a SELECT, returns no prices or Stripe identifiers, and does not contact
  Stripe, create accounts, refresh usage or send notices.
- “Manage billing” is disabled unless the server reports Stripe enabled and an
  existing Stripe customer. Tapping it requests a portal URL from the authenticated
  API; the portal session is created only for that user action.
- Capacitor AppLauncher uses the operating system's external URL handling:
  `UIApplication.open` on iOS and `ACTION_VIEW` on Android. It does not use an
  embedded browser or Capacitor Browser.
- Direct native billing/Checkout/plan-selection surfaces stay blocked. The
  web/PWA page remains the payment surface and displays whether Stripe is in
  test or live mode.
- API or browser failures produce a calm retry message, never a webview fallback.

The fallback website origin was verified against published deployment metadata.
An explicit native API URL uses its website origin for `/billing`.

Native plugin references were updated for both platforms. This Linux workspace
cannot run Xcode or CocoaPods: run the normal native build/sync and CocoaPods
installation on the Mac before packaging iOS. Actual device-browser behavior
and store review acceptance have not been verified here. External billing-link
rules vary by storefront and service category; an external browser alone does
not guarantee App Store compliance.

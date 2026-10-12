# Native Settings billing

Implemented in development only. No publishing, redeployment, Secrets changes
or deployment-setting changes are part of this work.

- Capacitor iOS/Android Settings shows stored plan name, subscription status,
  and a future next charge date when recorded. Canceled/non-recurring accounts,
  expired/invalid dates and cancellations effective before renewal have no next
  charge date shown.
- `/api/billing/native-summary` is authenticated and owner-scoped. It performs
  only a SELECT, returns no prices or Stripe identifiers, and does not contact
  Stripe, create accounts, refresh usage or send notices.
- The existing production billing gate and mutation endpoints are unchanged.
  A disabled gate still refuses portal creation, Checkout and plan changes.
- “Manage billing” requests the existing authenticated Stripe portal only when
  enabled and a customer exists. Otherwise a neutral website link is shown.
  If the server gate closes during the action, the website opens externally.
- Capacitor AppLauncher uses the operating system's external URL handling:
  `UIApplication.open` on iOS and `ACTION_VIEW` on Android. It does not use an
  embedded browser, Capacitor Browser, or an app payment route.
- Direct native billing/Checkout/plan-selection surfaces stay blocked. The
  existing web/PWA page, navigation and price presentation are unchanged.
- Browser failures produce a calm retry message, never a webview fallback.

The fallback website origin was verified against published deployment metadata.
An explicit native API URL uses its website origin for `/billing`.

Native plugin references were updated for both platforms. This Linux workspace
cannot run Xcode or CocoaPods: run the normal native build/sync and CocoaPods
installation on the Mac before packaging iOS. Actual device-browser behavior
and store review acceptance have not been verified here. External billing-link
rules vary by storefront and service category; an external browser alone does
not guarantee App Store compliance.

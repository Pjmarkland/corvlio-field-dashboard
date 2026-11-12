---
name: Native Clerk environments
description: Keep Capacitor Clerk key selection separate from browser-host key derivation.
---

For Corvlio's Capacitor app, use the configured publishable key directly. The WebView hostname is `localhost`; deriving a Clerk key from it does not select the configured Production Frontend API at `clerk.corvlio.com`. Keep the web app's host-based key selection unchanged, and keep development keys usable through the environment rather than hardcoding a production key.

**Why:** the user requires one native code path to support both development and production keys while preserving the existing web build behavior.

**How to apply:** when changing native Clerk setup, branch key selection for Capacitor, keep the native API proxy and its target aligned with the selected Clerk environment, and leave browser host-based resolution untouched unless the app domain configuration changes.

For Clerk Frontend API calls from native origins, use the documented `_is_native=1` marker and never forward both `Origin` and `Authorization`. The native client token can be returned in the response `Authorization` header and reused on later requests.

**Why:** Clerk's Frontend API recognizes native requests through the marker and rejects requests containing both `Origin` and `Authorization`; native client state must not depend on third-party WebView cookies.

**How to apply:** mark native Frontend API routes only, omit upstream `Origin` on those requests, and preserve/expose `Authorization` in both directions while leaving web traffic unchanged.

For native iOS authentication, use Clerk's in-app web form as the default path. Keep the Capacitor native Clerk plugin opt-in until a real-device test confirms initialization, sign-in, sign-out, and session restoration.

**Why:** the user reported that native plugin initialization times out on-device after about three seconds and its debug trace is unavailable.

**How to apply:** do not re-enable the plugin based only on unit tests; validate the complete session lifecycle in an installed iOS build first.

Supply Clerk's locally bundled UI explicitly to both web and native providers; do not rely on automatic UI downloading in non-browser mode.

**Why:** Clerk Core 3 separates the core and UI bundles. With `standardBrowser=false`, the React SDK skips automatic UI loading unless a UI constructor is supplied, causing the on-device “Clerk was not loaded with Ui components” error.

**How to apply:** use the documented `ui` export from `@clerk/ui` as the provider's `ui` prop. Keep compatible Clerk shared types without unsafe casts, and verify the production bundle graph includes the sign-in/sign-up UI chunks.

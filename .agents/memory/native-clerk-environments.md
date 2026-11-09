---
name: Native Clerk environments
description: Keep Capacitor Clerk key selection separate from browser-host key derivation.
---

For Corvlio's Capacitor app, use the configured publishable key directly. The WebView hostname is `localhost`; deriving a Clerk key from it does not select the configured Production Frontend API at `clerk.corvlio.com`. Keep the web app's host-based key selection unchanged, and keep development keys usable through the environment rather than hardcoding a production key.

**Why:** the user requires one native code path to support both development and production keys while preserving the existing web build behavior.

**How to apply:** when changing native Clerk setup, branch key selection for Capacitor, keep the native API proxy and its target aligned with the selected Clerk environment, and leave browser host-based resolution untouched unless the app domain configuration changes.

For native iOS authentication, use Clerk's in-app web form as the default path. Keep the Capacitor native Clerk plugin opt-in until a real-device test confirms initialization, sign-in, sign-out, and session restoration.

**Why:** the user reported that native plugin initialization times out on-device after about three seconds and its debug trace is unavailable.

**How to apply:** do not re-enable the plugin based only on unit tests; validate the complete session lifecycle in an installed iOS build first.

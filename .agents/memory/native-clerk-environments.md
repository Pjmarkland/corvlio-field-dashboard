---
name: Native Clerk environments
description: Keep Capacitor Clerk key selection separate from browser-host key derivation.
---

For Corvlio's Capacitor app, use the configured publishable key directly. The WebView hostname is `localhost`; deriving a Clerk key from it does not select the configured Production Frontend API at `clerk.corvlio.com`. Keep the web app's host-based key selection unchanged, and keep development keys usable through the environment rather than hardcoding a production key.

**Why:** the user requires one native code path to support both development and production keys while preserving the existing web build behavior.

**How to apply:** when changing native Clerk setup, branch key selection for Capacitor, keep the native API proxy and its target aligned with the selected Clerk environment, and leave browser host-based resolution untouched unless the app domain configuration changes.

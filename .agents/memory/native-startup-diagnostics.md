---
name: Native startup diagnostics
description: Why startup errors remain visible in production builds.
---

Keep startup error names, messages, and a short stack trace readable on-device in all builds, including production.

**Why:** the user explicitly requested this because TestFlight-only crashes were hidden behind a generic failure screen and could not be diagnosed from the device.

**How to apply:** preserve production visibility when revising startup failures; keep render errors and uncaught async failures diagnosable without changing Clerk or security configuration as a speculative fix.

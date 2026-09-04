---
name: Clerk PWA auth
description: Durable setup constraints for branded Clerk authentication in this workspace's React/Vite PWAs.
---

Clerk-authenticated React/Vite PWAs need the managed Clerk proxy mounted before Express body parsers, and Tailwind v4 must declare the Clerk layer before importing Tailwind. Keep the auth UI branded rather than falling back to hosted defaults.

**Why:** The proxy is part of the production authentication transport, while Tailwind v4 can reorder imported Clerk styles during optimization and make sign-in render incorrectly after publishing.

**How to apply:** When extending the auth surface or changing the Vite/Tailwind setup, preserve the proxy middleware order, ClerkProvider proxy props, full base-path sign-in routes, and the production-safe Tailwind configuration.
---
name: Retell release boundaries
description: Keep sales-agent knowledge and live number routing separate from field-receptionist draft releases.
---

Do not claim that clearing the shared draft knowledge base is a lossless replacement for the published Corvlio sales/demo agent. The reviewed provider PDF contains agency pricing, FAQs, and booking/transfer claims, not individual field-business intake facts. Preserve the published sales agent and its KB unless a reviewed replacement is approved.

**Why:** A shared field-receptionist draft should not answer a client's callers with agency sales facts, but the live agency demo may still depend on those facts.

**How to apply:** Distinguish field-service numbers from agency sales/demo numbers before rollout. The release checklist in `docs/retell-production-rollout.md` explains the separation and webhook transition.

Publishing a shared draft can immediately affect numbers routed to `latest_published`; changing the agent's post-call webhook does not update number-level inbound hooks.

**Why:** The observed published agent sends results to Make while the draft targets development. An uncontrolled publish could redirect live results or activate the wrong business prompt across multiple numbers.

**How to apply:** Inventory and, with explicit approval, pin live routes to the current numeric version before publishing a reviewed production candidate. Prepare the production app and both webhook paths separately; keep the old agent, KB, and Make pipeline available for rollback.

Per-business fallback numbers returned by the app's inbound webhook are not outage failover by themselves. When the app API is unavailable, it cannot supply that data; actual outage forwarding must be configured independently at the Retell phone-number or carrier level.

**Why:** Webhook-derived values exist only when the webhook can reach the app, so presenting the database setting as an active server-outage route would be misleading.

**How to apply:** Keep app fallback data and live phone-number routing separate. Do not claim outage forwarding is active until the independent provider route has been configured and verified.

Permission to enable owner demo calls in production is not permission to publish
shared Retell drafts or change live phone-number routing.

**Why:** one owner test call is scoped to an explicit agent version, while
publishing a shared draft can affect unrelated businesses and the agency demo.

**How to apply:** keep owner-call availability separate from provider release
approval, and do not publish or repoint live routes merely to enable owner tests.

Retell list migrations must follow the documented method/path for each resource,
not blindly add a version prefix. Agent-version listing remains an unversioned
supported path, but uses the same strict paginated `items` envelope.

**Why:** Retell's June 2026 notice replaces specific legacy paths, not every
unversioned list URL. An invented versioned path can break safe draft selection.

**How to apply:** Check the current official endpoint reference; collect every
page or fail explicitly before provider actions. Do not attribute an API warning
to this checkout without request-origin evidence, or introduce unused bulk
inventory readers merely to claim a migration.
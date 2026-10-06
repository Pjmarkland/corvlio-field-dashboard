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

Permission to enable owner demo calls in production is not permission to publish
shared Retell drafts or change live phone-number routing.

**Why:** one owner test call is scoped to an explicit agent version, while
publishing a shared draft can affect unrelated businesses and the agency demo.

**How to apply:** keep owner-call availability separate from provider release
approval, and do not publish or repoint live routes merely to enable owner tests.
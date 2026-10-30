---
name: Retell transfer isolation
description: Provider limitations that matter when adding transfers to the shared receptionist.
---

Do not assume inbound `agent_override.retell_llm` can replace `general_tools` for each business. The supported override fields do not include tools.

**Why:** The provider's inbound webhook schema only allows a limited set of LLM overrides. A shared hardcoded transfer destination can connect one business's callers to another business, and prompting alone does not enforce tool isolation.

**How to apply:** Verify the current official provider schema before adding business-specific transfers. Use an actually supported isolated or backend-gated routing mechanism. Until one exists, omit the shared transfer tool and take a callback message rather than attempting an unsupported per-call tool override.
---
name: Call quality semantics
description: Confirmed intake is distinct from provider caller ID, fallback summaries, and incomplete historical metadata.
---

The call scorecard must not equate an available phone number with a caller-confirmed callback. Legacy provider analysis fields named “phone” can merely echo caller ID; keep confirmation unknown unless canonical callback extraction establishes it. Similarly, a fallback transcript summary is not proof that an issue was captured.

**Why:** Older call storage did not preserve capture evidence. Inferring complete intake from filled display fields would give misleading quality percentages and hide abandoned calls.

**How to apply:** Preserve unknown states in historical rows and keep them in the stated recent-call population. Do not backfill affirmative capture flags from caller ID or display fallbacks. Treat the early-hangup label as an intake-completeness heuristic, not proof of caller intent.
---
name: OpenAPI Zod generation constraints
description: Compatibility and strictness gaps between Orval output and the workspace's Zod 3 runtime.
---

Avoid OpenAPI `format: email` and `format: uri` on request bodies while the API schemas package uses Zod 3: the current Orval generator emits `zod.email()` and `zod.url()`, which do not exist in that version. Validate email and HTTP(S) URL inputs explicitly in the server route instead. Generated Zod objects also do not enforce OpenAPI `additionalProperties: false`; call `.strict()` where unexpected keys must be rejected.

**Why:** Code generation can succeed but the chained library typecheck then fails on unsupported format methods, and silently stripped ownership fields can mask invalid client payloads even though server authorization remains independent.

**How to apply:** When defining request schemas, keep generated constraints version-compatible, add server-side format validation, and use strict parsing for payloads where rejecting unknown fields matters. Revisit after upgrading Orval or Zod.
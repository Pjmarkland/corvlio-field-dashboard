---
name: OpenAPI Zod generation constraints
description: Compatibility and strictness gaps between Orval output and the workspace's Zod 3 runtime.
---

Avoid OpenAPI `format: email`, `format: uri`, and `type: integer` while the API schemas package uses Zod 3: the current Orval generator emits `zod.email()`, `zod.url()`, and `zod.int()`, which do not exist in that version. Use `type: number` with `multipleOf: 1` for integer constraints; validate email and HTTP(S) URL inputs explicitly in the server route instead. Generated Zod objects also do not enforce OpenAPI `additionalProperties: false`; call `.strict()` where unexpected keys must be rejected.

**Why:** Code generation can succeed but the chained library typecheck then fails on unsupported format methods, and silently stripped ownership fields can mask invalid client payloads even though server authorization remains independent.

**How to apply:** When defining request schemas, keep generated constraints version-compatible, add server-side format validation, and use strict parsing for payloads where rejecting unknown fields matters. Revisit after upgrading Orval or Zod.

Use named component schemas for operation request bodies rather than inline object definitions.

**Why:** Inline bodies can give the generated model type and Zod validator the same exported name, breaking the barrel export during library type checking.

**How to apply:** Give the input a semantic component name distinct from the generated operation's `*Body` name, then reference it from the endpoint.
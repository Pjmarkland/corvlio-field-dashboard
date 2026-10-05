---
name: Workspace package helper limitation
description: Avoid installing artifact runtime dependencies at the root when the package helper cannot target a pnpm workspace package.
---

The documented package-install helper ran at the workspace root and rejected
workspace/filter flags supplied as package tokens. Do not use a root install
merely to bypass that limitation for an artifact runtime dependency.

**Why:** the root pnpm safety check blocked the helper, and its token validator
also rejected the package-scoping flag. A package-scoped installation was needed
to keep the dependency in the actual server artifact rather than root tooling.

**How to apply:** consult the package-management and pnpm-workspace skills first.
If this helper limitation still exists, use an artifact-scoped package-manager
command rather than moving the dependency into the root. Verify current helper
capabilities before assuming this limitation is permanent.

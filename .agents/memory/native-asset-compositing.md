---
name: Native asset compositing
description: ImageMagick behavior to preserve fixed native icon and splash dimensions.
---

When generating native raster branding assets, resize each overlay inside a parenthesized image input and composite it onto an explicit canvas. When several catalog files are meant to be identical, generate one canonical PNG and copy it to the variants.

**Why:** Applying resize or geometry directly during a multi-image composite can cause ImageMagick to emit the overlay dimensions instead of the requested canvas. Repeated PNG encodes can also differ in metadata even when they render identically.

**How to apply:** Use explicit canvas dimensions for every iOS and Android asset, verify dimensions and corner colors with `identify`, and use `cmp` only after copying a canonical output when byte identity matters.
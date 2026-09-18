---
name: Browser navigation tests
description: Testing full-page redirects from React UI flows in the jsdom environment.
---

When a React flow uses `window.location.assign`, give the flow a small injectable navigation callback and pass a spy from the UI test.

**Why:** jsdom exposes `window.location.assign` as a non-configurable property, so replacing or spying on it breaks the test environment or triggers an unimplemented navigation.

**How to apply:** Keep the production default pointed at `window.location.assign`; inject only the callback in focused tests that need to assert the destination.
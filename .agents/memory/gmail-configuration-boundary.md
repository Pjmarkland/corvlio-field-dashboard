---
name: Gmail configuration boundary
description: Owner-controlled Google Cloud activation and consent requirements for replaying old lead emails.
---

Do not work around a disabled Gmail API with a different project or credentials.
The owner controls the Google Cloud configuration.

**Why:** The user explicitly said that Google Cloud activation is their responsibility.

Historical failed lead emails must stay unsent unless the admin explicitly selects
and confirms a retry batch. Do not use real client or prospect sends for verification.

**Why:** The user explicitly prohibited automatically resending the six old failures.

**How to apply:** Use mocked delivery for tests; provider configuration repair is
separate from an admin's decision to replay old notifications.

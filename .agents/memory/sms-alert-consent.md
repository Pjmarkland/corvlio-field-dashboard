---
name: SMS alert consent boundary
description: Corvlio's SMS owner-alert consent and delivery limits.
---

SMS alert consent is optional during onboarding. Only consenting business owners may receive lead texts about their own business; callers are never lead-alert recipients. Owners who do not opt in continue to receive the existing push and email alerts. Keep SMS sending disabled unless `SMS_ENABLED` is explicitly `true`, all required Twilio secrets are present, and the signed HTTPS inbound webhook URL is valid. Twilio webhook signature validation requires the account Auth Token in addition to API credentials. Do not activate SMS delivery until Twilio A2P approval is in place.

**Why:** The user requires SMS to remain fully off by default and Twilio A2P approval is still pending; Twilio's official webhook guidance requires the account Auth Token to validate signatures.

**How to apply:** Keep onboarding consent separate from required legal agreements, enforce affirmative consent and owner-number checks at every lead-alert send, honor STOP/START replies, and never let SMS failures affect existing push or email alerts.

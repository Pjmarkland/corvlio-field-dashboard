---
name: Onboarding website review
description: Product constraints for website suggestions, missing facts, and owner-approved business setup.
---

Website scraping is optional and preview-only. Never persist scraped suggestions in the background or use them to fill saved business profiles without owner review. Extract only clearly stated facts; unsupported or uncertain answers remain blank and visibly missing. Manual onboarding must remain available after any scraping failure.

**Why:** The user required review before saving and does not want the receptionist making unsupported claims from a website.

**How to apply:** Preserve these constraints when extending website intake or enrichment. Keep offered services separate from urgent-issue examples. Unknown hours and time zones must not become invented opening-hours claims.

Agent call quality is what the whole business is about. Require business type, offered services, service area, and urgent-call examples during new web onboarding. Website suggestions for required fields count only after the owner reviews them; owners can edit every suggestion.

**Why:** The user explicitly identified receptionist call quality as the product's central value.

**How to apply:** Keep these four intake facts required in new web onboarding while leaving other business guidance optional. Preserve owner review and editing for any website-prefilled values.

Hours found only in JSON-LD or other hidden metadata are unconfirmed suggestions, never automatically accepted business hours. Only customer-visible schedules may prefill; hidden hours need an explicit owner acceptance or manual entry. Rejecting a suggestion must clear untouched accepted hours without erasing owner edits.

**Why:** The user found hidden metadata schedules that contradicted customer-facing availability. These hours control the receptionist's open/closed statements to real callers; a wrong value is worse than a blank.

**How to apply:** Keep evidence and source links on both visible schedules and separate metadata suggestions. Warn about suggestions opening after 11:00 or closing after 22:00, including seven-day schedules ending at 23:59 alongside 24/7 advertising. Never turn emergency availability into general opening hours.

Refused services must describe explicitly refused kinds of work, never insurance billing, payment methods, scheduling, or warranty policies. Keep other policy notes separate from the receptionist's refused-services input.

**Why:** The user found an insurance-payment policy classified as refused work, which would make the receptionist wrongly decline insurance-related roof callers.

**How to apply:** Preserve both the extraction boundary and the owner's refusal warning. Missing offered services after a preview require owner input or explicit deferral, not an inferred trade-based list.

Evidence must support every fact in a value. Prefer literal, cited service names and policy excerpts over unchecked paraphrases; combined facts need combined quotes from the cited page.

**Why:** The user found added fees and commitments whose quotes did not support them.

**How to apply:** Keep evidence and source links through review; use nonblocking partial/manual entry results for network or extraction failures without weakening private-network protections.

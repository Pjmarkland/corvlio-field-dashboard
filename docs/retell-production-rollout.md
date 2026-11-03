# Retell production rollout — prepared, NOT executed

## Current verified state

- Shared agent version **0** and its LLM version **0** are published.
- Agent version **1** and its LLM version **1** are **unpublished drafts**.
- The draft's `webhook_url` is the development origin plus `/api/webhooks/retell/post-call`.
- The published agent's post-call destination is an existing **Make** webhook, not the development app.
- No agent, LLM, phone-number routing, knowledge base, or production deployment was changed in this batch.
- The configured `PUBLIC_API_BASE_URL` is the source of truth for production webhook URLs.
- Build the production results endpoint as `/api/webhooks/retell/post-call` on that configured HTTPS origin.
- Publishing alone DOES NOT rewrite the development webhook. Publishing the draft as-is would send its call results to development.

## Knowledge-base review: not a lossless replacement for the live sales agent

The published LLM references “Corvlio V2 Knowledge Base”, a PDF titled
“CORVLIO — DEMO AGENT KNOWLEDGE BASE”. It contains Corvlio agency information,
sales pricing/packages, setup promises, booking, transfer, calendar, SMS and
Make/Sheets claims. It is NOT an individual client business's intake record.

The draft clears its reference only. The PDF and the published version's reference
remain intact. No client-specific intake facts were found in this PDF, and
the draft obtains business facts from each business's saved configuration.

However, claiming that removing it loses nothing the live agent uses would be
incorrect: the live Corvlio sales/demo agent can use those agency FAQs and prices.
Do not replace that sales agent with this no-KB field receptionist unchanged.
Keep sales/demo numbers on the existing published version, or use a separately
approved agent/knowledge base for sales. Review and approve any retained claims
before a future release. No KB was deleted.

## Safe sequence — only after explicit approval

1. **Inventory and save the baseline (read-only first).**
   Obtain fresh deployment metadata and Retell agent/LLM versions. Record every
   existing phone's `inbound_agents`, `outbound_agents`, agent versions/weights,
   and `inbound_webhook_url`, plus any agent-specific overrides.
   Record the Make scenario's current lead/email workflow. Do not assume all
   numbers use the shared agent or the same routing. Retain version 0 and its KB.

2. **Decide which numbers are eligible.**
   Identify field-service numbers to migrate. Exclude Corvlio sales/demo numbers
   until their KB/prompt dependency has a separately approved replacement.
   Finish the unpublished owner demo-call review first. No number purchase is
   needed; normal Retell minutes apply.

3. **Pin current live number routes before publishing any shared-agent draft.**
   With explicit approval, pin references using `latest_published` to their
   current numeric published version (version 0 for this shared agent).
   Preserve weights, other agents, caller routing and pre-call webhook settings.
   Verify read-back. This prevents publishing a new version from silently
   switching every existing live number at once. Never edit published version 0.

4. **Publish the backward-compatible app first, not the agent.**
   After approval, apply the additive schema changes to production through the
   approved database migration flow and publish the app. Confirm production has
   its existing Retell signature key, Gmail configuration and correct APNs
   environment. The post-call endpoint must be public but require valid Retell
   signatures. Confirm unsigned requests receive 401, and run signed synthetic
   TEST events to verify exclusion without creating real leads or alerts.
   Confirm both legacy and canonical analysis fields remain supported.
   Demo dialing is intentionally development-only and remains 404 in production.

5. **Prepare an unpublished production-ready agent version.**
   After explicit approval, set only the unpublished release candidate's
   `webhook_url` to the production endpoint above. Ensure `webhook_events`
   includes both `call_ended` and `call_analyzed`, and read back the exact
   production URL and unpublished status. Verify the attached LLM version is
   the reviewed candidate. Do not publish a development URL.
   Keep a development candidate for future demos, or disable development demos
   when no unpublished candidate exists.

6. **Check pre-call routing separately.**
   The agent's post-call webhook does NOT configure per-number inbound hooks.
   Confirm each pilot number's `inbound_webhook_url` uses the intended production
   pre-call route `/api/webhooks/retell/pre-call`, preserving current routing
   until an approved change is needed. Test correct business variables, hours,
   timezone and isolation. Keep missing-signature compatibility unchanged until
   genuine inbound signature coverage has been reviewed.

7. **Publish the reviewed Retell candidate only after approval.**
   Use Retell's supported publication workflow and verify both the agent and
   attached LLM are published with the production results endpoint. Live
   numbers remain pinned to the prior version at this point.

8. **Move one approved existing pilot number to the numeric new version.**
   Preserve all unrelated phone settings. Make one authorized real inbound
   review call; verify greeting, business isolation, spoken callback, ended/
   analyzed reconciliation, exactly one lead, one alert event, email delivery,
   badge, registered-device APNs and safety/after-hours behavior.
   Confirm which records are now in the app versus the old Make/Sheets workflow.
   Do not run both email-producing pipelines for the same calls. Keep the old
   Make scenario available for pinned old-version calls, not duplicated traffic.

9. **Expand gradually or roll back the pilot.**
   Move only approved field numbers after the pilot passes. On any failure,
   restore that number's saved numeric old version and pre-call routing.
   The old published agent, LLM, KB and Make destination must still be available.
   Do not delete or release numbers, remove the old Make workflow, or delete the
   sales KB as part of this rollout.

## Verification still required

- Carrier/account acceptance of an explicitly selected unpublished outbound
  version and per-call development webhook, using an existing number.
- Actual voice/recognition, caller ID, confirmation, interruption, after-hours
  messages, hangups, signed provider events and demo exclusion.
- Real mailbox delivery and native iPhone permission/token/APNs delivery;
  configured credentials and mocked tests do not prove delivery.
- Browser web push, Android push and SMS are not enabled. Capacitor iOS uses
  native APNs, not browser service-worker push.
- First event delivery starts immediately when a new real lead is persisted
  at call end; it cannot precede Retell's call-ended webhook. Late analysis
  updates do not create a second alert. In-app badges refresh every two seconds
  while the app is visible. Offline devices and provider retries add delay.
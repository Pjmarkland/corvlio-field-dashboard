# Corvlio outage runbook

**Status:** Owner operating guide. Production provider routes and the exact audio
callers hear during an outage have not been verified. Use
[the inbound-call fallback runbook](./call-fallback-runbook.md) for the limits
and configuration of Retell and Twilio failover.

## First response for any outage

1. Confirm the affected business number and the time the problem began. Do not
   change a shared Retell agent, release a number, or test by taking another
   client's live line offline.
2. Place one owner-approved test call from a separate phone. Record what
   actually happened; do not infer caller audio from a dashboard status.
3. Check the published app's health URL. Copy the production host from Replit's
   **Publishing** tool, then append `/api/health/launch`.
   - `200` with `{"status":"ok","database":"available"}` means the API answered
     and could run a simple database query at that moment.
   - `503` with `{"status":"degraded","database":"unavailable"}` means the API
     answered but could not query its database.
   - A timeout or non-JSON error means the check itself did not complete.
     It does not identify the cause.
4. Check the relevant provider's dashboard/status notices and Replit's
   deployment and billing screens.
5. If a tested, staffed fallback is available, ask the business owner before
   enabling it. Record the setting and restore normal routing after the
   incident. Do not promise a caller what the route will do until it has been
   tested on that exact number.
6. Tell the client what is confirmed, what is still being checked, and when you
   will update them. Give an alternate contact only if the client has approved
   it and someone will answer.

## Replit deployment or API server is unavailable

**What callers may experience:** If the API server is unreachable, it cannot
answer Retell's pre-call request or play a message. The caller may hear a
provider error, a timeout, or a configured provider-level fallback. Which
outcome applies to a number is unverified. If the published app is offline, the
website and owner dashboard may also be unavailable.

**How to recognize it:** The health URL times out, returns an unexpected error,
or cannot be reached; Replit Publishing may show the deployment as stopped,
failing, or suspended. Confirm with an owner-approved test call.

**First 10 minutes:**

- **Minutes 0–2:** Check the published URL and the exact inbound number. Record
  the time, response, and caller result.
- **Minutes 2–5:** In Replit, inspect **Publishing** and **Billing**. If the
  account is out of credits or has a payment issue, check whether the deployment
  is actually suspended and resolve the billing notice. Zero credits alone do
  not prove why an app is down: Replit's overage eligibility and suspension
  behavior can vary by account.
- **Minutes 5–10:** Check deployment logs and Replit service notices. If the
  deployment is running but the health endpoint still fails, contact the
  Corvlio technical maintainer. Do not republish repeatedly or change secrets
  without identifying the failure.

**Who to contact:** The Replit account owner for billing and Publishing access;
Replit Support if the account or deployment remains suspended; the Corvlio
technical maintainer if the deployment runs but the API is unhealthy.

**Client update:**

> We are checking an issue affecting the hosted call service. We have not
> confirmed what callers hear on your line yet. Please use [approved alternate
> number] until [time of next update]. We will update you when we have tested
> the route.

## PostgreSQL is unavailable

**What callers may experience:** If the API is still running, the Retell pre-call
handler can return generic dynamic variables after a failed business lookup.
The Retell agent's prompt determines what the caller actually hears. A lead may
not be saved while the database is unavailable. Neither the spoken message nor
successful lead capture should be promised until tested.

**How to recognize it:** The health URL returns `503` with
`database: "unavailable"`, or the owner dashboard reports database-related
errors. A `200` health response only confirms a simple database query; it does
not test every app feature.

**First 10 minutes:**

- Recheck the health URL once and record the result and time.
- Check Replit **Database → Production** and account notices. Do not run a
  production migration, restore, or destructive query as an outage workaround.
- If the database is paused, follow the owner-controlled Replit recovery
  process. If it is not paused, send the database error and timestamp to the
  Corvlio technical maintainer or Replit Support.
- Avoid test calls that could be mistaken for real leads. After recovery, verify
  a new controlled call and lead before telling the client service is restored.

**Who to contact:** The Replit database owner and Replit Support for a managed
database incident; the Corvlio technical maintainer for application/query
errors. See [production database recovery](./production-database-recovery.md).

**Client update:**

> We found a database problem affecting the hosted service. Lead capture may be
> delayed or unavailable while it is investigated. Please use [approved
> alternate contact] for urgent requests. We will confirm recovery with a test
> before asking you to resume normal use.

## Retell is unavailable or calls are failing in Retell

**What callers may experience:** The result depends on Retell's current service
and the settings on the exact phone number. Calls may fail or may reach a
configured fallback. The app's stored fallback number and Retell's concurrency
fallback do not prove that provider-outage forwarding is enabled. Backup mode
is a manual diversion control, not proof of automatic API health failover.

**How to recognize it:** Retell's dashboard reports call/API failures, the
owner's test call does not complete normally, or Retell reports an incident.
Compare the call record and timestamps with the Corvlio health check.

**First 10 minutes:**

- Verify the Corvlio health URL. If it is healthy, avoid changing the app or
  database while checking the provider route.
- Check Retell call records and provider notices. Confirm whether the affected
  number is Retell-managed or enters through Twilio.
- If there is a previously tested fallback, get the business owner's approval
  before enabling it for that number. Confirm the destination is staffed and
  does not create a forwarding loop.
- Contact Retell Support with the affected number, call time, and call ID. Do
  not send caller transcripts or personal details unless the provider needs
  them and the owner approves.

**Who to contact:** Retell account administrator and Retell Support; the
Corvlio technical maintainer if Retell can reach the API but the callback
fails.

**Client update:**

> We have confirmed that calls through the receptionist provider are failing.
> The approved alternate contact is [number]. We are checking the provider
> route now and will test your number before restoring normal forwarding.

## Twilio is unavailable or calls are failing through Twilio

**What callers may experience:** This applies only when the affected voice call
actually enters Twilio. If Twilio is used only for text messages, the inbound
voice call may be unaffected. For a Twilio voice number, callers may get a
provider failure or a configured Twilio fallback. A Retell-to-Corvlio callback
failure may not trigger a Twilio phone-number fallback; the topology must be
tested.

**How to recognize it:** Check Twilio's [service status](https://status.twilio.com/),
the affected account's call records, and the Corvlio health URL. Confirm whether
the number's live route uses Twilio Voice, SMS only, or a SIP trunk.

**First 10 minutes:**

- Confirm the failure is on the affected Twilio product and voice route, not
  just an unrelated SMS or console issue.
- Check the configured primary handler and provider fallback without changing
  them. Use an approved test number for any failure simulation.
- If the provider is reporting an incident, open a Twilio support case with the
  call SID and timestamp. Ask the business owner before redirecting live calls.

**Who to contact:** The Twilio account administrator and
[Twilio Support](https://help.twilio.com/); the Corvlio technical maintainer
for application webhook failures.

**Client update:**

> We have confirmed a problem on the phone-routing path for your number.
> [Approved alternate number] is available for urgent calls. We will test the
> route and confirm before normal service resumes.

## Gmail lead or admin email delivery is failing

**What callers may experience:** A Gmail delivery issue does not itself change
what a caller hears. A lead may still be stored in Corvlio, while its email
notification is delayed or missing. If the API or database is also down, use
those outage sections instead.

**How to recognize it:** Open **Admin → Activity → Email health**. Review the
last successful send, latest failure, and the displayed cause. The test-email
button sends one message to the signed-in admin only.

**First 10 minutes:**

- Confirm the Corvlio health endpoint is healthy and inspect the Admin email
  health section.
- Send the built-in test email to the signed-in admin account. Do not use a
  client recipient for the test.
- Check that the production deployment has the required Gmail configuration
  and `ADMIN_EMAILS` in Replit's **Production app secrets**, not only in
  development secrets. Never paste secret values into chat or source files.
- Check Google Workspace service notices and the Google Cloud project admin's
  OAuth configuration. Do not rotate credentials during an incident without
  the project owner.
- Do not retry old failed lead emails as a batch without reviewing the exact
  recipients and getting approval; retries send real messages.

**Who to contact:** The Google Cloud/Workspace project administrator; Google
Workspace Support if there is a provider-side incident; the Corvlio technical
maintainer if the app reports a configuration or delivery error.

**Client update:** Usually no immediate caller-facing message is needed. If a
client asks about a missing alert, say:

> Your call record is available in the Corvlio dashboard. We are checking the
> email notification path and will confirm when delivery is working again.

## A client's number is misrouted

**What callers may experience:** Callers may reach the client's voicemail,
another number, or a receptionist greeting for the wrong business. Do not
assume the Corvlio agent answered, or that a provider fallback caught the call.

**How to recognize it:** The owner or caller reports the wrong destination or
greeting; a controlled call does not appear for the intended business; or the
lead appears under the wrong business. Check the number assignment and route
before changing anything.

**First 10 minutes:**

- Ask the client to stop changing forwarding settings and place one test call
  with you from a separate phone.
- Confirm the original business number, the Corvlio number assigned to that
  business, and which party answered. Do not share one client's call details
  with another.
- If the call is going somewhere unsafe or unintended, ask the client to
  disable forwarding using their carrier's verified instructions while you
  stay on the call. Do not guess a dial code.
- If forwarding reaches Corvlio but the wrong business greeting answers, pause
  additional changes and contact the Corvlio technical maintainer with the
  destination number and test time.
- Restore forwarding only after a new test reaches the correct business and
  creates the expected lead.

**Who to contact:** The client's authorized phone-line administrator and their
carrier; the Corvlio technical maintainer if the correct Corvlio number is
assigned to the wrong business or agent.

**Client update:**

> We confirmed that a test call is reaching [observed destination]. We are
> correcting the route with you. Until we verify another call, please use
> [approved alternate number] and do not change the forwarding settings again.

## References

- [Replit: Publishing](https://docs.replit.com/features/publishing/overview)
- [Replit: Billing and refunds](https://docs.replit.com/help/billing-and-refunds)
- [Google Workspace Status Dashboard](https://www.google.com/appsstatus/dashboard/)
- [Twilio status](https://status.twilio.com/)
- [Corvlio inbound-call fallback runbook](./call-fallback-runbook.md)
- [Corvlio production database recovery](./production-database-recovery.md)

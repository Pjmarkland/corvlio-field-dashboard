# Corvlio inbound-call fallback runbook

**Status:** Provider configuration is unverified. This document describes the
application behavior and the owner-controlled provider checks. No live Retell or
Twilio settings were inspected or changed.

## What the application can and cannot do

- If the API is reachable but the pre-call business lookup fails, the
  `/webhooks/retell/pre-call` handler can return generic dynamic variables. The
  Retell agent's prompt and voice configuration decide what the caller hears;
  the application code does not establish the exact spoken sentence.
- If the API server itself is unreachable, it cannot return those variables,
  play audio, or start voicemail. The caller experience is controlled by the
  provider route configured on the exact inbound number. The production route
  and resulting caller audio have not been verified.
- The business/global fallback number stored in Corvlio is application data.
  It is available only when the API can answer the pre-call request; it is not
  proof that provider-level outage forwarding is active.
- Retell's `fallback_number` and `inbound_fallback_enabled` settings are
  documented for inbound concurrency saturation: when no slot opens after
  approximately 40 seconds, the call can transfer to the configured number.
  That behavior is not documented as a failover for an unavailable Corvlio
  pre-call endpoint.
- Retell's separate **Backup mode** sends new calls directly to a configured
  fallback number while enabled. It is an incident control that pauses AI
  handling on that number, not an automatic health check of Corvlio.

Therefore, **what callers currently hear during a full API outage is unknown**.
It depends on the live number's provider configuration and must be verified
with an owner-approved test number.

## Owner setup and verification

### 1. Inventory the call path first

For every production inbound number, record its owner and exact call path:

1. In Retell **Phone Numbers**, identify the number type and its assigned agent,
   inbound webhook, fallback number, and Backup mode state.
2. Identify whether calls enter through a Retell-managed/imported number, a
   Twilio Programmable Voice number, or a Twilio Elastic SIP Trunk.
3. Confirm whether any Twilio configuration is for voice or only for SMS.
   An SMS fallback does not protect an inbound voice call.
4. Do not change the Corvlio sales/demo number or shared-agent routing as part
   of this check. Use a separate, owner-approved test number.

### 2. Retell-managed or imported number

1. In **Phone Numbers**, select the approved test number.
2. Under **Fallback Number**, enter a staffed destination in E.164 format and
   save it. Confirm that the destination is not the same number and does not
   create a forwarding loop.
3. If the goal is capacity/concurrency overflow, enable
   `inbound_fallback_enabled` for that number and test the concurrency path.
   This is not a substitute for an app-server outage route.
4. If the goal is to divert all new calls during an incident, use **Backup
   mode** for the test number. Confirm it sends calls directly to the fallback
   destination, then turn it off and verify normal AI routing resumes.
5. Confirm the fallback destination is monitored and can accept the expected
   call volume. A failed connection to the fallback destination can still end
   the call.
6. Ask Retell support to confirm the behavior when this number's inbound
   webhook/pre-call request times out or the Corvlio API is unreachable. Do not
   assume the concurrency fallback handles that failure.

### 3. Twilio Programmable Voice number

Only use these settings if the call actually enters Twilio and Twilio directly
requests a primary voice handler:

1. Open **Twilio Console → Active Numbers → [test number] → Voice
   Configuration**.
2. Confirm the primary **A call comes in** handler and its HTTP method.
3. Under **Primary handler fails**, set an owner-controlled HTTPS Fallback URL
   and its method. The fallback must return valid TwiML, such as a short
   outage message followed by an approved voicemail-recording flow or redirect
   to a staffed line.
4. Save and make a test call with the primary handler deliberately unavailable
   in a safe test environment. Verify the caller hears the fallback message and
   the voicemail/transfer reaches its intended destination.

Twilio requests this Fallback URL when it cannot retrieve or execute TwiML from
the configured primary handler. If the Twilio request to Retell succeeded and
Retell later cannot reach Corvlio's pre-call endpoint, Twilio may not see that
upstream failure. Test the exact topology; do not assume Twilio's phone-number
Fallback URL covers a Retell-to-Corvlio webhook failure.

### 4. Twilio Elastic SIP Trunk

If Twilio sends inbound SIP calls to Retell through an Elastic SIP Trunk, review
**Elastic SIP Trunking → Trunks → [trunk] → Origination**. Twilio's **Disaster
Recovery URL** is used when none of the configured origination SIP URIs can
accept the call. It must return valid TwiML and can speak a message, take
voicemail, or redirect. This protects the SIP-origination failure case; it does
not necessarily detect a later Retell-to-Corvlio pre-call callback failure.

Test this separately from the phone-number Voice Fallback URL.

## Test record to keep

For each provider number, record the test date, test number, primary route,
failure deliberately simulated, caller's exact heard message, voicemail or
transfer result, and how normal routing was restored. Do not test by taking a
live customer number offline without owner approval.

## References

- [Retell: Receive calls and Backup mode](https://docs.retellai.com/deploy/inbound-call)
- [Retell: Update phone number API](https://docs.retellai.com/api-references/update-phone-number)
- [Twilio: Availability and reliability](https://www.twilio.com/docs/usage/security/availability-reliability)
- [Twilio: Voice failover best practices](https://www.twilio.com/docs/voice/twilio-voice-failover-best-practices)

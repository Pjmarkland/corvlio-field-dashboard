# Corvlio first-client playbook

Use this playbook with the first real client. Complete the seven checklist
items in this order; they match the labels in the admin checklist. Do not mark
a step complete until its evidence is in place.

## 1. Business details reviewed

**Founder:** Review the business name, service area, hours and time zone,
services offered, callback expectations, and any important limits on what the
receptionist may say. Read the details back to the owner and have them correct
anything inaccurate.

**Say:**

> I have your business as [name], serving [area], with hours [hours and time
> zone]. The receptionist can collect [approved details] and should not promise
> [unapproved services, prices, or timing]. What should I correct?

**Complete when:** The owner has approved the saved details and the intended
greeting and after-hours behavior.

## 2. Plan assigned

**Founder:** Select the agreed plan in the admin dashboard. Review the plan's
included call allowance and any limits with the owner. A usage alert is a
notice, not a call-blocking limit or a dollar-cost cap.

**Say:**

> Your selected plan is [plan]. It includes [confirmed allowance and terms].
> If you expect usage beyond that, we'll review it with you before changing
> your plan.

**Complete when:** The saved plan matches the signed or otherwise documented
agreement and the owner understands the included allowance.

## 3. Payment confirmed

**Founder:** Confirm the first payment has cleared, or confirm the agreed
manual invoice is paid. A submitted payment or emailed invoice is not the same
as a cleared payment. Do not convert an existing manual-invoice client to
Stripe automatically.

**Complete when:** The payment record or paid invoice is verified and the
agreed service start date is recorded.

## 4. Phone line provisioned

**Founder:** Confirm the assigned receptionist number is provisioned and
associated with the correct business. Record the number in the owner's setup
notes. Verify the live route for that number before forwarding the client's
existing public number to it.

**Say:**

> Your receptionist number is [number]. We will now test that number directly,
> then connect your existing business line if you approve.

**Complete when:** A direct test call reaches the correct business greeting,
and the expected lead appears under that business.

## 5. My test call done

Make the first test call before changing the client's public number. Use a
phone controlled by the founder or client. Tell the owner first: the call is
handled as a regular call and may create a lead and send the owner's normal
notification. Do not use a real prospect's contact details. Do not mark a test
lead as spam just to hide it.

**Test script:**

> Hi, I'm making a test call for [business name]. I need help with [approved
> service]. The service location is [non-sensitive test location]. My preferred
> callback time is [time]. This is a test; please do not book or promise an
> appointment. Could you repeat the request and callback details you captured?

After the call, check the call record, greeting, business name, captured request,
callback number, hours/time zone, and owner notification. Correct inaccurate
business details before forwarding customer calls.

**Complete when:** The direct test call reaches the expected agent, the lead is
saved under the right business, and the owner has reviewed the result.

## 6. Owner call forwarding set up and verified

First decide which behavior the owner wants:

- **All calls to the receptionist:** use immediate/unconditional forwarding.
  The owner's phone generally will not ring first, and voicemail behavior may
  change.
- **Owner's phone rings first:** ask the carrier about busy/no-answer
  forwarding and its delay. Test what happens when the owner answers, is busy,
  and does not answer.

Do not enable forwarding without the owner's approval. Forward the existing
public business number to the assigned Corvlio number, not to a number copied
from a development preview. The owner performs the carrier change; Corvlio
does not change it for them.

### Wireless carrier instructions

These are carrier-published US wireless instructions, not a guarantee for a
particular plan, prepaid line, device, or business account. Verify the
instructions with the carrier before changing a live number. For landlines,
MVNOs, PBX systems, and business VoIP, use the provider's own guide.

**Verizon Wireless**

- Immediate forwarding: from the Verizon phone, dial `*72` followed by the
  10-digit Corvlio number. Wait for the confirmation beeps and let the call
  end.
- Busy/no-answer forwarding: dial `*71` followed by the 10-digit destination.
- Turn off immediate forwarding: dial `*73`.
- Verizon notes that star codes may not work outside its wireless coverage
  area. If a code fails, contact Verizon rather than trying alternate codes.

**AT&T Wireless**

- AT&T's general wireless guide says forwarding settings must be changed from
  the wireless phone, not online. Use AT&T's device-specific Call Forwarding
  tutorial for the exact phone and plan; do not assume one universal dial code.
- Confirm how to turn forwarding off in the same device-specific guide.
- AT&T notes that forwarding overrides wireless voicemail and that forwarded
  calls may be billed or incur long-distance charges.

**T-Mobile**

- Immediate/unconditional forwarding: dial `**21*1` followed by the 10-digit
  Corvlio number and `#`, then send the call. To turn it off, dial `##21#`.
- No-answer forwarding: dial `**61*1` followed by the 10-digit destination and
  `#`. To turn it off, dial `##61#`.
- The T-Mobile short-code guide also lists separate codes for busy and
  unreachable conditions. Confirm the exact code and plan support before using
  those settings. T-Mobile warns that some plans do not support all
  self-service short codes.

### Verify the call path

1. In the owner's Settings, select **Start forwarding check** before calling.
2. Call the existing business number from another phone.
3. Confirm the intended greeting, correct business, captured request, and lead
   in the dashboard. The forwarding check is satisfied when a new lead arrives
   after it was started; the app does not inspect the carrier's forwarding
   setting directly.
4. The test call appears as a regular lead and may send normal notifications.
   Handle the test record according to the owner's retention practice.
5. If the check does not pass, disable or correct forwarding with the carrier
   and repeat only after the destination is confirmed.

**Complete when:** The owner approves the forwarding behavior and a test from
another phone reaches the correct business and creates the expected lead.

## 7. First-week check-in done

Schedule the check-in for the first seven days after the service starts. Review
call quality and records with the owner; do not share caller details with
anyone who is not authorized.

**Check-in message:**

> Subject: Corvlio first-week check-in
>
> Hi [owner], we've completed the first-week check-in. Are the greeting,
> business details, and callback expectations still accurate? Have any calls
> been misrouted, missed, or captured incorrectly? Please send the call date
> and time and a brief description through [approved support channel]; avoid
> sending full caller details by ordinary email. We'll review the specific
> record with you and agree on any changes before updating the live setup.

Review the owner's feedback, any misrouted or missed calls, lead follow-up
status, usage alerts, and email delivery health. Do not change a shared agent,
plan, or phone route without recording the reason and getting the required
approval.

**Complete when:** The owner has reviewed the first week, open issues have an
owner and next step, and the check-in is recorded.

## Carrier references

- [Verizon: Turn call forwarding on from device](https://www.verizon.com/support/knowledge-base-181139/)
- [AT&T: Call forwarding for wireless](https://www.att.com/support/article/wireless/KM1011513)
- [T-Mobile: Calling services](https://www.t-mobile.com/support/plans-features/calling-services)
- [T-Mobile: Self-service and short codes](https://www.t-mobile.com/support/plans-features/self-service-short-codes/)

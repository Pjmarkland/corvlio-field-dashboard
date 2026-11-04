# Corvlio founder launch checklist

This is the founder's ordered owner-action list. It separates launch blockers
for the first paying **web** client from work that can wait. App Store tasks
block an iOS App Store launch, not an independently tested web-client launch.

Do not treat a payment alert as a hard spending limit, a health check as a
provider failover, or a Reserved VM as protection from billing suspension.

## Ordered owner actions

1. **[BLOCKS FIRST PAYING CLIENT] Confirm the offer and service boundary.**
   Record the plan, price, included call allowance, start date, payment method,
   cancellation/support terms, and what the receptionist is allowed to promise.
   Make clear that app usage alerts do not block calls or estimate a dollar
   invoice. Keep existing manual-invoice clients on their agreed path; do not
   convert them to Stripe automatically.

2. **[BLOCKS FIRST PAYING CLIENT] Secure the founder's administrator account.**
   The app uses an external Clerk tenant. Workspace access to its administrator
   settings is unavailable, so the tenant owner must confirm MFA is enabled for
   the founder/admin identity and verify a fresh sign-in. Do not treat a
   development login as proof of production access.

3. **[BLOCKS FIRST PAYING CLIENT] Set the production admin allowlist.**
   In Replit's **Publishing → Production app secrets**, set `ADMIN_EMAILS` to
   the comma-separated admin email addresses. Each address must be verified and
   be the primary email on its Clerk account. Keep the list limited to people
   who need admin access. Production secrets are separate from development
   secrets; never put their values in code, documents, or chat.

4. **[BLOCKS FIRST PAYING CLIENT] Set provider cost alerts and verify limits.**
   - In Retell, create an Alerting rule for total call cost with a budget
     threshold and an email or webhook recipient.
   - If the live voice route uses Twilio, create an Account Usage **Usage
     Trigger** for the relevant voice category and choose its notification
     recipient.
   - These provider features notify; they are not hard stops. Confirm directly
     with each provider whether the account has a separate spend cap or
     automatic stop, what it covers, and whether usage can continue after the
     threshold. Do not begin a paid pilot without a reviewed budget and an
     owner who will receive alerts.
   - Corvlio's own call-minute and number thresholds are operational alerts,
     not dollar caps or call-blocking controls.

5. **[BLOCKS FIRST PAYING CLIENT] Inventory and test the exact call path.**
   For every pilot number, record whether calls use Retell-managed telephony,
   Twilio Voice, a Twilio SIP trunk, or another route. Confirm the assigned
   business and agent, the pre-call route, any fallback number, and who answers
   the fallback. Follow the separate [inbound-call fallback runbook](./call-fallback-runbook.md).
   Do not claim API-outage failover until the exact provider route has been
   tested on an owner-approved number.

6. **[RECOMMENDED BEFORE FIRST PAYING CLIENT] Check production domains before
   changing deployment type.** Ask the Corvlio technical maintainer to search
   production-facing configuration for `.replit.dev`, `localhost`, and
   `REPLIT_DEV_DOMAIN`. Confirm the live app uses the HTTPS production API
   origin shown in Replit's **Publishing** tool, including the configured
   `PUBLIC_API_BASE_URL`. Dev-only references may remain only when they are
   explicitly guarded as development-only. Do this before the Reserved VM
   switch; do not point a live Retell webhook at a development URL.

7. **[RECOMMENDED BEFORE FIRST PAYING CLIENT] Choose and verify the deployment
   type.** If the service needs continuously provisioned compute, change the
   deployment to **Reserved VM** in Publishing after the domain check and review
   its fixed monthly cost. A Reserved VM provides continuously running,
   consistent compute; it does not prevent suspension for billing issues or
   protect against database, provider, or application failures. If keeping the
   current deployment type, document why it is suitable and test its behavior
   under the expected call traffic.

8. **[BLOCKS FIRST PAYING CLIENT] Review production secrets and schema.**
   Confirm required production-only configuration is present in **Production
   app secrets**, including the correct Clerk, API, Retell, email, and session
   settings for this deployment. Do not copy development callback URLs or
   secret values. Before Publish applies schema changes, inspect the production
   database diff. Approve only understood changes; stop for unexpected drops,
   truncation, or drop-and-recreate renames. Never use an overwrite-production
   data option.

9. **[BLOCKS FIRST PAYING CLIENT] Publish deliberately and verify the live
   app.** Publish the API service and web dashboard through their Replit
   Publishing tools. Use the production URLs shown there; do not construct a
   URL from a preview domain. If an API URL becomes available only after its
   first publish, set the dependent production configuration to that exact
   HTTPS URL and republish the dependent service. Confirm owner sign-in, the
   correct business, lead creation, and the approved call route. No publish is
   performed by this checklist.

10. **[BLOCKS FIRST PAYING CLIENT] Configure an uptime monitor.** Use an
    external monitor that can request the production URL copied from Publishing
    plus `/api/health/launch`. Alert on non-200 responses or a response other
    than `status: "ok"` and `database: "available"`. Replit's own active
    monitoring can supplement this. The endpoint verifies API reachability and
    a simple database query only; it does not check Retell, Twilio, Gmail,
    authentication, or every database operation.

11. **[BLOCKS FIRST PAYING CLIENT] Verify database recovery readiness.** If the
    app uses Replit-managed PostgreSQL, confirm a recent production restore
    point and record its displayed time and retention. If it uses another
    provider, use that provider's backup process. A listed backup is not a
    successful restore drill. Do not restore over live production as a test;
    see [production database recovery](./production-database-recovery.md).

12. **[BLOCKS FIRST PAYING CLIENT] Complete the client setup in order.** Follow
    the seven items in the [first-client playbook](./first-client-playbook.md):
    business details reviewed; plan assigned; payment confirmed; phone line
    provisioned; My test call done; Owner call forwarding set up and verified;
    First-week check-in done. Use only a client-approved test call and route.

13. **[AFTER FIRST CLIENT] Complete the first-week check-in.** Review the
    owner's call-quality feedback, lead capture, forwarding, notifications, and
    usage alerts. Resolve or assign every issue before changing the live route.
    Record the client's approval and the next check-in date.

14. **[AFTER FIRST CLIENT] Review service and provider spend.** Compare actual
    call minutes and provider costs with the agreed budget. Check each provider's
    alert delivery and the Corvlio admin alerts. Revisit the budget before
    onboarding another client; do not assume one client's usage predicts
    another's.

15. **[CAN WAIT FOR WEB CLIENTS; BLOCKS AN IOS APP STORE LAUNCH] Finish native
    App Store decisions and release checks.** Complete the reviewer account,
    Sign in with Apple review, privacy disclosures, account-deletion policy,
    physical-device testing, and iOS archive/signing. Decide what to do with the
    native external billing link before submission. See
    [App Store readiness](./app-store-readiness.md) and the detailed
    [review checklist](./app-store-review-readiness.md). Do not change the
    native billing link until the owner has chosen an option.

## Owner log

Keep a small private operations record with the date, who completed each step,
the relevant production URL or provider number (not credentials), test result,
and unresolved owner. Do not store passwords, tokens, reviewer credentials, or
full caller details in this document.

## References

- [Replit: Deployment types](https://docs.replit.com/features/publishing/deployment-types)
- [Replit: Publishing](https://docs.replit.com/features/publishing/overview)
- [Replit: Monitoring a deployment](https://docs.replit.com/features/publishing/monitoring-a-deployment)
- [Replit: Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
- [Retell: Alert rules for call and chat metrics](https://docs.retellai.com/features/alerting-overview)
- [Twilio: Usage triggers](https://support.twilio.com/hc/en-us/articles/55716593836315-How-do-I-get-notified-when-my-Twilio-usage-passes-a-threshold)

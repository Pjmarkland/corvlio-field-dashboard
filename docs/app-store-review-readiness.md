# Corvlio App Store review readiness

**Status:** Working draft for owner review. No App Store submission, production
Clerk settings, or Xcode archive was inspected or changed.

## Reviewer account and safe demo

Use **Admin → Overview → App Review Demo** to create or refresh the sample
business and its eight fictional leads. The reset is limited to the tagged demo
records and refuses to proceed if it finds real activity, billing, number
provisioning, or notifications. The demo does not purchase a number or create a
Clerk identity. Sample caller numbers use only the reserved fictional
`202-555-0100`–`202-555-0199` range.

1. Create a dedicated reviewer identity in the configured Clerk tenant and sign
   in once so the identity exists.
2. Link that exact identity from the App Review Demo panel. Use a verified email
   unless the owner explicitly authorizes the exact-match admin override.
3. Sign in to the submitted iOS build with that reviewer identity and confirm
   the sample business and leads load.
4. Put reviewer credentials only in App Store Connect's secure review-account
   fields. Do not put credentials in this document, source code, or chat.
5. Keep the account active and backend available during review. Do not reset or
   unlink the sample while review is in progress.

### App Review Notes draft

Replace every bracketed value and test the final instructions from a clean
device before submitting:

> Corvlio helps service-business owners receive and follow up on customer calls.
> Sign in using **[REVIEWER SIGN-IN METHOD]** with **[REVIEWER ACCOUNT EMAIL]**.
> The reviewer account is linked to **App Review Demo**, a clearly marked
> sample business with eight fictional leads. The demo uses reserved fictional
> caller numbers and does not place calls or provision a phone line. Open the
> business dashboard to review the sample lead list. All account-dependent
> screens require an active network connection to Corvlio's hosted service.
> **[ADD ANY REVIEWER-SPECIFIC STEPS OR FEATURES THAT NEED EXPLANATION.]**

Enter any password or verification instructions in App Store Connect's secure
review fields, not in the Notes text above.

## Sign in with Apple decision

The development preview showed Google and email sign-in, with no Apple option.
The live Clerk sign-in methods are **unverified** because external Clerk
dashboard access was unavailable. Before submitting:

1. Inspect the production Clerk instance and the exact sign-in screen in the
   Release build. Do not infer production methods from the development preview.
2. Review Apple's current [App Review Guideline 4.8](https://developer.apple.com/app-store/review/guidelines/)
   against the actual account-creation and primary sign-in flow.
3. If a third-party/social sign-in service is used as the primary account
   sign-in and no documented exception applies, add and test Sign in with Apple
   in the iOS build. If relying on a business-app or other exception, record
   why it applies and provide the relevant explanation to App Review.
4. Verify email privacy, account linking, account deletion, and sign-in recovery
   from the same production configuration the reviewer will use.

No production Clerk provider settings were changed.

## App Privacy disclosure worksheet

Apple requires disclosure of data collected by the app and its integrated
partners, including whether data is linked to an account or used for tracking.
This is a draft inventory, not a completed App Store Connect privacy label.
The owner must verify current production SDKs, provider retention settings, and
the app's privacy policy before submission.

| Candidate data | Why Corvlio uses it | Likely disclosure treatment to verify |
| --- | --- | --- |
| Owner name, email, phone, and account identifier | Sign-in, account support, owner notifications, and business setup | Contact Info and Identifiers; linked to the owner account |
| Caller name, phone number, service address, and request details | Create and follow up on a service lead | Contact Info and User Content; associated with the receiving business |
| Call transcript, call time, duration, and outcome | Lead capture, call history, quality review, and usage monitoring | User Content and Usage Data; verify what Retell stores and for how long |
| Call audio, if recording is enabled by the provider | Call handling and review | Audio Data; confirm the production Retell recording and retention settings |
| Push token and device/platform data | Deliver owner alerts to registered devices | Identifiers and Diagnostics or Other Data; linked to the signed-in owner |
| Plan, invoice, payment status, and billing support records | Account administration and manual/Stripe billing | Purchases or Financial Info as applicable; Stripe-hosted payment-card collection must be reviewed separately |
| Operational failure events and basic call metrics | Reliability, founder alerts, and plan/usage monitoring | Diagnostics and Usage Data; not intended for advertising |

**Tracking:** The reviewed code does not indicate an advertising use for these
records. This is not a complete third-party SDK or provider audit. Confirm
whether Clerk, Retell, Stripe, Twilio, email delivery, or any other production
partner collects data for tracking or advertising and answer App Store Connect
accordingly. Do not mark “not used for tracking” until those partner practices
and the final native dependency list have been checked.

**Data linked to a user:** Account, business, billing, device, and lead records
are generally associated with an owner or business account. Caller contact and
request information is collected for the business's call-intake service. Verify
the final descriptions and retention periods against the published privacy
policy.

**Deletion:** The app has an account-deletion flow, but the existing
`docs/ios-app-store-hardening.md` records an unresolved policy question for
accounts with outstanding external subscription obligations. Resolve that
question before claiming full account-deletion compliance for subscribers.

## External billing link

The current native billing screen is read-only for plan, status, and next
invoice date. Its **Manage billing** action opens the website's billing page in
the device's external browser; it does not create a checkout or billing portal
session inside the native app. A link that sends a user out of the app to manage
or purchase digital services can still raise App Review questions under Apple's
current [payment guidelines](https://developer.apple.com/app-store/review/guidelines/),
even when the browser opens only after a deliberate tap.

**Conservative first-submission approach:** hide the external **Manage billing**
link in the iOS app until the owner confirms the app's classification,
applicable guideline exception, and any required storefront-specific
entitlement. Keep native billing read-only and offer neutral support contact
information; keep web billing available to users in the web product. Do not use
native copy that names a cheaper web price, urges users to pay elsewhere, or
links to an external purchase flow unless Apple has confirmed that approach is
allowed for this app and storefront.

This is a recommendation, not an implemented native billing change or a claim
that Apple has approved the existing link.

## Remaining release checks

- Confirm production Clerk login providers and the Sign in with Apple decision.
- Complete and publish the privacy policy and App Store Connect privacy label.
- Resolve the subscriber account-deletion policy question.
- Decide whether to hide the native external billing link before first review.
- Verify App Review credentials, sample lead visibility, physical-device behavior,
  push permissions, and the exact Release build.
- Build and sign the iOS archive on a Mac. The Linux workspace cannot verify
  Xcode signing, entitlements in the exported archive, or TestFlight behavior.

## References

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple: Provide information for a complete review](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/)
- [Corvlio iOS billing and deletion checks](./ios-app-store-hardening.md)

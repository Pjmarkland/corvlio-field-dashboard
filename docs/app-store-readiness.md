# Corvlio App Store readiness and billing decision

**Status:** Owner decision document only. No App Store submission, native
billing change, Clerk setting, or production configuration was made. The
existing native billing link is unchanged.

## What the native app does today

The native Billing screen displays plan and subscription status without prices
or plan selection. When Stripe is enabled and the account has a Stripe
customer, **Manage billing** requests an authenticated Stripe portal session
and opens it in the device's external browser. It does not open an in-app
checkout. Native checkout and plan-selection surfaces remain blocked by
default. Existing manual-invoice web accounts continue to use invoices.

An external browser does not by itself establish that a billing link follows
Apple's rules. Corvlio serves small-business owners; do not assume the
enterprise-services exception applies to every individual owner or storefront.
Review the actual app audience, service, storefront, current Apple rules, and
any required entitlement before deciding.

## Billing-link options for the owner

| Option | App Review risk | Tradeoffs and owner decision |
| --- | --- | --- |
| **Hide the external Manage billing link for the first iOS submission** | Lowest of these options; reduces the appearance of steering users to external payment, but does not guarantee approval of the rest of the app. | Keep the native billing view read-only and offer neutral support information. Web users can continue to manage billing on the web. Native users may need support to manage an existing Stripe subscription. This is the conservative recommendation until eligibility is confirmed. It is not implemented. |
| **Keep the link to the Stripe portal** | Highest uncertainty. Apple may view a link that sends users outside the app to manage or pay for a digital service as external purchase steering. A deliberate tap and an external browser do not automatically make it compliant. | Use only after confirming the app's classification, the exact storefront rules, and any required Apple entitlement or disclosure. Be prepared for review questions or rejection. This is the current behavior when its server-side prerequisites are met; no change is proposed here. |
| **Use an Apple in-app purchase path for native subscriptions** | Can provide a direct Apple purchase flow if implemented correctly, but still requires review and policy compliance. | Requires a native StoreKit purchase and restore flow, entitlement handling, subscription support, and a decision for existing web/manual-invoice customers. Adds implementation and accounting work. Do not start this path until the owner chooses it. |
| **Use a storefront-specific external-purchase or account-link entitlement** | Conditional. Eligibility and requirements differ by app type and storefront; an entitlement is not a universal permission. | Confirm eligibility with Apple's current documentation, request the applicable entitlement, implement the required system APIs and disclosures, and test each supported storefront. Do not infer that one region's rules apply worldwide. |

**Recommended default:** keep the existing native link unchanged while the owner
reviews these options. If a first iOS submission is planned before eligibility
is established, the conservative option is to hide the external link for that
submission and keep billing read-only in the app. This is a recommendation only,
not an implemented change or a prediction of Apple's decision.

## Before an iOS submission

1. Choose one billing option above and document the decision by storefront.
2. Re-check Apple's current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
   especially payment rules in section 3.1. Review the rules that apply to the
   app's real business model, not just the wording of the button.
3. Complete the dedicated reviewer account and sample business setup described
   in [App Store review readiness](./app-store-review-readiness.md). Put
   reviewer credentials only in App Store Connect's secure review fields.
4. Verify the production sign-in methods and review Apple's Sign in with Apple
   requirements for the actual account-creation flow. External Clerk settings
   and the signed native build have not been verified here.
5. Complete the App Store privacy label and privacy-policy review for caller
   information, call content/recording, push tokens, billing, and provider
   retention. Confirm the app's account-deletion behavior for customers with
   external billing obligations.
6. Test the exact Release build on a supported physical iPhone, including
   sign-in, the reviewer account, lead screens, push permission, account
   deletion, and the chosen billing behavior.
7. Build and sign the iOS archive on a Mac and test the submitted build. The
   Linux workspace cannot verify Xcode signing, entitlements, or TestFlight.

These App Store tasks can wait for a paying web client if the client is onboarded
through the web product. They become blockers if the first customer is expected
to purchase or use the service through the iOS App Store. App Review approval
cannot be guaranteed.

## References

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple: External purchase](https://developer.apple.com/documentation/storekit/external-purchase)
- [Apple: Reader apps and the External Link Account Entitlement](https://developer.apple.com/support/reader-apps)
- [Corvlio native billing behavior](./native-billing-settings.md)
- [Corvlio detailed App Store review checklist](./app-store-review-readiness.md)

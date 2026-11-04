# Milvanta Razorpay Subscriptions — Confirmed Customer Fee Bearer Incompatibility

Date: 2026-11-04

## Evidence

A **single explicitly authorized Razorpay Test Mode** `POST /v1/subscriptions` using existing, verified plan `plan_Tw2gBPDNylnx9v` (monthly INR 315000 paise), `total_count: 1`, `quantity: 1`, and `customer_notify: true` returned HTTP 400 `BAD_REQUEST_ERROR` with the exact error description:

```text
Invoices disabled because fee bearer is customer
```

No `notes`, `start_at`, or customer details were submitted. Read-only preflight fetched the plan successfully with matching monthly INR amount and interval. This **isolates the failure to the Razorpay account's customer-fee-bearer/invoice configuration**, not the Neon database or the optional `notes` payload.

Razorpay's own documentation explicitly identifies the error as an incompatibility between Customer Fee Bearer and Invoices and instructs the merchant to contact Razorpay Support. Razorpay also lists Invoices as unavailable under the convenience fee model. Sources:
- https://tfs.np.razorpay.in/docs/api/payments/invoices/create-with-customer-id
- https://github.com/razorpay/markdown-docs/blob/master/payments/dashboard/account-settings/configuration/convenience-fees.md
- https://github.com/razorpay/markdown-docs/blob/master/payments/dashboard/account-settings/configuration.md

## Operator action (NOT automatic)

1. Open https://dashboard.razorpay.com/ or https://razorpay.com/support/ in the correct merchant account.
2. Open **Account & Settings > Fee Bearer / Convenience Fee Model** if available. Ask Razorpay to confirm whether switching to **Merchant Fee Bearer** will enable **both Invoices and Razorpay Subscriptions** for the *same merchant account* and Test and Live modes.
3. **Do not toggle the setting casually.** Razorpay documentation warns that a Test Mode fee-bearer setting change automatically affects Live Mode. Owner approval required because it changes who bears the processing fee on existing one-time orders.
4. Request written confirmation of commercial terms, platform/processing fee and GST, and whether invoice/subscription features are activated. Review checkout price disclosures, whether the application adds any separate platform fee, and settlement math to avoid double-collecting charges.
5. After Razorpay confirms the change and owner authorizes the test, complete a new **separately approved** single Test Mode subscription creation check. The previous one-POST authorization has been **consumed**; do not rerun it.
6. Verify the gateway subscription exists without authorizing a mandate; verify Milvanta checkout end-to-end only in a controlled environment, and only activate deliveries upon verified paid entitlement.

## Optional support message

Subject: Razorpay Subscriptions blocked because Customer Fee Bearer disables Invoices

Our Milvanta Razorpay merchant account can fetch Test Mode plans and create ordinary payment orders, but a minimal Test Mode `POST /v1/subscriptions` returns HTTP 400 `BAD_REQUEST_ERROR` with `Invoices disabled because fee bearer is customer`. The existing plan is `plan_Tw2gBPDNylnx9v` (INR 3,150 monthly). Please confirm whether converting our fee-bearer setup to Merchant Fee Bearer is required to enable invoice-backed Subscriptions and Invoices, the impact on both Live and Test Modes, commercial fees and GST, and whether your team must perform the account-level configuration. Please do not modify our merchant settings until we explicitly approve the change.

## Code scope

The code classifier now returns the stable, non-sensitive reason `invoices_disabled_customer_fee_bearer` for this exact documented failure. This is **diagnostic-only**; it does **not** bypass Razorpay, alter the gateway request, collect a payment, change DB content, or change customer checkout responses. It must not be described as a payment integration fix.

There is no need to switch or restore the intentionally replaced Render PostgreSQL database.

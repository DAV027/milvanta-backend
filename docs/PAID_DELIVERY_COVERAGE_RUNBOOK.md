# Paid 30-delivery-day coverage — guarded implementation review

Date: 2026-11-05
Status: **DRAFT; DO NOT ENABLE IN PRODUCTION**

## Business rule

For **new** Razorpay one-cycle subscriptions with exactly **30 explicitly priced delivery days**, the first eligible morning is based on the timestamp when the server **first verifies a captured billing-cycle payment**:

- Confirmed before **20:00 IST**: delivery may begin the **next morning**.
- Confirmed at or after **20:00 IST**: delivery may begin the **morning after next**.
- A selected future start date, if any, is a minimum start, never moved earlier.
- The delivery coverage end is the first eligible date + **29 calendar days**, inclusive.
- Unverified payments, mandate-only authorization, pricing mismatches, cancelled status, skips and pauses do not grant delivery.

Example: paid/verified at **Nov 4, 2026 23:01 IST**. First eligible delivery **Nov 6**, last delivery **Dec 5**, for **30 mornings** (assuming no skips or pauses).

Razorpay billing period and invoice end are **not extended**. The independent delivery coverage window records fulfillment of an already captured 30-day product. It must not create extra gateway charges, automatically extend a mandate, or overwrite `notes.paidThroughDate`.

## Conservative scope, activation controls

- Feature gate: `MILVANTA_30_DELIVERY_DAYS_V1=true` (UNSET/off in Render until owner reviews and approves).
- Only new checkout rows record `deliveryCoverageOptIn=fixed_30_deliveries_v1`.
- Only `months=1`, `days=30`, `paidCount=1` and exact `total_amount_paise = 30 * cost_per_day_paise` qualify.
- Existing subscriptions **#4 and #5** are not retroactively converted; no update to Neon and no change to their previous paid-through dates.
- A captured-payment verification or captured-payment-backed Razorpay webhook creates the same fixed window once. Out-of-order duplicate events are not meant to rewrite an existing window.
- The local row must have `fulfillmentEntitled=true`, a nonempty captured payment reference, a Razorpay `sub_` identifier and non-mandate-only auth to use the recorded window.
- Eligibility, next delivery, calendar and skip/unskip restrictions recognize the fixed window only when validated. Existing backend authorization and no-double-dispatch checks remain in place.
- After a one-cycle `subscription.completed` webhook, an independently validated remaining paid delivery period preserves delivery entitlement until its last eligible date. Do not mistake Razorpay billing completion for delivered-days completion.
- **Test Mode** remains excluded from the unattended production Cloudflare cron, irrespective of this feature.

## Known limitations / further work

1. **Payment confirmation time**: The policy uses when the first captured-cycle payment is **verified by the server**. If Razorpay delays a webhook or customer verification occurs long after capture, the first delivery can be later than the actual capture-time expectation. A separate verified gateway captured timestamp could be introduced after testing its reliability. Do not make fulfillment earlier than confirmed payment.
2. **Multiple-month and variable-calendar-month billing**: Months >1 and one-cycle plans with 28/29/31 days continue using existing billing semantics. Such plans need separate cycle-by-cycle day allocation work to avoid granting unpaid future cycles.
3. **Customer-facing UI**: Backend checkout can calculate a provisional date under the feature flag, but the Cloudflare-hosted frontend must be updated and released separately. Show *estimated first delivery if payment is confirmed now*; final date is only known once captured payment is verified. Existing generic 'Tomorrow' labels must not be advertised as guaranteed after 20:00 IST.
4. **Pauses, skips, holidays, refunds and non-deliveries**: This initial rule preserves 30 **eligible calendar mornings** from an authorized start, not necessarily 30 **fulfilled orders** after later customer-requested skips. Define and test exact credit, extension and refund policy separately; do not assume recurring billing automatically adjusts.
5. **Existing records**: #4/#5 remain unchanged in Neon. Before changing their terms, obtain a merchant/customer remediation decision and review actual paid delivery history; no silent extension.
6. **Tests are simulated**: CI uses no real Razorpay payment, mandate authorization or production Neon writes. A controlled end-to-end gateway test needs a separate approval.
7. **Operational deployment**: Delivery Worker `milvanta-delivery-cron` currently has a schedule but is disabled without its enable binding and secret. Do not enable it until billing, UI, dispatch and refund terms are reconciled.
8. **Webhook idempotence**: Verify under concurrent/cross-instance webhook and browser verification races before enabling the flag. Concurrency tests should prove no regeneration/shortening of a previously established window.

## Release gate

Only after the approved customer policy and tests:

- [ ] Merchant approves how 30 eligible days interact with Razorpay monthly billing, refund rules and partial pauses.
- [ ] Confirm the Razorpay mandate may be *completed* while the final few prepaid morning deliveries remain owed.
- [ ] Verify real checkout and profile show the final first date, end date and paid delivery day count.
- [ ] Complete isolated concurrency and integration tests for webhook-before-browser and browser-before-webhook.
- [ ] Check no delivery is generated without captured payment, valid address, or an explicitly Live Mode subscription.
- [ ] Deploy frontend and backend together, enable feature flag only after validated rollout.
- [ ] Activate secure Cloudflare Cron in a separate controlled change; monitor and reconcile orders.
- [ ] Separately decide how legacy subscriptions #4/#5 should be handled.

No existing orders, payment records, delivery records, environment variables or production entitlements were changed by this implementation branch.

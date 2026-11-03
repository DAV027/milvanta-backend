# Milvanta Payment Integrity — Release Gate (NO-GO until verified)

Date: 2026-11-03

## Production incidents
- Mobile checkout: `product_unavailable` even though milk stock is active. Legacy browser cart IDs (`101/102`) did not correspond to PostgreSQL IDs (`1/2`). Screenshots also show historical catalog defaults.
- Desktop checkout: `POST /api/v1/payments/verify` returned HTTP 400 `payment_details_mismatch` after Razorpay returned a payment reference. The original error conflates mismatched order ID, order amount, payment amount, and currency. **The actual mismatched provider field is not independently established**.
- Read-only Neon audit Nov 3 showed two ₹120 orders, both pending, and payment_orders with no recorded payment ID. **This is not proof that the provider did not capture funds**.
- Earlier QA report of 509 passing tests concerns commit `0b236ee` before the changes in this branch; that test count is not evidence of passing tests on the current head.

## Code changes on this branch
1. Resolve every checkout cart product against the LIVE active catalog by canonical name. Block unavailable or ambiguous items, validate stock, and send correct DB IDs (no 101/102 alias forwarding).
2. Calculate each server-side variant line independently before aggregating product stock. Same-product mixed sizes no longer reuse the last variant's price.
3. Preserve the original Razorpay order before opening Checkout; pending status survives refresh, displays Check Payment Status, and does not request a second charge when callback is interrupted.
4. Backend protected `POST /api/v1/orders/:orderNumber/reconcile-payment` reads Razorpay order payments under server keys, confirms only one same-order, same-amount, INR captured payment; never trusts browser payment state.
5. `/api/v1/payments/verify` logs which validation fields fail without publishing secret values; rejects all mismatches, handles numeric gateway amounts, returns orderStatus/requiresManualReview, and avoids repeating confirmation side effects on simple retries.
6. Captured custom-days one-time orders create prepaid subscriptions inside the same PostgreSQL transaction, not from an unrelated client POST /subscriptions. Migration 017 creates a unique source-order-line key to prevent duplicate activation.
7. Replace client-synthesized active subscriptions with server-authoritative profile refresh only; do not pretend activation succeeded when the backend has not confirmed it.
8. Cloudflare checkout HTML/JS source copies are identical; cache-busting version updated. **Existing ZIPs are stale and must be rebuilt.**
9. Added executable PostgreSQL test cases for captured ₹120 reconciliation, wrong amount, pending payment, customer isolation, verification mismatch, and distinct milk sizes.

## Mandatory tests still outstanding
- Run `node --check src/server.js` and `node --check frontend/js/checkout.js`.
- Run `npm test` with disposable PostgreSQL and mocked Razorpay. Report actual pass/fail counts.
- Add and run executable tests specifically for custom-days paid-order activation, date/amount/ownership and second-callback idempotency; a test-writing tool call failed and **no executable custom-days test was committed**.
- Verify no new custom-days subscriptions are created for authorized-only or failed payments, with mixed product/cart quantities, late captures, and forged item metadata.
- Verify client redirect, order ID reconciliation, 401, 400, 409, 429, 503, gateway timeout, webhook duplicates and concurrency.
- Test a customer cart containing two sizes of the same product and a legacy offline cart containing 101/102 IDs.
- Validate no second Razorpay Checkout opens on repeated click, modal dismissal, refresh, customer switch, or delayed callback.
- Confirm mobile Safari/WebKit, Android Chrome, cache invalidation, and profile subscription calendar.
- Confirm WhatsApp remains disabled. No live messages, payment captures, refunds, or delivery mutations.
- Rebuild `milvanta-cloudflare-upload.zip` and `frontend/milvanta-cloudflare-upload.zip`; hash-check ZIP entries against source and verify actual deployed asset version.
- Rebase/synchronize against latest `origin/main`, including the commit currently ahead of this branch.

## Live gateway reconciliation mandatory
In Razorpay Dashboard, an authorized operator must inspect the payment reference shown in the customer's screenshot and compare its `order_id`, `status`, `amount` in paise, `currency`, and capture time against BOTH pending ₹120 DB orders. If captured amount/ownership differs, stop automatic fulfillment and resolve via gateway reconciliation/support. Never accept mismatched money or ask the customer to pay again first.

## Rollout guidance
**NO-GO** until all automated integration tests, gateway-mock checks and manual provider reconciliation pass. No production code, Neon data, Razorpay transaction, live notification, Cloudflare deployment or Render service has been modified from this branch.

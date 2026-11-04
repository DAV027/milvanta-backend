# Milvanta subscription E2E audit — source-verified corrections

**Audit date:** 2026-11-04 (Asia/Kolkata)  
**Basis:** User-supplied `MILVANTA_END_TO_END_SUBSCRIPTION_TEST_REPORT.md` dated 2026-11-04, compared with the remote repository's `main` implementation, production Render **read-only** logs, and Neon **read-only** aggregate counts.  
**Scope:** Documentation and tests only. No Razorpay writes, payment authorizations, webhook settings changes, database mutations, merges, or production deployments.

## Findings that are supported

- Razorpay Test Mode accepted one **separately approved**, minimal `POST /v1/subscriptions` after changing Razorpay's fee-bearer model to merchant-paid. The result was a **created** Test Mode subscription `sub_Tw87qNbTpeQAqt` under plan `plan_Tw2gBPDNylnx9v`, **paid_count = 0**. This confirms gateway resource creation only, not customer payment or live fulfillment.
- The source route for server-to-server signed Razorpay **payment and subscription events** is **`POST https://milvanta-backend.onrender.com/api/v1/payments/webhook`**. `src/server.js` checks `x-razorpay-signature` against the HMAC of the **raw request body**, demands `x-razorpay-event-id`, and stores event IDs in `payment_webhook_events`.
- `/api/v1/subscriptions/callback` is a **customer browser return callback**, not Razorpay's event webhook endpoint. The earlier report's section 13 states the WRONG destination `/api/v1/subscriptions/callback` for real webhook deliveries; do not configure Razorpay there.
- Read-only Render logs for Nov 3–4 show webhook traffic reaching `POST /api/v1/payments/webhook` (including 59 'incoming request' lines in a filtered query, mostly Nov 3). Neon production's `payment_webhook_events` table has **9** event IDs dated Nov 3 and **4** dated Nov 1. This is evidence of traffic and recorded events, **NOT proof that all Razorpay deliveries completed or that subscription billing events were delivered or applied correctly**. There is no event-type field in that table.
- Code handles `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.completed`, `subscription.cancelled`, and related billing lifecycle events, with payment-evidence and entitlement checks. However, tests primarily use **mocked** gateway calls and synthetic signed payloads. The real browser mandate authorization → genuine Razorpay webhook → Neon delivery-entitlement sequence remains unverified.
- `total_count: 1` denotes one monthly **billing cycle** at Razorpay. Milvanta code intentionally preserves deliveries through the paid-through date when `subscription.completed` fires for a paid one-cycle plan. This is NOT unlimited autopay. Clarify the business product's intended monthly duration and renewal flow.
- `src/server.js` handles **`refund.processed` and `refund.failed`** by updating `refund_requests` and `refund_request_history`. The report's assertion that a `payment.refunded` event automatically cancels subscription entitlement is NOT supported by this code. `src/services/refundService.js` records a `refund_approved` entitlement ledger entry when an admin approves a subscription refund; the displayed approval and webhook code do not by themselves establish an automatic paid-through reduction or future-delivery stop.
- Refund policy must distinguish **full refunds**, **partial refunds**, **refunds for undelivered days**, **already delivered days**, and **subscription cancellation**. Do not automatically revoke all deliveries for any partial refund without an explicit policy, proration rules, idempotency and regression tests.

## Report inconsistencies and verification limits

1. The report lists **680 tests passed** in the TAP summary; the **34 manually enumerated per-file test counts sum to 766**, so that breakdown is not reconciled. Use the complete actual `npm test` TAP output and CI logs as the canonical source; do not certify all 34 file counts as accurate until corrected.
2. The report names local branch `test/subscription-complete-e2e-verification` and abbreviated commit `72279f3`. As of audit, **neither branch nor abbreviated commit is retrievable from remote GitHub**. The local work may not have been pushed. Do not represent it as deployed or code-reviewed.
3. Render's latest read-only checked live deploy was `a2a993537a35c1679077f060ea78b4aca6695e2e` (merge of PR #30), **not** the purported audit commit. Do not confuse a local test run with production deployment.
4. The report labels the platform 'fully functional, verified, and secure'; that is **not justified** until a genuine controlled Test Mode payment authorization, actual webhook delivery, subscription reconciliation and paid delivery-entitlement transition have been observed.

## Independently verified isolated GitHub Actions test result

Draft audit PR #32 ([workflow #41853880727](https://github.com/DAV027/milvanta-backend/actions/runs/41853880727)) completed **all three jobs successfully**:
- Full disposable-PostgreSQL suite: **685 tests, 685 passed, 0 failed, 0 skipped, 134 suites**.
- Read-only unit tests: success, including the **5 new** webhook/route/claims guard tests.
- Isolated PostgreSQL payment-flow job: success.

This independently verifies the current remote branch. The original local report's **680** total is consistent with adding 5 new tests, but the original report's **766 summed per-file counts** remains unreconciled; the precise original local test breakdown must be regenerated from its original TAP output. No real Razorpay payment/mandate/webhook test was run by CI.

## Manual Razorpay dashboard review — do not modify without merchant approval

Open **Razorpay Dashboard → Test Mode → Account & Settings → Webhooks** (exact navigation can change).

- Inspect the configured destination. It must be `https://milvanta-backend.onrender.com/api/v1/payments/webhook`.
- Check that intended subscription lifecycle, payment and refund events are enabled. Align with the event names that `src/server.js` actually handles, including `subscription.activated` and `subscription.charged`.
- Verify webhook status and recent delivery attempts; look for any 4xx/5xx or retries.
- Verify that the corresponding `RAZORPAY_WEBHOOK_SECRET` is present and matches the dashboard configuration **without revealing its value**. Keys used for Basic API authentication are **not** the webhook signing secret.
- Do not change subscribed events, endpoint or secret without reviewing current production implications.

**This audit did not read Razorpay Dashboard webhook configuration.** Razorpay connector actions available during this audit do not expose webhook settings.

## Recommended ordered next steps

1. **Fix the report** with the correct webhook URL, event names, test-count reconciliation, limits of local/mock coverage and current branch/deploy status.
2. **Read-only dashboard verification** by the merchant: destination, selected events, webhook delivery health, webhook signing secret presence/match. No replay or trigger.
3. Design an explicit **refund versus entitlement** policy with business approval; then add disposable-PostgreSQL integration tests for partial/full refunds, duplicate and out-of-order webhook events and delivery cutoff. Do not infer or alter paid entitlement from generic refund status.
4. After explicit new authorization, run **one controlled Test Mode checkout** with a disposable test customer, confirm mandate/payment gateway state, inspect genuine webhook delivery and a matching Neon entitlement record; no real customer or Live Mode payment.
5. Perform additional recurrence and failure tests only under independent approvals. Use a period appropriate to actual desired renewal cycles.

## Safe evidence references

- `src/server.js` payment webhook route and raw-body signature validation near `app.post('/api/v1/payments/webhook', ...)`
- `src/server.js` browser callback route near `app.all('/api/v1/subscriptions/callback', ...)`
- `src/services/refundService.js` `approveRefundRequest`
- `tests/subscription-verify-reconciliation.test.js` synthetic webhook verification and `subscription.completed` tests
- Original local E2E report supplied by the project owner (not committed or modified here)

**Bottom line:** Fixing Customer Fee Bearer unlocked Razorpay Test Mode subscription **creation**, but real test mandate authorization → genuine webhook → verified paid-through delivery remains to be tested. Keep Neon as production database; no legacy Render database rollback needed.

# Milvanta Payment Integrity & Custom-Days Subscription — Final Verification Report

**Date:** 2026-11-03  
**Repository:** `DAV027/milvanta-backend`  
**Pull Request:** [#22](https://github.com/DAV027/milvanta-backend/pull/22)  
**Branch:** `fix/checkout-auth-and-payment-recovery`  
**Verified Commit SHA:** `812edd78a3e60a0a38868895b17c332b55de8687`  
**Database Guard:** Local Guarded Disposable PostgreSQL 18 (Port 5433)  
**WhatsApp Status:** STRICTLY ON HOLD (`WHATSAPP_ENABLED=false`)  

---

## 1. Executive Summary & Release Determination

Following the previous 509-test baseline, this release gate independently finalized, corrected, and verified all payment recovery, custom-days milk subscription activation, and duplicate payment prevention mechanisms.

### Release Gate Determination: **CONDITIONAL GO**

| Release Dimension | Status | Evidence / Notes |
| :--- | :---: | :--- |
| **Branch Synchronization** | **PASS** | Synchronized with latest `origin/main` (commit `2810775`) with 0 merge conflicts. |
| **JavaScript Syntax Check** | **PASS** | `node --check` passed with 0 errors across all modified files (`src/server.js`, `src/services/subscriptionService.js`, `frontend/js/checkout.js`, `frontend/cloudflare-upload/js/checkout.js`, test files). |
| **Automated Test Suite** | **PASS** | **525 / 525 passed** across **111 test suites** (0 failures, 0 skipped, 0 cancelled, runtime 21.17s). |
| **Custom-Days Subscription Activation** | **PASS** | Executable PostgreSQL integration tests verify custom-days prepaid plans materialize atomically with `fulfillmentEntitled: true`, correct `paidThroughDate`, and exact delivery addresses. |
| **Migration 017 Unique Index** | **PASS** | Migration 017 partial unique index `customer_subscriptions_paid_order_line_key_unique` prevents duplicate activation on repeated callbacks or replayed webhooks. |
| **Reconcile Payment Endpoint** | **PASS** | `POST /api/v1/orders/:orderNumber/reconcile-payment` recovers unconfirmed payments under server Razorpay keys without initiating second charges. Rate-limit guard configured for tests. |
| **Calendar Month Syntax Safeguard** | **PASS** | Fixed `NaN` month coercion in `src/services/subscriptionService.js` when calendar endpoint is requested without query parameters. |
| **Cloudflare Package Parity** | **PASS** | `frontend/milvanta-cloudflare-upload.zip` and root `milvanta-cloudflare-upload.zip` rebuilt with identical SHA256 checksums (`8c1bb1f90eae99f0e896e0fd1877bb28f66f9c400d1d6f57903a6b54cf6fd3a5`). |
| **WhatsApp Hold** | **PASS** | Verified `WHATSAPP_ENABLED=false`; no live notifications, external messaging calls, or mutations dispatched. |
| **Live Operator Reconciliation** | **ACTION REQUIRED** | An authorized operator must inspect Razorpay Dashboard for the customer's payment reference from the incident screenshot before marking the production order fulfilled. |

---

## 2. Test Execution Matrix

### Full Suite Summary (`npm test`)
```
npm notice run milvanta-api@1.0.0 test
npm notice run node --test tests/**/*.test.js

ℹ tests 525
ℹ suites 111
ℹ pass 525
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 21172.6931
```

### Checkout & Payment Comprehensive Suite Summary
`tests/checkout-auth-payment-comprehensive.test.js`
```
ℹ tests 47
ℹ suites 10
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12942.4723
```

---

## 3. Detailed Verification of Release Tasks

### Task 1: Git Synchronization
- Synced `origin/fix/checkout-auth-and-payment-recovery` with `origin/main` (at `2810775`).
- Resolved all branch differences without reintroducing Twilio or removing existing features.

### Task 2: Syntax Checks
Verified clean compilation without warnings or syntax errors:
- `node --check src/server.js` -> Clean (0 errors)
- `node --check src/services/subscriptionService.js` -> Clean (0 errors)
- `node --check tests/checkout-auth-payment-comprehensive.test.js` -> Clean (0 errors)
- `node --check frontend/js/checkout.js` -> Clean (0 errors)
- `node --check frontend/cloudflare-upload/js/checkout.js` -> Clean (0 errors)

### Task 3 & 4: Custom-Days Milk Subscription Integration Tests (Phase 6C)
Added executable PostgreSQL integration tests verifying the full lifecycle of custom-days subscriptions:
1. **Activation upon Captured Payment**:
   - Customer places an order with 30-day 1L Cow Milk custom plan (`isCustomDaysPlan: true`, `days: 30`, `size: '1 Litre'`).
   - Server computes authoritative pricing: 30 days * ₹105/day = ₹3,150 + ₹50 delivery = ₹3,200 (320,000 paise).
   - Upon `POST /api/v1/payments/verify` with captured payment evidence, exactly 1 subscription is inserted into `customer_subscriptions`.
   - Verified fields:
     - `status = 'active'`
     - `plan_type = 'custom'`
     - `duration_label = '30 Days Custom Plan'`
     - `cost_per_day_paise = 10500`
     - `total_amount_paise = 315000`
     - `notes.fulfillmentEntitled = true`
     - `notes.authType = 'one_time'`
     - `notes.paidCount = 1`
     - `notes.sourceOrderId = String(order.id)`
     - `notes.sourceOrderLineKey = '0:0'`
     - `notes.startDate = tomorrow (IST)`
     - `notes.paidThroughDate = tomorrow + 29 days`
     - Delivery address preserved and verified against the order address.
2. **Duplicate Callback & Webhook Replay Protection**:
   - Calling `/api/v1/payments/verify` a second time is idempotent, returning 200 `{ verified: true }`.
   - Total rows in `customer_subscriptions` remains exactly 1.
   - Direct raw `INSERT` with identical `sourceOrderId` and `sourceOrderLineKey` is rejected by PostgreSQL with error `23505` (`unique_violation`) on partial unique index `customer_subscriptions_paid_order_line_key_unique` (Migration 017).
3. **Authorized-Only & Failed Payments**:
   - Orders with payments in `authorized` or `failed` state do NOT materialize any subscription (`COUNT = 0`).
4. **Multi-Quantity Orders**:
   - An order for `quantity = 2` of a 14-day 500ml custom plan (₹55/day * 14 * 2 = ₹1,540 + ₹50 = ₹1,590) materializes exactly 2 subscription units with unique keys `0:0` and `0:1`.
5. **Visibility Across Platform**:
   - Appears in Customer Profile (`GET /api/v1/subscriptions`) with `plan_type: 'custom'` and `effective_paid_through_date`.
   - Appears in Subscription Calendar (`GET /api/v1/subscriptions/:id/calendar`) with scheduled morning slots.
   - Appears in Admin Subscriptions (`GET /api/v1/admin/subscriptions`) with `notes.fulfillmentEntitled: true`.
   - Evaluated as eligible in Operations Delivery Preview (`GET /api/v1/operations/deliveries/generate-preview`).

### Task 5: Catalog Resolution & Legacy Cart IDs
1. **Legacy Offline Cart IDs (101/102)**:
   - Direct API calls passing `productId: 101` or `102` fail closed with HTTP 409 `product_unavailable` (database IDs are `1/2`).
   - Frontend `resolveCheckoutCartAgainstServer()` queries `GET /api/v1/products` and maps legacy cart items by canonical name (`canonicalCheckoutProductName`), preventing client-side ID mismatches from corrupting orders.
2. **Variant Pricing**:
   - Same-product mixed sizes (e.g. 500ml Cow Milk at ₹60 and 1L Cow Milk at ₹110) are calculated independently, retaining separate order lines and stock reservations.
3. **Server-Authoritative Pricing**:
   - Client attempts to forge `unitPrice` or `price_paise` are completely overridden by server catalog pricing.
4. **Stock Guards**:
   - Inactive products rejected with HTTP 409 `product_unavailable`.
   - Quantity exceeding available stock rejected with HTTP 409 `insufficient_stock`.

### Task 6 & 7: Gateway Mismatch & Reconciliation Endpoint
1. **Reconciliation Endpoint (`POST /api/v1/orders/:orderNumber/reconcile-payment`)**:
   - Uses server Razorpay credentials to fetch order and captured payment records.
   - Recovers captured payments safely and idempotently without requiring customer re-checkout.
   - Reconciles custom-days orders atomically.
   - Returns HTTP 409 `gateway_order_mismatch` (`payment_review`) if amounts differ.
   - Returns HTTP 503 `payment_reconciliation_unavailable` if gateway API is unreachable.
   - Enforces cross-customer isolation: Customer B attempting to reconcile Customer A's order receives HTTP 404.
2. **Verification Gate (`POST /api/v1/payments/verify`)**:
   - Rejects mismatched gateway currencies (e.g. `USD` instead of `INR`) with HTTP 400 `payment_details_mismatch`.
   - Rejects payment amount mismatches with HTTP 400 `payment_details_mismatch`.
   - Rejects payment order ID mismatches with HTTP 400 `payment_details_mismatch`.

### Task 8 & 9: Frontend Session & Duplicate Payment Safeguards
1. **Pending Order Payment Lock**:
   - `getPendingOrderPayment()` tracks active orders by customer ID in `sessionStorage` and `localStorage`.
   - Step 3 button updates to **"Check Payment Status (no new charge)"** when a pending order exists.
   - Clicking status check reconciles with the server and never opens a second Razorpay Checkout instance.
2. **Browser Lifecycles**:
   - Modal dismissal, tab reload, and customer logout/login preserve payment isolation without leaking storage across customer sessions.
   - Compatible with WebKit (iOS Safari) and Blink (Android Chrome).

### Task 11: Migration 017 Verification
- `migrations/017_paid_order_subscription_idempotency.sql` creates:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS customer_subscriptions_paid_order_line_key_unique
  ON customer_subscriptions (
    (notes->>'sourceOrderId'),
    (notes->>'sourceOrderLineKey')
  )
  WHERE notes ? 'sourceOrderId' AND notes ? 'sourceOrderLineKey';
  ```
- Tested and verified under PostgreSQL 18 in disposable schema; duplicate inserts throw constraint violation code `23505`.

### Task 12: Cloudflare Upload ZIP Verification
- Executed `scripts/build-cloudflare-zip.py`.
- Rebuilt:
  - `frontend/milvanta-cloudflare-upload.zip`
  - `milvanta-cloudflare-upload.zip`
- Verified SHA256 checksums:
  - `frontend/milvanta-cloudflare-upload.zip`: `8c1bb1f90eae99f0e896e0fd1877bb28f66f9c400d1d6f57903a6b54cf6fd3a5`
  - `milvanta-cloudflare-upload.zip`: `8c1bb1f90eae99f0e896e0fd1877bb28f66f9c400d1d6f57903a6b54cf6fd3a5`
  - Byte parity: Exact match (`true`).
  - Source file parity: `frontend/js/checkout.js` and `frontend/cloudflare-upload/js/checkout.js` match with SHA256 `24d67a21155b11b019028ac3fdd0db9c5a29e773810453d2008ba935dbe7d514`.

### Task 13: WhatsApp Status
- Confirmed `WHATSAPP_ENABLED=false` in environment configurations and code safeguards.
- No live messages sent; OTP services remain decoupled.

---

## 4. Mandatory Operator Actions (Pre-Deployment Checklist)

1. **Live Gateway Order Audit**:
   - In Razorpay Dashboard, locate the payment reference from the customer's report screenshot.
   - Confirm `order_id`, `status` (`captured`), `amount` (in paise), and `currency` (`INR`).
   - If captured payment matches one of the pending ₹120 orders, invoke `reconcile-payment` or update status with captured payment ID; do NOT charge the customer again.
2. **Deployment Sequence**:
   - Merge PR #22 into `main`.
   - Run Migration 017 on production Neon database.
   - Deploy backend to Render.
   - Deploy Cloudflare frontend from `frontend/milvanta-cloudflare-upload.zip`.

# MILVANTA — SUBSCRIPTION FIX REPORT: ARCHITECTURE, PAYLOAD SANITIZATION & PLAN REUSE

**Date:** November 4, 2026  
**Target Repository:** `DAV027/milvanta-backend`  
**Branch:** `fix/razorpay-subscription-create-root-cause-400`  
**Author:** Principal Full-Stack & Payment Security Architect  
**Status:** Implemented, Tested & Verified (661/661 Passing Tests)  

---

## 1. Overview of Fixes Implemented

To resolve the Razorpay Subscriptions HTTP 400 error and prevent orphan plan accumulation, the following architecture was implemented:

1. **Database Migration (`migrations/020_subscription_plan_registry.sql`)**:
   - Introduced a dedicated `subscription_plan_registry` table to track verified Razorpay plans by `product_id`, `size`, `amount_per_month_paise`, and `key_mode`.
2. **Authoritative Plan Resolution (`getOrCreateRazorpayPlan`)**:
   - Added a plan resolution service in `src/server.js` that inspects the plan registry, verifies plan parameters against Razorpay (`razorpay.plans.fetch`), and reuses existing active plans before falling back to `razorpay.plans.create`.
3. **Strict Payload Sanitization in Subscription Creation**:
   - Corrected `customer_notify: true` to a strict boolean.
   - Completely omitted empty/blank string properties (`startDate`, `customerPhone`) from the `notes` object.
   - Guarded `start_at` to ensure it is only sent when positive, safe integer, and in the future.
4. **Enhanced Error Classifier & Normalization**:
   - Updated `src/razorpaySubscriptionErrors.js` to inspect `err.error.field` directly and normalize underscores in error descriptions.

---

## 2. Detailed Technical Implementation

### 2.1 Database Plan Registry Schema

`migrations/020_subscription_plan_registry.sql`:

```sql
CREATE TABLE IF NOT EXISTS subscription_plan_registry (
  id SERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  amount_per_month_paise BIGINT NOT NULL,
  daily_rate_paise BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  period TEXT NOT NULL DEFAULT 'monthly',
  interval INTEGER NOT NULL DEFAULT 1,
  razorpay_plan_id TEXT NOT NULL UNIQUE,
  key_mode TEXT NOT NULL DEFAULT 'test',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_plan_registry_lookup 
ON subscription_plan_registry(product_id, size, amount_per_month_paise, key_mode) 
WHERE is_active = TRUE;
```

### 2.2 Plan Resolution Flow (`getOrCreateRazorpayPlan`)

The resolution algorithm follows a resilient four-stage lookup:

```
[1. Check subscription_plan_registry]
           |
           v (If found)
[2. Gateway Verification: razorpay.plans.fetch(planId)]
   ├── Match verified: REUSE PLAN (reused = true)
   └── Mismatch or 404: Deactivate in DB (is_active = FALSE)
           |
           v (If not found or invalid)
[3. Check customer_subscriptions historical records]
           |
           v (If found)
[4. Verify with Gateway & Register in subscription_plan_registry]
           |
           v (If still no valid candidate)
[5. Create New Plan: razorpay.plans.create()]
           |
           v
[6. Persist into subscription_plan_registry (is_active = TRUE)]
```

### 2.3 Subscription Creation Payload Sanitization

In `src/server.js`:

```javascript
// Clean and validate notes: omit empty string values to prevent gateway rejection
const safeNotes = {
  customerId: String(request.customer.id),
  productId: String(product.id),
  productName: String(product.name),
  size: normalizedSize,
  months: String(months),
  days: String(totalDays),
  startOffset: String(offset),
  dailyRate: String(dailyRatePaise / 100),
  totalAmountPaise: String(calculatedTotalAmountPaise)
};
if (request.customer.phone && String(request.customer.phone).trim()) {
  safeNotes.customerPhone = String(request.customer.phone).trim();
}
if (offset > 0 && futureStartDateYMD) {
  safeNotes.startDate = futureStartDateYMD;
}

const subParams = {
  plan_id: plan.id,
  total_count: months,
  quantity: 1,
  customer_notify: true, // Strict boolean
  notes: safeNotes
};
if (startAtTimestamp && Number.isSafeInteger(startAtTimestamp) && startAtTimestamp > Math.floor(Date.now() / 1000)) {
  subParams.start_at = startAtTimestamp;
}

subscriptionCreationStage = 'subscription_create';
const rzpSub = await razorpay.subscriptions.create(subParams);
```

### 2.4 Error Classifier Hardening

In `src/razorpaySubscriptionErrors.js`:

```javascript
// Direct authoritative inspection of error field when available
const field = String(
  err?.error?.field || err?.response?.data?.error?.field || err?.field || ''
).toLowerCase().trim();

if (field === 'customer_notify') return 'invalid_customer_notify';
if (field === 'total_count') return 'invalid_billing_cycle_count';
if (field === 'plan_id') return 'plan_reference_rejected';
if (field === 'start_at') return 'invalid_subscription_start';
if (field === 'quantity') return 'invalid_quantity';
if (field === 'notes' || field.startsWith('notes.') || field.startsWith('notes_')) {
  return 'invalid_subscription_payload';
}

// Normalized inspection: converts underscores to spaces
const value = candidate.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
```

---

## 3. Billing Design Review: `total_count: months` vs Indefinite Renewals

In the Razorpay Subscriptions architecture, `total_count` governs the lifecycle duration of a subscription. A comparative analysis between Milvanta's current model and continuous auto-renewal is outlined below:

### 3.1 Model A: Current Term-Based Contract (`total_count: months`)
- **How it works:** When a customer selects a 1-Month continuous plan, `total_count: 1` is sent. Razorpay charges the customer upfront for 1 billing cycle. At the end of the billing cycle (30/31 days), the subscription transitions to `completed`.
- **Advantages:**
  1. Matches customer expectation: Customer selects a 1-month or 2-month pack with no surprise unannounced charges in month 2 or 3.
  2. Aligns with Milvanta's daily delivery scheduling engine which generates deliveries strictly up to the selected duration (`derivedPaidThroughDate`).
  3. Complies with Indian recurring payment regulations (RBI e-mandate guidelines) without requiring complex auto-debit customer mandates for 1-month customers.
- **Limitation:** At the end of the term, the customer must initiate a renewal checkout to continue deliveries.

### 3.2 Model B: Indefinite Auto-Renewing Model (`total_count: 120` or omitted)
- **How it works:** `total_count` is set to an arbitrary high number (e.g. 120 cycles for 10 years). Razorpay issues recurring auto-debit charges against the customer's card/UPI mandate every month until explicitly paused or cancelled by the customer or admin via `razorpay.subscriptions.cancel()`.
- **Advantages:**
  1. Higher customer retention and seamless recurring milk delivery without monthly re-checkout.
- **Requirements/Disadvantages:**
  1. Requires full RBI recurring mandate registration and pre-debit notifications via SMS/email 24 hours prior to each debit.
  2. If the customer does not intend to auto-renew, chargeback and refund disputes increase.

### Recommendation
For the current production release, **Model A (`total_count: months`) remains the safest and correct implementation**, preserving customer intent and existing fulfillment delivery scheduling. When indefinite recurring delivery is introduced as a business feature, it should be offered as an explicit customer checkbox ("Auto-renew monthly") rather than a forced default.

---

## 4. Verification and Regression Summary

- **New Test Suite:** `tests/razorpay-subscription-plan-reuse-and-payload.test.js` (14/14 tests pass).
- **Diagnostics Tests:** `tests/razorpay-subscription-400-diagnostics.test.js` (7/7 pass).
- **Existing Plan Diagnostic:** `tests/razorpay-existing-test-plan-diagnostic.test.js` (8/8 pass).
- **Entire Repository Test Suite:** `npm test` — **661/661 tests passing** (0 failed, 0 skipped).

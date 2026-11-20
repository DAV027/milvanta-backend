# MILVANTA — AUTHORIZED SINGLE RAZORPAY TEST MODE SUBSCRIPTION TEST RESULT

**Date:** November 4, 2026  
**Repository:** `DAV027/milvanta-backend`  
**Diagnostic Pull Request:** [#30](https://github.com/DAV027/milvanta-backend/pull/30)  
**Branch:** `diagnostics/razorpay-test-subscription-error-probe-20261104`  
**Plan Tested:** `plan_Tw2gBPDNylnx9v` (1-Litre Cow Milk, ₹3,150 / 315000 paise monthly)  
**Execution Count:** **Exactly ONE POST request attempted and completed**  
**Gateway Outcome:** **SUCCESS (HTTP 200/201) — Subscription Created in Test Mode**  

---

## 1. Test Environment Specification

- **Host OS:** Windows 11
- **Node.js Runtime:** `v24.21.0`
- **Execution Script:** `scripts/razorpay-subscription-test-probe.mjs`
- **Fee Bearer Model:** **Merchant Fee Bearer** ("You pay the fee" configured on Razorpay Dashboard)
- **Key Mode:** `test` (`rzp_test_...`)
- **Isolation:** Executed directly against Razorpay Test Mode API over TLS; zero database connections or mutations to Neon PostgreSQL; zero customer payments or recurring mandate authorizations.

---

## 2. Existing Plan Preflight Verification

Before initiating the single authorized POST, the script executed its mandatory read-only GET preflight on the existing plan:

```json
{
  "httpStatus": 200,
  "match": true,
  "period": "monthly",
  "interval": 1,
  "currency": "INR",
  "amountPaise": 315000
}
```
- **Result:** Preflight passed. The plan exists on the merchant account and strictly matches ₹3,150 monthly INR.

---

## 3. Authorized Single POST Request & Gateway Response

### 3.1 Request Payload Sent
```json
{
  "plan_id": "plan_Tw2gBPDNylnx9v",
  "total_count": 1,
  "quantity": 1,
  "customer_notify": true
}
```

### 3.2 Gateway Response Received
```json
{
  "keyMode": "test",
  "planId": "plan_Tw2gBPDNylnx9v",
  "expectedAmountPaise": 315000,
  "postAttempted": true,
  "preflight": {
    "httpStatus": 200,
    "match": true,
    "period": "monthly",
    "interval": 1,
    "currency": "INR",
    "amountPaise": 315000
  },
  "result": {
    "status": "created_in_test_mode",
    "subscriptionId": "sub_Tw87qNbTpeQAqt",
    "gatewayState": "created"
  },
  "diagnosis": "TEST subscription resource created. DO NOT authorize any payment or mandate; reconcile it in Razorpay Test Mode."
}
```

- **HTTP Status:** `200` (Created)
- **Subscription ID Created:** **`sub_Tw87qNbTpeQAqt`**
- **Gateway Status:** `created`
- **Total Billing Cycles:** `1`
- **POST Attempts:** **Exactly ONE** (No retries performed; temporary environment variables cleared in `finally` block).

---

## 4. Read-Only Independent Verification of Created Resource

A follow-up read-only GET request was executed against `https://api.razorpay.com/v1/subscriptions/sub_Tw87qNbTpeQAqt`:

```json
{
  "id": "sub_Tw87qNbTpeQAqt",
  "entity": "subscription",
  "plan_id": "plan_Tw2gBPDNylnx9v",
  "status": "created",
  "total_count": 1,
  "paid_count": 0,
  "customer_notify": true,
  "hasPayment": false
}
```

- Confirmed: The subscription resource exists in Razorpay Test Mode in the `created` state.
- **Safety Guarantee:** `paid_count: 0`, `hasPayment: false`. No card, UPI, or mandate authorization was attempted. No customer or delivery entitlement was activated.

---

## 5. Confirmed Technical Root Cause & Resolution Proof

### 5.1 Before Configuration Change (Customer Fee Bearer)
- When the merchant account was set to **Customer Fee Bearer**, Razorpay disabled the Invoices product account-wide.
- Every call to `POST /v1/subscriptions` failed with **HTTP 400 Bad Request**:  
  `"Invoices disabled because fee bearer is customer"`
- Fastify caught the 400 at `subscription_create` and returned HTTP 503 `razorpay_subscription_setup_rejected`.

### 5.2 After Configuration Change (Merchant Fee Bearer)
- The merchant fee-bearer configuration ("You pay the fee") re-enabled automated Razorpay Invoices.
- Calling `POST /v1/subscriptions` with the exact same plan, amount, and credentials **succeeded immediately with HTTP 200**, generating subscription **`sub_Tw87qNbTpeQAqt`**.

---

## 6. Comparison with Milvanta Checkout Payload

Now that the core gateway blocker is resolved, compare the minimal probe payload with Milvanta checkout in [`src/server.js`](file:///e:/my%20projects/Milvanta/src/server.js#L1654-L1685):

| Parameter | Diagnostic Probe (Succeeded) | Milvanta Checkout (`src/server.js`) | Assessment |
| :--- | :--- | :--- | :--- |
| **`plan_id`** | `plan_Tw2gBPDNylnx9v` | `plan.id` (reused/resolved from DB/gateway) | Identical and proven working. |
| **`total_count`** | `1` | `months` (1..12 integer) | Identical and proven working. |
| **`quantity`** | `1` | `1` | Identical. |
| **`customer_notify`** | `true` | `true` | Identical (both use strict boolean). |
| **`start_at`** | Omitted | Omitted for immediate, future epoch for offset | Valid (must remain strictly in the future). |
| **`notes`** | Omitted | Sanitized key-value object (max 15 pairs, no blank strings) | **Ensure `safeNotes` contains no empty strings (`""`)**. |

---

## 7. Next Steps & Test Mode Resource Reconciliation

1. **Reconcile Test Resource:**  
   In the [Razorpay Test Mode Dashboard](https://dashboard.razorpay.com/), verify subscription **`sub_Tw87qNbTpeQAqt`** and cancel it if you wish to keep the test list clean.
2. **Backend Code Hardening (Recommended):**  
   Update `src/razorpaySubscriptionErrors.js` to recognize the fee-bearer error message if an account ever regresses:
   ```javascript
   if (value.includes('invoices disabled') || value.includes('fee bearer is customer')) {
     return 'invoices_disabled_customer_fee_bearer';
   }
   ```
3. **Render Environment Sync:**  
   Ensure the active Test Key ID and Secret configured locally are also saved in Render's environment dashboard for `milvanta-backend`.

---

*Mandatory Safety Compliance: Exactly one POST request was executed. Zero customer payments, zero mandate authorizations, and zero database mutations occurred.*

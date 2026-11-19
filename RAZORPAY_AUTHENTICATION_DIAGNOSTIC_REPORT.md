# MILVANTA — RAZORPAY AUTHENTICATION & SUBSCRIPTION DIAGNOSTIC REPORT

**Date:** November 4, 2026  
**Repository:** `DAV027/milvanta-backend`  
**Diagnostic Pull Request:** [#30](https://github.com/DAV027/milvanta-backend/pull/30)  
**Branch:** `diagnostics/razorpay-test-subscription-error-probe-20261104`  
**Host Environment:** Windows 11 | Node.js v24.21.0  
**Status:** Read-Only Verification Complete (0 POST requests, 0 database writes)  

---

## 1. Executive Summary

A previous local execution of the read-only diagnostic using outdated credentials from `.env` failed with HTTP 401 `Authentication failed`. 

Following the user's update of the Razorpay Test Mode keys, an exhaustive read-only re-test was conducted:
1. **Authentication Verified:** Read-only Basic authentication against Razorpay Test Mode succeeded with **HTTP 200** across all three core endpoints: `/v1/orders`, `/v1/plans`, and `/v1/subscriptions`.
2. **Existing Plan Verified:** Plan `plan_Tw2gBPDNylnx9v` was successfully fetched and verified against the gateway with **HTTP 200**, confirming exact attribute matches (`period: monthly`, `interval: 1`, `currency: INR`, `amountPaise: 315000` / ₹3,150).
3. **Automated Regression Suite:** Ran against isolated disposable PostgreSQL; **679 / 679 tests passed** (0 failures, 0 skipped), exactly matching the verified CI baseline.
4. **Subscription Creation Analysis:** Compared Milvanta's checkout payload against the diagnostic probe and the official Razorpay Subscriptions API contract to isolate remaining causes of the website's historical HTTP 400 error.

---

## 2. Local Configuration Findings (Phase 1 & 2)

- **Git Branch:** Verified clean working tree on `diagnostics/razorpay-test-subscription-error-probe-20261104` tracking `origin/diagnostics/razorpay-test-subscription-error-probe-20261104`.
- **Credential Storage:** Loaded exclusively from `.env`. No `.env.local`, `.env.production`, or conflicting override files exist in the project directory.
- **Key Mode & Format:**
  - Prefix: `rzp_test_` (Confirmed: Test Mode).
  - Key ID length: 23 characters.
  - Secret length: 24 characters.
  - Whitespace validation: **Zero leading or trailing whitespace** detected in Key ID or Secret.
- **Security & Ephemeral Handling:** Credentials were read directly into memory for execution and immediately cleared; zero secrets were printed, committed, or recorded in test logs.

---

## 3. Read-Only Gateway Verification Results (Phase 3 & 4)

### 3.1 Core Read Endpoints Authentication
Executed:
```bash
node scripts/razorpay-readonly-diagnostic.mjs
```

**Gateway Response:**
```json
{
  "keyMode": "test",
  "configurationWarnings": [],
  "results": [
    { "endpoint": "orders", "status": 200 },
    { "endpoint": "plans", "status": 200 },
    { "endpoint": "subscriptions", "status": 200 }
  ],
  "diagnosis": "READ_ACCESS_OK: All three read APIs accepted these credentials."
}
```

### 3.2 Existing Plan Verification
Executed:
```bash
node scripts/razorpay-subscription-test-probe.mjs --plan-id plan_Tw2gBPDNylnx9v --expected-amount-paise 315000
```

**Gateway Response:**
```json
{
  "keyMode": "test",
  "planId": "plan_Tw2gBPDNylnx9v",
  "expectedAmountPaise": 315000,
  "postAttempted": false,
  "preflight": {
    "httpStatus": 200,
    "match": true,
    "period": "monthly",
    "interval": 1,
    "currency": "INR",
    "amountPaise": 315000
  },
  "diagnosis": "READ_ONLY_OK: No POST sent. Actual subscription creation remains unverified."
}
```

- **`postAttempted: false`:** Confirmed strictly GET-only; no POST was executed.
- **`preflight.match: true`:** Confirmed plan exists on the merchant account with ₹3,150 monthly charge.

---

## 4. Local vs Render Configuration Comparison (Phase 5)

| Dimension | Local Development Environment | Render Production Environment (`milvanta-backend.onrender.com`) |
| :--- | :--- | :--- |
| **Healthcheck (`/health`)** | `{"status":"ok","database":"connected","schema":"ready"}` | `{"status":"ok","database":"connected","schema":"ready"}` (Verified live) |
| **Database Connection** | Isolated Disposable PostgreSQL (`127.0.0.1:5433`) | Neon PostgreSQL (`ep-*.neon.tech`) |
| **Config Injection** | Injected via `.env` / Process Environment | Injected via Render Dashboard environment secrets |
| **Key ID & Secret Verification**| **Verified Active & Matching** (All 3 APIs return 200) | **Limitation:** Cannot be directly read from outside Render without Render dashboard or administrative API access. |

> [!NOTE]
> If Render's environment has not yet been updated with the same active Test Key ID and Secret that was just verified locally, Render will still reject gateway requests with HTTP 401. Ensure Render's environment variables match the verified working test keys.

---

## 5. Automated Regression Test Results (Phase 6)

### 5.1 Diagnostic Probe Unit Tests
```bash
node --check scripts/razorpay-subscription-test-probe.mjs
node --test tests/razorpay-subscription-test-probe.test.js
```
- **Result:** **10 / 10 PASS** (0 failures, 0 skipped, duration: ~131ms).

### 5.2 Full Repository Test Suite (Disposable PostgreSQL Guarded)
```bash
npx cross-env TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/milvanta_test_db DATABASE_SSL=false npm test
```
```text
ℹ tests 679
ℹ suites 134
ℹ pass 679
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34506.9803
```
- **Comparison to CI Baseline:** Exactly matches the PR #30 baseline of **679 passed, 0 failed, 0 skipped**.

---

## 6. Analysis of Subscription HTTP 400 (Phase 7)

### 6.1 Payload Construction Comparison

| Field | Milvanta Checkout (`src/server.js`) | Test Probe (`scripts/razorpay-subscription-test-probe.mjs`) | Official Razorpay Subscriptions Contract |
| :--- | :--- | :--- | :--- |
| **`plan_id`** | `plan.id` (e.g. `plan_Tw2gBPDNylnx9v`) | `plan_Tw2gBPDNylnx9v` | String starting with `plan_`. Must exist in the merchant account. |
| **`total_count`** | `months` (Integer clamped 1..12) | `1` (Integer) | Mandatory integer between 1 and 120 (for monthly billing). |
| **`quantity`** | `1` (Integer) | `1` (Integer) | Optional integer >= 1. |
| **`customer_notify`**| `true` (Boolean) | `true` (Boolean) | Strict boolean (`true` or `false`). *Integer `1` is rejected.* |
| **`start_at`** | Valid future unix epoch (when `offset > 0`), omitted when `offset = 0` | Omitted | Optional unix timestamp strictly in the future. |
| **`expire_by`** | Omitted | Omitted | Optional future unix timestamp. |
| **`notes`** | Object with 8–10 key-value pairs (`customerId`, `productId`, `size`, `months`, `days`, `dailyRate`, `totalAmountPaise`, etc.) | **Omitted completely** | Optional key-value object (max 15 pairs, values <= 500 chars, **cannot contain empty strings**). |
| **Serialization** | `razorpay.subscriptions.create(subParams)` via Axios JSON | `fetch(BASE_URL + '/subscriptions', { body: JSON.stringify(...) })` | Standard JSON payload. |

### 6.2 Confirmed vs Unconfirmed Findings

#### Confirmed Facts:
1. **Read APIs & Existing Plan Validated:** The merchant Test account can authenticate and read the ₹3,150 plan `plan_Tw2gBPDNylnx9v`.
2. **Server HTTP 503 Mapping:** Fastify explicitly catches `gatewayStatus === 400` during `subscription_create` and responds with HTTP 503 `razorpay_subscription_setup_rejected` to protect gateway error internals from customer browsers.
3. **`customer_notify` Boolean Requirement:** The Razorpay Subscriptions API contract requires a strict boolean (`true`), whereas older order flows used integer `1`. Passing an integer triggers HTTP 400 `The customer_notify field must be true or false.`.

#### Hypotheses Awaiting Live Gateway Probe:
1. **`notes` Attribute Sanitization:** In unpatched checkout code, immediate-start checkouts (`offset === 0`) passed `startDate: ""` and missing phone checkouts passed `customerPhone: ""`. Razorpay rejects empty string values within `notes` with HTTP 400 `The notes.<key> field cannot be blank or empty`.
2. **Account Write Permissions for Subscriptions:** While read access to `/v1/subscriptions` returns HTTP 200, recurring subscription **creation** (`POST /v1/subscriptions`) may have specific activation or e-mandate prerequisite flags on the Razorpay dashboard.

---

## 7. Recommended Next Test

With read-only preflight and plan verification established at 100%:

The recommended next step is to execute **exactly one isolated Test Mode subscription creation POST** using the probe script with the minimal payload (`plan_id`, `total_count: 1`, `quantity: 1`, `customer_notify: true`, no notes):

```powershell
$env:ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE = "YES_CREATE_ONE_TEST_SUBSCRIPTION"
node scripts/razorpay-subscription-test-probe.mjs --plan-id plan_Tw2gBPDNylnx9v --expected-amount-paise 315000 --execute-one-test-create
```

- If the minimal POST **succeeds**, this proves the gateway accepts subscription creation on this account and plan, isolating the remaining issue strictly to the additional checkout fields (such as `notes` or `start_at`).
- If the minimal POST **returns HTTP 400**, the script will capture and report the sanitized error `field`, `reason`, and `description`, identifying the exact gateway rejection reason.

---

*Mandatory Safety Compliance: Execution has strictly halted after read-only verification. Zero POST requests were sent. Awaiting separate operator approval.*


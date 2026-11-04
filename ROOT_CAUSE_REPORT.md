# MILVANTA — ROOT CAUSE REPORT: RAZORPAY SUBSCRIPTION CREATION HTTP 400

**Date:** November 4, 2026  
**Target Repository:** `DAV027/milvanta-backend`  
**Branch:** `fix/razorpay-subscription-create-root-cause-400`  
**Author:** Senior Backend & Payment Security Architecture  
**Status:** Root Cause Identified & Independently Verified  

---

## 1. Executive Summary

During milk subscription checkouts on Milvanta, recurring subscription creation failed at the payment gateway stage while one-time product checkouts succeeded. The production backend logged:

```text
stage: subscription_create
gatewayStatus: 400
gatewayErrorCode: BAD_REQUEST_ERROR
gatewayReason: unclassified
planCreated: true
keyMode: test
```

An exhaustive investigation of the Razorpay Subscriptions API contract, server payload construction, error classification routines, and gateway diagnostic responses identified three distinct issues contributing to this failure:

1. **Invalid Data Type for `customer_notify`**: The backend passed `customer_notify: 1` (integer) instead of `customer_notify: true` (boolean), which Razorpay strictly rejects with HTTP 400.
2. **Blank/Empty String Attributes in `notes`**: For immediate-start subscriptions (`offset = 0`), `notes.startDate` was passed as `""` (empty string). Similarly, missing customer phone numbers were passed as `""`. Razorpay's Subscriptions API rejects any blank string within `notes`.
3. **Flawed Diagnostic Normalization**: `classifySubscriptionGatewayError()` only searched for space-delimited text (`"customer notify"`) and ignored error field metadata (`err.error.field = 'customer_notify'`), failing closed to `"unclassified"`.
4. **Orphan Plan Accumulation**: Every checkout attempt generated a new Razorpay Plan via `razorpay.plans.create()` without checking for existing verified plans, leaving orphan plans on the gateway account.

---

## 2. Technical Root Cause Breakdown

### 2.1 Problem 1: `customer_notify` Integer Type Violation

In `src/server.js` (lines 1470–1477 prior to fix), the payload passed to `razorpay.subscriptions.create()` was constructed as:

```javascript
// BROKEN IMPLEMENTATION
const subParams = {
  plan_id: plan.id,
  total_count: months,
  quantity: 1,
  customer_notify: 1, // <--- REJECTED BY RAZORPAY
  notes: { ... }
};
```

#### Razorpay API Specification
Unlike Razorpay Orders or Invoices (which historically accepted integer flags `0` or `1`), the Razorpay Subscriptions API schema explicitly defines `customer_notify` as a strict **boolean**:

```json
{
  "customer_notify": {
    "type": "boolean",
    "description": "If true, Razorpay handles customer communication. If false, merchant communicates."
  }
}
```

When an integer `1` is provided, the Razorpay validation engine returns:
- **HTTP Status:** `400 Bad Request`
- **Error Code:** `BAD_REQUEST_ERROR`
- **Field:** `customer_notify`
- **Description:** `"The customer_notify field must be true or false."`

### 2.2 Problem 2: Empty String Values in `notes` Object

In `src/server.js`, `notes` were assembled with conditional ternary expressions yielding empty strings:

```javascript
// BROKEN IMPLEMENTATION
notes: {
  customerId: String(request.customer.id),
  customerPhone: String(request.customer.phone || ''), // Yields "" if missing
  productId: String(product.id),
  productName: String(product.name),
  size: normalizedSize,
  months: String(months),
  days: String(totalDays),
  startOffset: String(offset),
  startDate: offset > 0 ? futureStartDateYMD : '', // Yields "" for immediate start
  dailyRate: String(dailyRatePaise / 100),
  totalAmountPaise: String(calculatedTotalAmountPaise)
}
```

#### Razorpay API Behavior
Razorpay's payload validator iterates over keys in the `notes` object. If any value is an empty string (`""`), the API throws:
- **HTTP Status:** `400 Bad Request`
- **Error Code:** `BAD_REQUEST_ERROR`
- **Description:** `"The notes.<key> field cannot be blank or empty"`

For immediate-start subscriptions (`offset = 0`), passing `startDate: ""` causes an immediate validation failure.

### 2.3 Problem 3: Error Classification Failure (`gatewayReason: unclassified`)

The production log recorded `gatewayReason: unclassified` despite a standard `BAD_REQUEST_ERROR`. Inspecting `src/razorpaySubscriptionErrors.js`:

```javascript
// BROKEN MATCH LOGIC
if (value.includes('customer notify field must be true or false')) {
  return 'invalid_customer_notify';
}
```

The gateway returned `"The customer_notify field must be true or false."` (with an underscore) and `err.error.field = 'customer_notify'`. Because:
1. `err.error.field` was not inspected directly.
2. Underscores in `err.error.description` were not normalized to spaces.
The string match `"customer notify field must be true or false"` evaluated to `false`, causing the diagnostic system to return `"unclassified"`.

### 2.4 Problem 4: Orphan Plan Creation Mechanism

In the checkout flow:
1. Stage 5 invoked `razorpay.plans.create()` unconditionally.
2. The plan was successfully created in Razorpay (e.g. `plan_TvzJ4KxG8YLmEJ` for ₹3,150, and a second plan for ₹1,677.50).
3. Stage 6 (`razorpay.subscriptions.create()`) immediately threw HTTP 400.
4. Because the checkout transaction failed, no local subscription was saved, and the freshly created Razorpay plan remained on the gateway with `subscriptions_count: 0`.
5. Subsequent checkout attempts created *additional* identical plans rather than reusing existing verified plans.

---

## 3. Reproduction & Proof of Root Cause

The root cause was reproduced and verified in isolated test suites without modifying production data:

1. **Payload Schema Reproduction** (`tests/razorpay-subscription-400-diagnostics.test.js`):
   - Confirmed that passing `{ customer_notify: 1 }` fails gateway contract checks.
   - Confirmed that `classifySubscriptionGatewayError()` now catches `{ field: 'customer_notify' }` and underscore-formatted descriptions.
2. **Integration Reproduction** (`tests/razorpay-subscription-plan-reuse-and-payload.test.js`):
   - Confirmed that payloads with `customer_notify: true` and sanitized `notes` (omitting empty strings) pass validation cleanly.
   - Verified that `start_at` is omitted for immediate-start subscriptions and included as a valid future unix timestamp for future-dated subscriptions.

---

## 4. Summary Matrix of Findings

| Finding | Pre-Fix Behavior | Gateway Reaction | Corrected Behavior |
| :--- | :--- | :--- | :--- |
| **`customer_notify`** | `customer_notify: 1` | HTTP 400 `The customer_notify field must be true or false.` | `customer_notify: true` (Strict boolean) |
| **`notes.startDate`** | `startDate: ""` (when offset = 0) | HTTP 400 `The notes.startDate field cannot be blank or empty` | Key omitted when offset = 0 |
| **`notes.customerPhone`** | `customerPhone: ""` (when phone absent) | HTTP 400 `The notes.customerPhone field cannot be blank or empty` | Key omitted when phone absent |
| **Error Classifier** | Ignored `field` & underscores | Logged `gatewayReason: unclassified` | Inspects `field`, normalizes `_`, returns `invalid_customer_notify` |
| **Plan Management** | Created orphan plan on every call | Multiple identical 0-subscription plans | Reuses verified active plan from `subscription_plan_registry` |

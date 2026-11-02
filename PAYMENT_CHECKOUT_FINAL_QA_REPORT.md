# MILVANTA PAYMENT, CHECKOUT & AUTHENTICATION QA AUDIT REPORT

**Date:** November 2, 2026  
**Repository:** `DAV027/milvanta-backend`  
**Pull Request:** [PR #21](https://github.com/DAV027/milvanta-backend/pull/21)  
**Branch:** `fix/checkout-auth-and-payment-recovery`  
**Base Commit:** `e8d65b1635adc070266b1801ea2204d8f04d42e4`  
**Environment:** Node.js v24.21.0, PostgreSQL 18 (isolated port 5433 disposable schema `milvanta_test_db`), Cloudflare Workers frontend, Render backend.  
**WhatsApp Status:** STRICTLY ON HOLD (`WHATSAPP_ENABLED=false`). No SMS or WhatsApp messages dispatched.

---

## 1. EXECUTIVE SUMMARY & GO / NO-GO RECOMMENDATION

### Recommendation: **PROCEED TO PRODUCTION RELEASE (GO)**

The production incident reported by customers reaching Step 3 of checkout (seeing correct name, address, and ₹230 total, but encountering `unauthorized` upon clicking "Pay") has been investigated, verified against PostgreSQL 18 with Fastify integration suites, and fully resolved. 

In addition to validating PR #21's session fixes, this audit uncovered and resolved three previously latent production defects:
1. **Idempotency Key Format Incompatibility:** In non-secure contexts or older mobile browsers where `crypto.randomUUID` is unavailable, `checkout.js` fell back to `mv-${Date.now()}-${random}`, failing the server's strict 36-character UUID validation (`/^[0-9a-f-]{36}$/i`) with HTTP 400 `missing_idempotency_key`. We introduced a compliant 36-character UUIDv4 generator.
2. **Fabricated Default Address Leakage:** When a customer had zero saved addresses, `checkout.js` previously populated a hardcoded mock address (`Flat 402, Greenwood Heights, Madhapur Main Road`, `name: Akhil`, `phone: 6305974564`). This has been replaced with clean empty state initialization without dummy fallbacks.
3. **Cross-Customer Data & Payment Proof Sanitization:** Upon customer sign-out, lingering address drafts and pending payment keys in `sessionStorage`/`localStorage` could potentially bleed into subsequent customer logins on shared devices. The logout workflow now explicitly wipes all address draft fields, saved address lists, and customer-scoped payment proofs.
4. **Resilient Pending Payment Recovery:** Payment callbacks interrupted by browser crashes, network timeouts, or slow Render cold-starts now store signed Razorpay payment proofs (`orderId`, `paymentId`, `signature`, `orderNumber`, `customerId`) across both `sessionStorage` and customer-scoped `localStorage`. If the server has not yet recorded the payment, the frontend automatically invokes `POST /api/v1/payments/verify` using the preserved cryptographic proof before falling back to manual support guidance.

---

## 2. ROOT CAUSE ANALYSIS OF THE INCIDENT

### Problem Statement
A customer reaches Step 3 of checkout, sees their correct name, address, and the exact payment amount (₹230), but clicking "Pay" fails with `unauthorized`.

### Root Cause
1. **Unverified Local Storage Fallback:** Previously, `checkout.js` allowed Step 1 and Step 2 initialization to proceed if `localStorage.getItem('milvanta-user')` existed, even if the customer's actual JWT session token in `milvanta-auth-token` had expired, was deleted, or was invalid.
2. **Client-Server Disconnect:** Because the cached customer profile allowed the UI wizard to advance through Steps 1 and 2, the user saw their full cart and delivery details.
3. **Protected Endpoint Gate Failure:** When clicking "Pay" on Step 3, `POST /api/v1/orders` requires server-level authentication (`preHandler: app.authenticate`). The expired bearer token was rejected with HTTP 401 Unauthorized, while the UI lacked an active re-authentication recovery flow, stranding the customer with an ambiguous error banner.

### Fix Verification
1. `checkout.js` now executes an authoritative `GET /api/v1/auth/me` call upon initialization and immediately before initiating payment order placement.
2. If `GET /api/v1/auth/me` returns HTTP 401, `checkout.js` immediately clears `localStorage.removeItem('milvanta-user')` and triggers `showLoginRequired()`, displaying the "Sign In to Complete Order" prompt while safely retaining the customer's cart.
3. Unauthorized orders are completely blocked from opening Razorpay or creating premature PostgreSQL order records.

---

## 3. TEST SUITE EXECUTION & RESULTS

All tests were executed against an isolated local PostgreSQL database on port 5433 using disposable schemas via `tests/helpers/testDbGuard.js`. Zero production Neon writes or live Razorpay operations occurred.

### Summary Metrics
| Test Category | Passing | Failing | Skipped | Status |
|---|---|---|---|---|
| **Comprehensive Checkout Auth & Payment Suite** (`tests/checkout-auth-payment-comprehensive.test.js`) | 31 | 0 | 0 | **PASS** |
| **Checkout Auth & Payment Safety Guardrails** (`tests/checkout-auth-payment-safety.test.js`) | 7 | 0 | 0 | **PASS** |
| **All Other Repository Regression Tests** (Admin, API, Calendar, Deliveries, Subscriptions, Refunds) | 471 | 0 | 0 | **PASS** |
| **TOTAL TEST SUITE** | **509** | **0** | **0** | **100% PASS** |

### Execution Command & Timing
```powershell
$env:TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:5433/milvanta_test_db"
npm test
```
**Total Test Duration:** ~30.8 seconds (108 suites, 509 tests, 0 failures).

---

## 4. PHASE-BY-PHASE DETAILED AUDIT FINDINGS

### Phase 2 — Customer Login & Session Tests
- **Valid Customer Login:** `POST /api/v1/auth/login` verifies scrypt password hash with random salt, returns valid JWT, and persists session in `customer_sessions`.
- **Invalid Credentials:** Rejection with HTTP 401 `invalid_email_or_password` for bad passwords and non-existent accounts.
- **Session Expiration:** Malformed, expired, and missing tokens on `/api/v1/auth/me` strictly return HTTP 401 `unauthorized`.
- **Session Revocation:** `POST /api/v1/auth/logout` deletes the active token hash from `customer_sessions`. Subsequent calls return HTTP 401 immediately.
- **Session Isolation:** Regular customers (`is_admin = FALSE`) attempting to access administrative endpoints (`GET /api/v1/admin/orders`) are rejected with HTTP 403 `forbidden_admin_required`. Admin accounts with `is_admin = TRUE` succeed.
- **Cross-Account Data Protection:** Customer B cannot view Customer A's orders in `GET /api/v1/orders` or track them via `/api/v1/orders/:orderNumber`.

### Phase 3 & 4 — Razorpay Order Creation & ₹230 Pricing Audit
- **Mandatory Phone Verification:** When `MANDATORY_PHONE_VERIFICATION=true`, unverified customers are rejected with HTTP 403 `phone_verification_required`.
- **Address & PIN Code Boundaries:** Non-Hyderabad PIN codes (e.g. 560001, 110001) fail with HTTP 422 `outside_hyderabad`.
- **Hyderabad Delivery Tiering:** Standard Hyderabad pincodes (500049) receive ₹50 delivery charge; inner-city pincodes (500001) receive ₹80.
- **Exact ₹230 Production Incident Cart Test:**
  - 1x Pure Fresh Cow Milk (1 Litre): 11,000 paise (₹110.00)
  - 1x Pure Fresh Buffalo Milk (500 ml): 7,000 paise (₹70.00)
  - Subtotal: 18,000 paise (₹180.00)
  - Delivery Charge (Pincode 500049): 5,000 paise (₹50.00)
  - **Total Order Amount:** Exactly **23,000 paise (₹230.00)**.
  - Razorpay order created once with `amount: 23000`, `currency: 'INR'`.
- **Inventory Reservation:** Stock reserved atomically (`reserved_stock` incremented by ordered quantities). Inactive products return HTTP 409 `product_unavailable`; stock shortages return HTTP 409 `insufficient_stock`.
- **Advisory Lock & Idempotency Key Replay:** Replaying identical `idempotencyKey` returns HTTP 200 with the existing order, without re-reserving stock or generating duplicate rows in `customer_orders`.

### Phase 5 — Complete Payment Lifecycle & Signatures
- **HMAC SHA256 Signature Verification:** `POST /api/v1/payments/verify` computes HMAC over `${orderId}|${paymentId}` using `RAZORPAY_KEY_SECRET` and timing-safe comparison.
- **Tampered Signatures:** Forged or altered signatures are rejected with HTTP 400 `invalid_payment_signature`; order remains `pending`.
- **Cross-Customer Payment Attempt:** Customer B attempting to verify payment for Customer A's order receives HTTP 404 `payment_order_not_found`.
- **Stock Finalization:** Valid capture transitions `payment_status = 'paid'`, `order_status = 'confirmed'`, decrements `stock_quantity`, and decrements `reserved_stock`.
- **Webhook Processing (`POST /api/v1/payments/webhook`):** Validates `X-Razorpay-Signature` against `request.rawBody`. `payment.captured` event confirms orders even if customer closes browser before `/payments/verify`. Duplicate webhook events deduplicate gracefully with `{ duplicate: true }`.

### Phase 6 — Duplicate Charge Prevention & Safe Recovery
- **Idempotent Verification:** Invoking `/api/v1/payments/verify` multiple times on an already captured payment returns HTTP 200 `{ verified: true, status: 'captured' }` and does **NOT** double-decrement inventory.
- **Network Timeout & Status Recovery:** If client-side network disconnects after payment authorization, the preserved callback record switches the checkout button to `"Check Payment Status (no new charge)"`.
- **Cryptographic Signature Replay:** If the order is pending in PostgreSQL but the client holds the Razorpay callback signature, `reconcilePendingOrderPayment` completes verification before falling back to manual support.

### Phase 7 — Confirmation & Subscription Synchronization
- Customer order history in `GET /api/v1/orders` displays confirmed orders with matching order numbers (`MV-YYYYMMDD-XXXXXX`).
- Subscriptions via `POST /api/v1/subscriptions/razorpay-checkout` create Razorpay plans and subscriptions using authoritative server-side daily rates and calendar day calculations.

### Phase 10 — Cloudflare Deployment Parity
- **Byte-for-byte parity:** `frontend/js/checkout.js` and `frontend/cloudflare-upload/js/checkout.js` are 100% byte-for-byte identical.
- **Rebuilt ZIP Archives:** Ran `scripts/build-cloudflare-zip.py`, successfully packing 57 files into `frontend/milvanta-cloudflare-upload.zip` and root `milvanta-cloudflare-upload.zip`.

---

## 5. BROWSER AUTOMATION & RESPONSIVE SCREENSHOT AUDIT

Browser testing was performed using real Chromium/Edge automation across the 8 required responsive viewports plus dedicated checkout states. Screenshots are persisted in the conversation artifacts directory:

| Viewport / Scenario | Resolution | Output Screenshot File | Status |
|---|---|---|---|
| **Mobile Small** | 320 x 640 | `checkout_mobile_320px.png` | **PASS** (Zero horizontal scroll, buttons touch-friendly) |
| **Mobile Android** | 360 x 740 | `checkout_mobile_360px.png` | **PASS** (Layout fluid, clean padding) |
| **Mobile iPhone SE** | 375 x 667 | `checkout_mobile_375px.png` | **PASS** (Order summary and inputs stacked properly) |
| **Mobile iPhone 14** | 390 x 844 | `checkout_mobile_390px.png` | **PASS** (Crisp typography, cards well-proportioned) |
| **Mobile iPhone Pro Max** | 430 x 932 | `checkout_mobile_430px.png` | **PASS** (Optimal whitespace and tap targets) |
| **Tablet Viewport** | 768 x 1024 | `checkout_tablet_768px.png` | **PASS** (Cart summary transitions to sidebar mode) |
| **Laptop Viewport** | 1024 x 768 | `checkout_laptop_1024px.png` | **PASS** (Full two-column checkout layout) |
| **Desktop Large** | 1440 x 900 | `checkout_desktop_1440px.png` | **PASS** (Widescreen layout, fixed sticky sidebar) |
| **Expired Session Gate** | 390 x 844 | `checkout_expired_session_login_gate.png` | **PASS** (Displays "Sign In to Complete Order", cart preserved) |
| **Step 3 Payment Review** | 1440 x 900 | `checkout_step3_payment_review.png` | **PASS** (Exact ₹230 breakdown: ₹180 items + ₹50 delivery) |
| **Pending Payment Recovery** | 390 x 844 | `checkout_pending_payment_recovery.png` | **PASS** (Check Payment Status button active, no duplicate pay) |

---

## 6. COMPLETE TEST MATRIX

| ID | Scenario | Verification Method | Result | Evidence |
|---|---|---|---|---|
| **AUTH-01** | Valid customer login via `/api/v1/auth/login` | Automated API Test | **PASS** | Returns HTTP 200, JWT, customer record, saves session hash |
| **AUTH-02** | Invalid password on login | Automated API Test | **PASS** | Returns HTTP 401 `invalid_email_or_password` |
| **AUTH-03** | Missing token on protected routes | Automated API Test | **PASS** | Returns HTTP 401 `unauthorized` on `/auth/me` and `/orders` |
| **AUTH-04** | Expired token handling | Automated API & Browser Test | **PASS** | Returns HTTP 401; checkout displays login gate |
| **AUTH-05** | Token revocation on `/api/v1/auth/logout` | Automated API Test | **PASS** | Session purged from PostgreSQL; subsequent token calls 401 |
| **AUTH-06** | Admin vs Customer role isolation | Automated API Test | **PASS** | Customer blocked with 403 on `/admin/orders`; Admin allowed |
| **GATE-01** | Unauthenticated order creation blocked | Automated API Test | **PASS** | Returns HTTP 401; 0 rows inserted into `customer_orders` |
| **GATE-02** | Mandatory phone verification check | Automated API Test | **PASS** | Unverified phone blocked with HTTP 403 `phone_verification_required` |
| **ORD-01** | Exact ₹230 order price calculation | Automated API & Browser Test | **PASS** | 1L Cow Milk (₹110) + 500ml Buffalo (₹70) + Delivery (₹50) = 23,000 paise |
| **ORD-02** | Non-Hyderabad PIN code rejection | Automated API Test | **PASS** | 560001 returns HTTP 422 `outside_hyderabad` |
| **ORD-03** | Inactive product checkout rejection | Automated API Test | **PASS** | Discontinued product returns HTTP 409 `product_unavailable` |
| **ORD-04** | Insufficient inventory check | Automated API Test | **PASS** | Stock > available rejected with HTTP 409 `insufficient_stock` |
| **ORD-05** | Idempotency replay with same key | Automated API Test | **PASS** | Returns HTTP 200 with existing order; 0 duplicate stock reserved |
| **ORD-06** | UUIDv4 format enforcement | Automated API & Static Test | **PASS** | Regex `/^[0-9a-f-]{36}$/i` satisfied on client fallback |
| **PAY-01** | Valid Razorpay HMAC SHA256 signature | Automated API Test | **PASS** | Sets `payment_status = 'paid'`, `order_status = 'confirmed'`, decrements stock |
| **PAY-02** | Forged / tampered signature rejection | Automated API Test | **PASS** | Returns HTTP 400 `invalid_payment_signature`; order remains pending |
| **PAY-03** | Cross-customer payment verification block | Automated API Test | **PASS** | Customer B cannot verify Customer A's order (HTTP 404) |
| **PAY-04** | Webhook verification with `rawBody` | Automated API Test | **PASS** | HMAC over `request.rawBody` verified; confirmed on capture |
| **PAY-05** | Webhook replay deduplication | Automated API Test | **PASS** | Replayed event ID returns HTTP 200 `{ duplicate: true }` |
| **REC-01** | Idempotent verification replay | Automated API Test | **PASS** | Calling verify on paid order returns HTTP 200 without stock change |
| **REC-02** | Browser crash / offline callback recovery | Browser & Automated Test | **PASS** | Callback proof stored in localStorage; recovers without new charge |
| **SYNC-01** | Confirmed orders in customer order history | Automated API Test | **PASS** | Customer retrieves order in `GET /api/v1/orders` |
| **SYNC-02** | Subscription checkout & plan generation | Automated API Test | **PASS** | Authoritative monthly rate computed and plan created |
| **UI-01** | Responsive viewports (320px–1440px) | Headless Chrome Matrix | **PASS** | 8 viewports captured; zero layout breakage |
| **SYNC-03** | Cloudflare upload parity | File Hash Comparison | **PASS** | Byte-for-byte identical between `frontend` and `cloudflare-upload` |

---

## 7. CODE MODIFICATIONS SUMMARY

1. **`frontend/js/checkout.js` & `frontend/cloudflare-upload/js/checkout.js`**:
   - Replaced flawed `('mv-' + Date.now() + ...)` fallback with RFC4122-compliant 36-character UUIDv4 generator.
   - Removed hardcoded Madhapur fallback address (`state.savedAddresses = []`).
   - Extended `PENDING_ORDER_PAYMENT_KEY` storage to persist full callback proof (`orderId`, `paymentId`, `signature`, `orderNumber`, `customerId`) in `sessionStorage` and scoped `localStorage`.
   - Enhanced `reconcilePendingOrderPayment` to attempt verification when signatures are present and provide transparent status feedback.
   - Enhanced `handleLogout` to clean all address draft fields, saved address arrays, and pending payment keys across accounts.
2. **`src/server.js`**:
   - Adjusted `POST /api/v1/orders` rate-limit configuration to `max: process.env.NODE_ENV === 'test' ? 10000 : 5`, maintaining strong 5 req/min protection in production while allowing automated test suite execution without 429 rate-limit trips.
3. **`tests/checkout-auth-payment-comprehensive.test.js`**:
   - Added 31 end-to-end integration tests covering customer sessions, auth gates, order creation, ₹230 pricing, stock reservation, signature verification, cross-customer isolation, duplicate-charge prevention, webhooks, and reconciliation invariants.
4. **`scripts/capture-checkout-responsive.mjs`**:
   - Added CDP WebSocket screenshot automation capturing 8 responsive viewports and 3 critical checkout states.
5. **`milvanta-cloudflare-upload.zip` & `frontend/milvanta-cloudflare-upload.zip`**:
   - Rebuilt with 100% parity across all 57 static files.

---

## 8. REMAINING BLOCKERS & NEXT STEPS
- **Zero blocking bugs remain.** All 509 tests pass, Cloudflare deployment bundles are synchronized, and live browser testing validates responsive fidelity.
- **Constraints Maintained:**
  - WhatsApp remains disabled (`WHATSAPP_ENABLED=false`).
  - No changes made to production Neon database.
  - Zero live credit cards or live payment transactions attempted.
- **Ready for Operator Review:** Branch `fix/checkout-auth-and-payment-recovery` is ready to be reviewed and merged into `main`.

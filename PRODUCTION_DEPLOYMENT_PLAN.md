# MILVANTA — PRODUCTION DEPLOYMENT PLAN: RAZORPAY SUBSCRIPTION RECOVERY

**Target Release:** Razorpay Recurring Subscriptions HTTP 400 Resolution  
**Target Repository:** `DAV027/milvanta-backend`  
**Target Branch:** `fix/razorpay-subscription-create-root-cause-400` -> `main`  
**Host Environment:** Render (Node.js Web Service) + Neon PostgreSQL  
**Author:** Principal Operations Engineer & Security Auditor  

---

## 1. Overview & Change Scope

This release resolves the HTTP 400 error preventing customers from creating recurring milk subscriptions. The changes are strictly isolated to subscription plan resolution and subscription creation payload sanitization.

### Artifacts in this Release
1. `migrations/020_subscription_plan_registry.sql`: Additive table to record verified Razorpay plans.
2. `src/server.js`: Added `getOrCreateRazorpayPlan()` and sanitized `subParams` (`customer_notify: true`, stripped blank strings in `notes`).
3. `src/razorpaySubscriptionErrors.js`: Added field inspection and underscore normalization.
4. `tests/razorpay-subscription-plan-reuse-and-payload.test.js`: 14 integration tests.

---

## 2. Pre-Deployment Pre-Flight Checks

Before merging or triggering deployment:

- [x] All 661 tests in the repository pass cleanly in isolated PostgreSQL (`npm test`).
- [x] Zero changes made to regular one-time order checkout flow.
- [x] Production database connection strings and credentials verified untouched.
- [x] Migration SQL is strictly additive (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- [ ] Confirm Render dashboard has valid `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.

---

## 3. Deployment Steps

### Step 3.1: Merge Pull Request
1. Merge draft PR into `main` after standard code review.
2. Ensure commit message references the resolution of the Razorpay subscription 400 issue and plan reuse architecture.

### Step 3.2: Automated Migration & Service Startup
1. Render triggers automated build and deployment from `main`.
2. `src/server.js` startup routine executes `runMigrations(pool)` before opening the HTTP port.
3. Migration `020_subscription_plan_registry.sql` executes and records version `'020_subscription_plan_registry.sql'` in `schema_migrations`.
4. Fastify server begins listening on designated port and starts the background email outbox worker.

---

## 4. Post-Deployment Smoke Verification Checklist

Immediately following deployment to Render:

1. **Health Check:**
   - Execute: `GET https://milvanta-backend.onrender.com/api/v1/health`
   - Verify HTTP 200 with status `ok`.

2. **Test Mode Subscription Verification:**
   - Log in as a test customer on `https://milvanta.in`.
   - Select **Pure Fresh Cow Milk**, pack size **1 Litre**, duration **1 Month Continuous Plan**.
   - Proceed to payment and click **Proceed to Payment**.
   - **Check Render Logs:**
     - Confirm absence of `stage: subscription_create gatewayStatus: 400`.
     - Confirm successful subscription creation and response containing `subscriptionId`.
   - Complete payment in Razorpay Test Mode modal with standard test UPI/card.
   - Confirm redirect to subscription success screen with calendar delivery dates scheduled.

3. **Plan Reuse Verification:**
   - Repeat the checkout for the same milk product and size from a different test session.
   - Inspect Render logs to verify the existing plan is fetched via `razorpay.plans.fetch()` and reused without invoking `razorpay.plans.create()`.
   - Query `subscription_plan_registry` in database to verify single plan entry.

---

## 5. Rollback Strategy

Because all changes are backwards-compatible and additive:

1. **Application Rollback:**
   - In Render dashboard, click **Rollback** to previous release commit, or revert the git commit on `main`.
   - Previous application code will ignore `subscription_plan_registry` completely.
2. **Database State:**
   - No table drops or column alterations are necessary.
   - `subscription_plan_registry` will remain dormant and harmless.
3. **Gateway State:**
   - Existing Razorpay plans on gateway remain intact.

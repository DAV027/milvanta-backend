# MILVANTA — Subscription payload and plan registry hardening

**Date:** November 4, 2026
**Branch:** `fix/razorpay-subscription-create-root-cause-400`
**Status:** Implemented on a draft PR. **Actual Razorpay Test Mode subscription creation not yet verified.**

## Scope

- Changed `customer_notify` from integer `1` to boolean `true`.
- Omitted optional blank `notes.customerPhone` / `notes.startDate`; included `start_at` only when a future Unix timestamp is available.
- Expanded sanitized Razorpay HTTP 400 classification without returning raw gateway descriptions or payment credentials to the browser.
- Added an additive `subscription_plan_registry` migration and a canonical, indexed plan lookup.
- Implemented PostgreSQL transaction-scoped advisory locking in `getOrCreateRazorpayPlan`. The deterministic lock key includes `keyMode`, product, size, amount and daily rate, and is held across the lookup, remote plan creation/fetch and local DB write.
- Added a partial unique index for one active local plan row per canonical configuration.
- Fail closed on registry read/write errors, ambiguous gateway fetch failures, or unknown payment mode. Do not create a replacement plan when a fetch times out or returns 401/5xx.

## Plan resolution and lifecycle

1. Validate product, authorized size, trusted price and whether the gateway is Test or Live.
2. Take a dedicated PostgreSQL connection, begin a transaction and acquire a transaction advisory lock for the canonical plan tuple.
3. Select a matching active registry plan; if none, check historical subscription records as candidates.
4. A candidate is reusable **only** if it can be fetched with the current Razorpay credentials and its period, interval, currency and amount match.
5. On a definitively missing plan (HTTP 404) or known attribute mismatch, deactivate its registry row for the current mode and create a replacement.
6. Persist the newly created plan **before** committing, then release lock and connection. A failed DB write aborts the checkout, instead of reporting success with an untracked plan.
7. **No actual Razorpay POST was used to verify this flow.** The gateway behavior in automated tests is mocked.

### Residual concurrency / reconciliation limitations

The advisory lock prevents two cooperating instances from creating *the same plan* simultaneously, assuming PostgreSQL is available. It does not provide atomicity between Razorpay and PostgreSQL, nor prevent two concurrent checkouts by the same customer from independently creating *subscriptions* after the plan lock is released. The existing 15-minute pending-authorization lookup happens before gateway subscription creation, so customer-level concurrent subscription attempts still need an independent idempotency design.

Plan creation followed by a crash, timeout, or database failure can still leave a gateway plan to reconcile. Existing unlinked Razorpay plans created before this registry was introduced are **not automatically imported** without a verified lookup.

## Payment and billing semantics

The current checkout uses `total_count: months`: a one-month plan has a single billing cycle; a two-month plan has two. It is a **fixed-term subscription**, not an endless monthly auto-renewal. Any switch to indefinite renewal requires explicit customer consent and an additional billing/entitlement design review.

**Payment environment:** A `rzp_test_` configuration supports Test Mode validation only. Test Mode subscriptions and local `active` statuses are not proof of collected real funds. No real delivery should rely on Test Mode payment authorization.

## Verification

Isolated PostgreSQL CI validates the plan lookup, concurrency lock, failure paths, customer-facing sanitized responses and existing order-payment regressions. Record the actual latest GitHub CI count in `TEST_RESULTS.md` after the run completes.

### Release checklist

- [ ] GitHub CI all jobs passing on the current PR head.
- [ ] Root-cause report explicitly marks integer notify/blank notes as hypotheses rather than observed gateway rejection details.
- [ ] One separately approved controlled Test Mode `POST /v1/subscriptions` with an existing verified plan succeeds; no payment authorization during the initial diagnostic.
- [ ] Review customer-level subscription idempotency and prevent fulfillment based on Test Mode mandates.
- [ ] Explicit approval before merge: Render auto-deploys `main`.

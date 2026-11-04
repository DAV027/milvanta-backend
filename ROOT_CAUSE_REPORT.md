# MILVANTA — Razorpay Subscription HTTP 400: Evidence and Mitigations

**Date:** November 4, 2026
**Branch:** `fix/razorpay-subscription-create-root-cause-400`
**Status:** **Exact gateway root cause NOT YET CONFIRMED.** Code defects and resilience risks identified; no approved actual gateway POST has validated the patch.

## Verified production evidence

On November 4 at **05:46:38 UTC**, after PR #26 deployed, Render recorded a failed `POST /api/v1/subscriptions/razorpay-checkout` with:

```text
stage=subscription_create
gatewayStatus=400
gatewayErrorCode=BAD_REQUEST_ERROR
gatewayReason=unclassified
planCreated=true
keyMode=test
```

The account's Razorpay **Test Mode** dashboard displayed newly created monthly cow-milk plans for ₹3,150 (1 L) and ₹1,677.50 (500 ml), each with **zero linked subscriptions**. This supports the conclusion that plan creation succeeded but subscription creation was rejected. It does **not** reveal the rejected field or the provider's actual error description. Local read-only GET probes using a separately supplied key pair passed with HTTP 200; GET access does not guarantee POST access.

## Candidate contributing issues (unproven gateway causes)

1. **`customer_notify` representation:** Existing backend code used the integer `1`. The proposed patch changes it to the explicitly typed boolean `true`. This improves compatibility with the Razorpay create-subscription API contract, but **no production error field/description confirms this was rejected**. Do not state that the gateway explicitly returned “The customer_notify field must be true or false.”
2. **Empty `notes` attributes:** Immediate-start requests contained `notes.startDate: ""`, and missing customer phones could result in `notes.customerPhone: ""`. The patch omits empty fields. **No actual gateway response proves blank notes caused the observed HTTP 400**.
3. **Diagnostic coverage:** The classifier originally yielded `unclassified` for the production error. The patch recognizes more error field/description shapes, but the original provider response was never captured. Recognized reason codes from mocked tests are not evidence that Razorpay emitted them.
4. **Orphan plan creation:** This is a **confirmed architectural flaw**, distinct from the unknown reason for HTTP 400. Before this branch, repeated checkout attempts created a new Razorpay plan even when the later subscription create operation failed. The dashboard showed unlinked plans created on the failure date.

## Changes in this branch

- `src/server.js`: omit empty optional notes, use `customer_notify: true`, validate optional future `start_at` when provided.
- `src/razorpaySubscriptionErrors.js`: normalize underscore-based field descriptions and classify known error fields into safe reason codes; do not expose arbitrary provider error bodies.
- `migrations/020_subscription_plan_registry.sql`: persist validated plans by configuration and payment environment. Enforce a partial unique index for one active registry record per tuple.
- `getOrCreateRazorpayPlan`: serialize matching plan lookups, remote fetch/creation, and registry persistence with a **transaction-scoped PostgreSQL advisory lock** (held across instances). Database/registry failures abort checkout rather than silently issuing new gateway plans.
- `tests/razorpay-subscription-plan-reuse-and-payload.test.js`: mocked payload and database checks, including simultaneous creation calls, gateway fetch failures, and registry storage errors.

### Limitations and remaining risks

- Gateway plan creation and PostgreSQL commit are **not an atomic distributed transaction**. Process crashes, network ambiguity or failed persistence after plan creation can still orphan plans. Reconcile gateway resources before retrying ambiguous attempts.
- Plan locking prevents duplicate *plan* creations for cooperating callers. It does **not** make the full subscription creation endpoint idempotent across concurrent requests to the same customer: the existing 15-minute pending-authorization check is performed before the external subscription POST without a per-customer transaction lock. This warrants separate hardening before broad public rollout.
- Historical subscription fallback has no stored gateway mode; candidate plans must be successfully fetched in the current test/live account before reuse.
- The previous successful October 21 Test Mode subscription proves earlier success, not that a newly proposed payload will be accepted now.
- **Never treat `rzp_test_` payments as real funds or permit Test Mode status alone to authorize real delivery.**

## Validation criteria

1. Run GitHub CI with isolated disposable PostgreSQL; report the exact passing count and failures.
2. Independently review the release diff, transaction lock, unique partial index, and candidate-mode verification.
3. With separate approval, perform **one** minimal Test Mode `POST /v1/subscriptions` using a verified existing plan; do not authorize payment or mandate. Inspect sanitized response and reconcile created resources.
4. Only if the real gateway request succeeds may the HTTP 400 be regarded as mitigated. A successful mock run alone does not establish gateway readiness.
5. Do not merge into `main` or deploy to Render until approved; `main` is auto-deployed.

## Outcome

**Engineering improvements implemented; exact provider rejection reason remains unknown.** The first verified actual Test Mode subscription POST after the patch will determine whether these changes resolve the observed failure.

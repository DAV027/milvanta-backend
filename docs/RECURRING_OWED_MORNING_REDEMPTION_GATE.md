# Recurring owed-morning redemption — review gate

**Status: UNRELEASED / NOT DISPATCH-READY. Draft PR #37 only.**

This phase adds a read-only eligibility preview and a separately feature-gated, admin-audited **finance approval** of pending first-cycle obligations. **Neither creates delivery orders, extends paid-through dates, changes Razorpay mandates, issues refunds, or sends WhatsApp/email.** No public or admin HTTP route exposes approval.

## What the review checks

- One-month, first-paid-cycle recurring subscription with notes.keyMode === 'live', captured payment ID and explicit fulfillment entitlement
- The obligation matches that customer, subscription, Razorpay subscription, payment ID and daily price
- Finance has approved the obligation; otherwise it remains finance_approval_required
- The target morning is strictly **after** the authoritative paid-through date; renewal coverage rules out a second delivery
- Subscription is active; new paid cycle (paidCount !== 1) or multi-month contract is blocked pending separate reconciliation
- IST cutoff passed, no existing order for that date
- No customer skip, active vacation/pause, pending or completed refund, or missing verified address
- A positive balance of owed_mornings - fulfilled_mornings - refunded_mornings remains

The preview returns canGeneratePhysicalOrder: false **even for eligible review candidates**. Financial review is not permission to generate, pack, deliver or notify.

## Finance approval

The function approveRecurringMorningObligation() requires a valid admin account, an auditable case reference, first-cycle captured-live payment evidence and no conflicting refund. It locks the obligation, changes only pending_reconciliation to approved, and writes one immutable audit event (adjusted, days_delta 0). Repeated approvals do not write duplicates. It never modifies entitlement or payment.

Approval is OFF unless explicitly opted in programmatically, and in non-test environments it also requires the process environment value RECURRING_MORNING_REDEMPTION_APPROVAL_ENABLED=true. No API route calls approval. **Do not enable in production before an authorized authenticated finance-review interface has been designed and approved.**

Initial liability accrual remains independently OFF unless RECURRING_MORNING_OBLIGATIONS_ENABLED=true. Do not enable that flag either.

## Atomic reservation prototype added — STRICTLY TEST ONLY

Migration 022 adds a reservation row, unique links to the obligation, subscription/date and delivery order, and a `fulfillment_source` marker on orders. Existing normal orders default to `paid_entitlement`. Prototype orders explicitly use `owed_morning_prototype`; the **normal admin/driver fulfillment service rejects these rows** with HTTP 409, regardless of the feature flag.

The new internal module `src/services/recurringMorningReservationPrototype.js` has two functions:

- `reservePrototypeOwedMorning`: In one transaction, locks the subscription first and approved obligation second; rechecks current paid cycle, last captured live payment, paid-through coverage, skip/pause/refund and verified address; counts active holds against owed balance; inserts exactly one uniquely sourced *prototype* order and one linked reservation. Concurrent attempts for the same date or more dates than owed cannot succeed.
- `transitionPrototypeOwedMorning`: Models scheduled → packed → out-for-delivery → delivered, plus cancellation/failure. It rechecks subscription payment/cycle and current paid-through date under locks. Only a successful **test-simulated delivered** transition increments `fulfilled_mornings` and records one audit event; failed/cancelled transitions release the hold without incrementing fulfillment.

Both functions **reject every non-test environment**, even if `RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED=true`. They additionally require that exact flag in isolated tests. They are NOT imported into the existing delivery generator, admin routes, worker, or cron. They do not send notifications or call Razorpay. **The simulated prototype delivery does not constitute an actual delivered milk order.**

## What still blocks production physical redemption

A later renewal can overwrite a previously valid owed morning; the prototype proves a lock order and a recheck, but **is not a production entitlement or refund ledger**. Before release:

1. Design a release-grade transactional boundary shared by the normal delivery generator, gateway webhook, manual admin and all bulk cancellation/skip/vacation paths. The prototype alone is insufficient: operational bulk cancellations currently bypass its release hook.
2. Review delivery status transitions and customer proof-of-delivery; connect counters and idempotent audit only after genuine physical fulfillment, not a simulated transition.
3. Reconcile future Razorpay renewal cycles, including the case where an order was reserved before a later renewal, and specify what amount should be credited or refunded instead.
4. Block double refunds: reserved/fulfilled/refunded accounting must be consistent with the existing refund_requests, subscription_entitlement_ledger and subscription_billing_adjustments.
5. Complete multi-month installment accounting, finance roles, verified customer disclosures, an owner-approved rollout, and disabled-by-default production switches.

**Do not set either the finance ledger flag or the prototype reservation flag in production. Do not merge PR #37 or deploy this code without the accounting and merchant release decision.**

## Verification

- Pure assessment tests: tests/recurring-morning-redemption.test.js
- Isolated PostgreSQL approval and preview: tests/recurring-morning-redemption-postgresql.test.js
- Migrations 021 and 022 define the independent liability and test-only order-reservation schemas.
- Concurrent/failed/cancelled/renewal/paused test cases: `tests/recurring-morning-reservation-prototype-postgresql.test.js`.
- No production delivery-generation, scheduler or HTTP API integration was added.
- All test records are synthetic, using disposable PostgreSQL schemas; no production or staging access.

**Keep PR #37 draft, unmerged and undeployed until accounting policy and release approval are documented.**

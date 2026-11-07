# Milvanta recurring finance reconciliation — read-only review gate

**Status:** Draft PR #37 only. No production API, scheduled job, gateway request, refund, credit issue, or live customer update.

## Why the new report is necessary

The current recurring billing adjustment table records a signed number of days, an amount and free-form notes, but **does not retain authoritative delivery dates or an original Razorpay cycle/payment ID per credit**. Skip, vacation, resume and unskip actions can create entries against the same underlying morning. A second, independent purchased-mornings obligation ledger exists for first-cycle shortfalls. Simply adding credit days to owed mornings risks compensating the same milk-delivery morning twice.

The existing subscription entitlement report also derives "total contract amount" from a plan value rather than summing *verified captured gateway payments*. **Do not use that contract amount as evidence that refundable cash was collected, especially for multi-month plans with installment charges.**

## Implemented — source inventory only

Internal module: src/services/recurringFinanceReconciliation.js

- The snapshot routine uses a single **REPEATABLE READ READ ONLY** PostgreSQL transaction and reads subscription status and current effective paid-through date.
- It aggregates signed recurring billing credit/extension/refund adjustments, but does not automatically count an adjustment as money owed.
- It summarizes entitlement-ledger entry types, actual delivery-order statuses (distinguishing paid entitlement vs non-operational prototype), existing purchased-morning obligations and reserved/fulfilled/refunded counters.
- It separately summarizes pending/processing refund requests, approved-but-unconfirmed amounts, and processed amounts with gateway receipt evidence.
- It flags missing live/captured payment proof; multi-month contracts or paidCount not equal to 1; credit-obligation overlaps; outstanding reservations; unmatched obligation payment identities or prices; unverified refunds; amount/rate mismatches; and missing delivery fulfillment ledger rows.
- Every report returns requiresManualFinanceReview=true; customerPayableCreditPaise=null; customerRefundableAmountPaise=null; and ALL auto-credit, auto-refund and auto-dispatch permissions false.

Only synthetic fixtures and disposable PostgreSQL are used in tests. This function is **not** exported through any HTTP endpoint and is **not** called by cron, account pages or the existing admin refund workflow.

## Finance review needed before proposing actual compensation

1. Independently reconcile **captured Razorpay payment amounts and timestamps** against billing-cycle terms and the actual delivery ledger, not the plan's full contract value.
2. Build date-stamped source records for skips, vacations, pauses and reversals, including source event IDs, payment IDs and original billing cycle IDs. Free-form notes alone cannot establish exactly which morning a credit compensates.
3. Identify and remove duplicate provenance across (a) legacy subscription_billing_adjustments, (b) subscription_entitlement_ledger, and (c) purchased-morning obligations. A customer-facing credit must have a unique normalized source key.
4. Reconcile reservations: every reserved morning must be either genuinely delivered and consumed or definitively released before finance closes a claim.
5. Reconcile refunds using **gateway refund IDs and payment IDs**; approved/manual status is not proof of settlement. Prevent a refund and future delivery credit from compensating the same morning.
6. For multi-month plans, validate each captured installment, plan total, actual charged amount, paid-through and renewal boundaries before any refunded or redeemed amount is computed.
7. Make a merchant-approved choice for unused credits if recurring renewals keep extending the paid-through date indefinitely.

**Until these records exist, do NOT enable automatic adjustments, issue refunds, extend Razorpay billing dates, activate the prototype physical-delivery path, or merge and auto-deploy PR #37.**

## Tests

- tests/recurring-finance-reconciliation.test.js — pure numeric, cross-ledger, invalid evidence and fail-closed tests.
- tests/recurring-finance-reconciliation-postgresql.test.js — isolated end-to-end read-only snapshot and verified absence of mutations.
- Existing refund and reservation suites remain enabled. All tests use the disposable schema guard; do not run against staging or production.

Related release decision: Issue #36, docs/RECURRING_FIRST_CYCLE_BILLING_POLICY_GATE.md and docs/RECURRING_OWED_MORNING_REDEMPTION_GATE.md.

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

## What still blocks automatic physical redemption

Renewal coverage can overlap mornings that appeared owed under an earlier cycle. The existing Milvanta delivery engine creates physical orders from verified paid-through coverage only; it must not generate extra orders based on a pending finance liability.

1. Build one atomic transaction locking subscription, gateway/cycle evidence, obligation, and delivery date consistently. Recheck no newer paid cycle under the same lock.
2. Introduce a reservation row linked to a uniquely generated delivery order, with reserved/fulfilled/released statuses and exact obligation balance accounting.
3. Settle only on actual delivered status; release on failure, skip, cancellation, pause and bulk cancellation.
4. Recheck renewal overlap at dispatch, not just when order is generated.
5. Define what to do if renewals indefinitely extend coverage: approved cycle credit, paused/adjusted billing, or reviewed refund. This preview intentionally blocks paidCount > 1.
6. Complete multi-month installment reconciliation, finance roles, customer disclosures, and anti-double-refund tests.

## Verification

- Pure assessment tests: tests/recurring-morning-redemption.test.js
- Isolated PostgreSQL approval and preview: tests/recurring-morning-redemption-postgresql.test.js
- Migration 021 remains source of truth. No new physical order-generation migration or scheduler integration is added.
- All test records are synthetic, using disposable PostgreSQL schemas; no production or staging access.

**Keep PR #37 draft, unmerged and undeployed until accounting policy and release approval are documented.**

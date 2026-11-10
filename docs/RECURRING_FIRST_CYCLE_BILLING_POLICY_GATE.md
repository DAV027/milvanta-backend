# Recurring first-cycle billing policy — launch decision required

**Status:** DRAFT / NOT APPROVED FOR PRODUCTION. An opt-in, finance-review-only obligation ledger has been implemented; automatic credit redemption, refunds and payment-cycle adjustments remain disabled.

## Verified code facts

- Checkout prices calendar months as all days in each selected month, and Razorpay recurring mandate uses a fixed payment cycle.
- The earliest potential physical delivery is governed by the **20:00 IST** cutoff: purchase before 20:00 -> not earlier than next morning; purchase at/after 20:00 -> not earlier than the morning after next.
- An actual delivery requires captured payment and explicit live gateway mode, plus validated paid-through entitlement, address, no pause/skip, and a persisted delivery-order row.
- For an **in-progress current month**, full-month days priced can exceed even the *maximum possible* deliveries remaining in the month.
- Changing Razorpay start_at, billing cycle, refund, renewal, credits or entitlement is an accounting change. Do **not** silently change any of them.
- Existing subscription_billing_adjustments already covers skip/vacation credits for recurring plans; it does not automatically reconcile pre-purchase days in a partly elapsed calendar month.

## Reproducible first-cycle exposure

The pure read-only module src/services/recurringCoverageAudit.js computes *potential* (not guaranteed) first-cycle available mornings, and theoretical credit exposure using only a timestamp, calendar offset, months and daily rate.

| Example (IST) | Month charged | Earliest possible morning | Priced days in first month | At most available | Before-start shortfall | Value at ₹105/day |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Nov 6 2026 at 19:59:59 | Nov 2026 | Nov 7 | 30 | 24 | 6 | ₹630 |
| Nov 6 2026 at 20:00:00 | Nov 2026 | Nov 8 | 30 | 23 | 7 | ₹735 |
| Nov 6 2026 at 20:00:00, offset +1 | Dec 2026 | Dec 1 | 31 | 31 | 0 initial gap | ₹0 initially |
| Dec 1 2026 at 00:00 IST | Dec 2026 | Dec 2 | 31 | 30 | 1 | ₹105 |

**These rows describe the gross unavailable portion of the customer's selected calendar month, NOT a payable credit balance.** Milvanta can already extend the first paid-through date into the following month (for example, a November 6 start with one paid month may cover through December 5). Those existing December mornings must be counted before creating any additional obligation. Gateway `current_end` may alter the authoritative paid-through date, so finance must use the actual verified cycle dates.

**Net illustrative exposure, assuming a November 6 entitlement start and a December 5 inclusive paid-through date:**

| Verified payment time (IST) | First possible morning | Mornings possible through Dec 5 | Purchased mornings | Additional owed mornings | Value at ₹105/day |
| --- | --- | ---: | ---: | ---: | ---: |
| Nov 6, 19:59:59 | Nov 7 | 29 | 30 | 1 | ₹105 |
| Nov 6, 20:00:00 | Nov 8 | 28 | 30 | 2 | ₹210 |

The new `previewRecurringMorningObligation` calculation uses the *actual planned entitlement start, captured-payment verification time, paid-through date, and purchased day count*. It does not double-issue credits for calendar mornings already covered in the paid-through period.

**Implementation status:** Migration `021_recurring_morning_obligations.sql` defines an auditable obligation/event ledger with unique cycle/payment constraints. The captured-payment webhook can record an initial **pending_reconciliation** obligation for one-month plans, but only when `RECURRING_MORNING_OBLIGATIONS_ENABLED=true`. This flag defaults OFF. The feature requires an exact captured INR payment tied to the known live Razorpay subscription and first cycle; mandate-only, Test Mode, missing-cycle, and multi-month cases are excluded. Ledger recording does not itself extend delivery eligibility, issue/refund cash, change Razorpay billing dates, or send notifications. Production enablement, obligation redemption, refund settlement, and multi-month accounting remain separate review gates.

**Important:** Payment delays, failed deliveries, skips, pauses, and gateway current-end discrepancies can change actual obligations. This is not an automatic customer refund or guarantee of immediate dispatch.

## Choose and approve ONE policy before enabling public recurring checkout

**A — Calendar-cycle coverage:** Explicitly disclose that billing purchases coverage for a fixed calendar period, which may start in progress; charge only for deliverable remaining days or give a transparent immediate difference/credit and reconcile it against the Razorpay charge. An existing fixed-price subscription **does not currently implement** pro-rated billing.

**B — Purchased-mornings guarantee (recommended):** Guarantee the number of purchased mornings. If an initial paid cycle cannot fulfill them, track unserved purchased days as an auditable credit/owed-delivery obligation, carry them forward without incorrectly extending Razorpay's billing dates, and consume only when actually fulfilled. Credit or refund unused balance when term ends or a subscription is cancelled; keep idempotent payment, delivery and refund evidence and ensure no double fulfillment. Requires a separate reviewed ledger design, customer disclosure, reconciliation and tests.

**C — Restrict new recurring starts to a future full month:** Avoid known initial shortfall by not selling a current-month full-duration plan after the month has begun. Explicitly present next-month start in checkout, verify Razorpay start_at/capture occurs before first delivery, and still reconcile delayed capture. This would be a substantial customer checkout behavior change and **is not yet implemented or approved**.

## Release restrictions

1. Until the merchant confirms the policy and code/tests implement it, **do not merge PR #37** if main automatically deploys the public recurring checkout.
2. Keep automatic cron and manual physical dispatch inactive until owner sign-off and the live gateway/payment safety audit.
3. Do not perform customer refunds, mutate renewal cycles, backfill credits, or infer a full paid entitlement from a mandate authorization.
4. Run full isolated PostgreSQL tests and browser tests, plus manual screenshot review, before owner-approved deployment.
5. The existing optional future-start recurring plan is **not proof of delivery**. The same capture and scheduling gates apply.

## Approval record to be completed by merchant

- Selected policy (A / B / C):
- Treatment of old subscriptions bought late in month:
- Razorpay current payment-cycle/plan reconciliation procedure:
- Customer-facing delivery and payment terms:
- Refund/credit reconciliation rules and audit owner:
- Approved rollout / rollback instructions:

Owner approval is not inferred from code review or CI success.

# Milvanta — recurring finance decision worksheet (REVIEW ONLY)

**Status: draft PR #37; internal, read-only, no public/admin route, no automatic payout/dispatch.**

## Purpose

The first-cycle \`subscription_recurring_morning_obligations\` table contains a **count** of owed mornings, not an approved, unique allocation to delivery dates. Separately, \`subscription_billing_adjustments\` may contain credits for skipped and vacation mornings, including later unskip reversals. More than one positive credit source can refer to the **same morning**. Counting these independently can overcompensate a customer.

The internal \`src/services/recurringFinanceDecisionWorksheet.js\` produces a finance review packet, not an entitlement, financial calculation or contract decision. It uses one \`REPEATABLE READ READ ONLY\` PostgreSQL snapshot and no Razorpay requests.

## What the worksheet checks

- Each date-stamped skip/vacation/pause-resume/unskip evidence row is grouped by **actual delivery date**, not merely the month or nominal plan total.
- The row's signed amount and +/- one day must match the subscription's daily rate. Incomplete or orphaned source entries are reported separately from legacy adjustments without provable dates.
- A morning with multiple **positive** credit claims is flagged, even if a later unskip brings the **net** number down. Reversal without a corresponding positive source is flagged.
- Real paid-entitlement deliveries on credited dates are flagged. Prototype reservations and prototype orders are explicitly **not** counted as genuine delivered milk or approved financial compensation.
- Credits recorded after the effective paid-through date are flagged for review rather than silently carried into another billing cycle.
- Owed-morning counts, fulfilled/refunded count, and prototype holds are separately inventoried; **no owed morning is assigned a new compensation date** by this worksheet.
- Pending, approved or processed refunds remain evidence that needs verified gateway resolution. The supplied Razorpay payment/invoice/refund snapshot is separately evaluated by the prior offline gateway comparator.
- Missing or incomplete gateway snapshots, multi-month plans, renewed cycles, unverified live payment mode, and incomplete entitlement evidence are all unresolved review gates.

The output always contains \`manualDecisionRequired=true\`, \`customerPayableCreditPaise=null\`, \`customerRefundableAmountPaise=null\`, \`newDeliveryEntitlementDays=null\`, all auto-action permissions \`false\`, and \`independentlyConfirmedSettlement=false\`.

**Never interpret an empty list of review flags as authorization to pay.** The current system has neither independently authenticated gateway settlement evidence nor a merchant-approved customer compensation policy.

## Merchant finance decisions still needed

1. **Per-morning benefit policy:** Is a skipped/vacation day a credit toward a future invoice, a postponed delivery, or refund-eligible cash? Are these alternatives mutually exclusive? Are reversals allowed after the paid-through date?
2. **Owed first-cycle mornings:** Choose whether verified shortfalls are delivered in the next eligible service window, credited on an invoice, or refunded; define expiration (if any) and renewal overlap behavior.
3. **No double compensation:** One normalized origin key should connect the date, original captured payment and billing cycle, existing credit, obligation, refund reference and delivered order. A date-level ledger alone is insufficient.
4. **Multi-month and installment treatment:** Confirm only **captured gateway payment amounts** associated with fully verified cycle/invoice evidence are available for finance consideration; nominal contract value is not cash collected.
5. **Proof and settlement:** Verify final refund/chargeback/settlement evidence independently, and require genuine delivered status proof before consuming a morning.
6. **Review workflow:** Separate operator/reviewer roles, immutable case ID, clear customer disclosure, dispute resolution, rollback, limits and an explicit merchant-approved launch checklist.

## Tests / isolation

- \`tests/recurring-finance-decision-worksheet.test.js\`: duplicate credits, signed reversals, already-delivered mornings, invalid dates/rates, prototype holds, unpaid or multi-month evidence and all no-action contracts.
- \`tests/recurring-finance-decision-worksheet-postgresql.test.js\`: a disposable PostgreSQL snapshot of two positive credits for the same morning, an outstanding obligation, a prototype hold and a pending refund; verifies absolutely no changes to those rows.
- The worksheet is not imported by \`src/server.js\`, scheduled jobs, refund approval, or delivery generation. It creates no migration or new financial data.

**Keep PR #37 DRAFT and do not enable credit evidence/accrual/finance approval flags, dispatch, merge, deployment or customer-facing payouts until policy and evidence gates are independently approved.** Related Issue #36.

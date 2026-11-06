# Milvanta — Gateway Mode Reconciliation Gate

**Status:** Release checklist for draft PR #37. **No automatic backfill. No staging. No production changes.**

## Why this exists

`customer_subscriptions.notes.keyMode` is expected to be exactly `live` or `test` for a known Razorpay account mode. A pre-existing subscription may have missing, blank, or legacy values. A captured payment ID or a paid-through date alone cannot prove which gateway mode authorized that transaction. **Never automatically treat missing metadata as live.**

For newly captured prepaid custom-day subscriptions, the backend stores the configured Razorpay key's **mode only** at payment materialization. It never stores the payment key or secret in notes. Recurring subscriptions already record mode at checkout.

## Customer-facing treatment

| Payment / order evidence | Calendar / next-delivery treatment |
| --- | --- |
| Pending payment or mandate-only authorization | `pending_payment`, no projection |
| Captured evidence + explicit `test` mode | `test_mode`, no physical dispatch claim |
| Captured evidence + missing/legacy/unknown mode | `mode_unverified` / “Payment Gateway Verification Required”; no physical dispatch claim |
| Captured evidence + explicit `live` mode, eligible future date, **no order row** | `eligible` — paid future day, order not generated |
| Same, **persisted scheduled order row** | `scheduled`; order provenance included |
| Any mode, previously persisted `delivered` / `failed` row | Show the historical fact, not an invented prospective delivery |
| Test or unverified mode, erroneously persisted scheduled/packed/out-for-delivery row | Show gateway warning with `hasGeneratedDeliveryOrder: true`; **do not advertise it as dispatch-ready** |

For the calendar, a mode-unknown/test day is not editable as a delivery. Unattended cron uses `liveGatewayOnly: true` and skips every value except exactly `live`.

**Important distinction:** The existing **manual admin** generation endpoint is separate from unattended cron. Its availability is *not* permission to dispatch legacy/test-mode orders. Keep all physical dispatch disabled pending operator approval, including manual generation.

## Read-only inventory of modes

Run only in a separately authorized read-only database session, keeping all results inside the operations environment. This query returns aggregate counts without personal data, key IDs, payment IDs, or addresses.

```sql
SELECT
  COALESCE(NULLIF(notes->>'keyMode', ''), '(missing)') AS gateway_mode,
  plan_type,
  status,
  COUNT(*) AS subscription_count
FROM customer_subscriptions
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

Do **not** run a bulk `UPDATE ... SET notes = jsonb_set(..., '{keyMode}', '"live"')` to resolve unknown values.

## If an existing subscription needs manual reconciliation

1. An authorized operator identifies the subscription within Milvanta's secured admin environment, without exporting customer records into chat or CI logs.
2. Independently verify its **original** Razorpay account/mode and captured transaction using Razorpay's authoritative merchant dashboard or properly authorized gateway APIs. Verify the relevant source order/subscription association, amount/currency, capture status, refunds/disputes, and applicable paid period. A `pay_...` ID string or a current `RAZORPAY_KEY_ID` alone does **not** prove a historical charge was live.
3. Document the evidence and reviewer/approval in the internal finance/operations audit trail, with secret/PII redaction. Do not edit gateway or renewal schedules.
4. If, and only if, independently confirmed live and authorized by the merchant, propose a **separate reviewed migration** limited to the individually approved subscription IDs. Use a transaction, precondition assertions, idempotency, audit history, and rollback procedure. No bulk conversion.
5. Review eligibility, existing scheduled-order provenance, customer-facing messaging, prepaid/recurring paid-through and delivered-day ledger before considering any physical fulfillment.

If records cannot be conclusively verified, leave their mode unverified and escalate to operations. Test-mode subscriptions are not evidence of an actual paid entitlement for physical dispatch.

## Release controls

- Draft PR #37 remains unmerged and undeployed while recurring calendar-month billing policy is undecided (issue #36).
- Do not enable delivery cron or perform manual physical dispatch in Razorpay Test Mode.
- Do not trigger WhatsApp, email, subscription billing, refunds, renewals, or customer deliveries from verification.
- Rebuild the verified Cloudflare ZIP from the **approved exact commit**; browser acceptance must run against local mock fixtures before any authorized rollout.

# Subscription notification entitlement fix

Both activation and renewal notifications now require active status, explicit boolean `fulfillmentEntitled: true`, a nonblank server-recorded captured-payment reference, and a valid, unexpired effective paid-through date. A reference alone or mandate-only authorization cannot authorize a message.

The guard delegates date/extension accounting to `getEffectivePaidThroughDate()` and uses the existing IST date helpers. Renewal parameters and event keys use the effective date, including prepaid extensions. Recurring plans retain their existing accounting. Invalid legacy schedule dates are ineligible; database errors still propagate. No Razorpay accounting, subscription-domain function, migration, or existing event-key format changed.

Validation: **350 passed, 0 failed, 0 skipped**, preserving all 324 previous tests and adding 26 PostgreSQL cases. Cases cover missing/false/nonboolean entitlement, expired/invalid dates, zero paid cycles, absent/malformed payment references, mandate-only authorization, inactive statuses, valid paid subscriptions, duplicate prevention, prepaid/recurring extensions, IST midnight boundaries, and malformed rows within a valid renewal batch. Regressions were observed failing before the corresponding fixes. Focused source review has no outstanding findings.

Tests used local disposable PostgreSQL with mocked Meta configuration. No live messages, production database writes, deployment, or merge occurred. Meta remains the sole phone-messaging implementation. Production launch prerequisites remain unchanged.

Reproduce with an explicitly isolated `TEST_DATABASE_URL`:

```powershell
node --test tests/whatsapp-subscription-entitlement.test.js
npm test
```

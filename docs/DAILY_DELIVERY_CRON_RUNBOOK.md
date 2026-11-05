# Milvanta — Secure daily delivery cron runbook (DRAFT; not deployed)

## Why this is necessary

On 2026-11-05, read-only production Neon inspection showed that subscriptions **#4 Buffalo Milk (1 Litre)** and **#5 Cow Milk (1 Litre)** had verified paid-cycle evidence, active entitlement through **2026-12-03**, and valid saved customer delivery addresses. However, **subscription_delivery_orders held zero rows**. The backend code called `generateDailyDeliveries()` only from the protected admin operation `POST /api/v1/operations/deliveries/generate`; no daily generation scheduler ran automatically. The existing server's intervals handle inventory reservation expiry and email/notification outboxes, **not delivery generation**.

The two Test Mode subscriptions were created on Nov 4 at **22:59 and 23:01 IST**, **after the published 20:00 IST next-morning cutoff**. Therefore Nov 5 is **not automatically owed**; **Nov 6** is the earliest date consistent with the cutoff. The existing checkout's generic "Tomorrow, 6:00 AM" display is misleading after cutoff. Pricing and paid-through dates also need separate review, as a 30-day plan ending Dec 3 could yield fewer than 30 delivered mornings if it begins Nov 6. **Do not silently extend, refund, or change billing cycles without a defined policy and customer authorization.**

## Proposed solution in this PR

- New internal-only `POST /api/v1/internal/deliveries/generate` endpoint requires dedicated `DELIVERY_CRON_SECRET` (32–512 chars), matched using constant-time SHA-256.
- Rejects all requests before **20:00 IST**; accepts only a server-computed **tomorrow in IST**, never a user-supplied date.
- Calls existing `generateDailyDeliveries()` with `rejectPastDates: true` and **`liveGatewayOnly: true`**. The cron specifically **excludes all Razorpay `keyMode: test` and unknown-mode subscriptions** from unattended fulfillment; only explicitly `keyMode: live` rows can be dispatched automatically. The engine also requires confirmed paid entitlement, payment reference, address, non-paused/non-skipped date and guards duplicates using `UNIQUE(subscription_id, delivery_date)` / `ON CONFLICT DO NOTHING`.
- Sends only counts and target date in logs/response; never outputs customer data, secrets, account credentials or webhook values.
- No Render in-process timer; on a sleeping/free Render instance, in-process cron would be unreliable. Use an **independent** scheduled trigger.
- Existing admin preview and admin manual generation stay unchanged.
- Delivery engine generation and preview now both select `plan_type` and `razorpay_subscription_id`, so recurring mandates cannot accidentally be treated as prepaid subscriptions for extension-day calculations.

**No production migration, account configuration change, payment API call or production delivery order generation is performed by this PR.** Deployment and cron creation require owner approval.

## Deployment plan — requires explicit operator approval

1. Review PR tests and merge/deploy only when owner approves. **Do not** expose the endpoint before setting a strong delivery-specific secret in Render.
2. Generate a unique 48+ random byte secret locally. Put it in Render as `DELIVERY_CRON_SECRET` and in a **separate Cloudflare Cron Worker** as an encrypted Worker secret; never commit, paste, print, expose in browser JS or put it in a URL. Do **not** reuse Razorpay or Meta WhatsApp secrets.
3. Install an independent Cloudflare Worker Cron Trigger, without changing `milvanta.in` route bindings. Cloudflare Cron uses UTC, so **`45 14 * * *` = daily 14:45 UTC / 20:15 IST** (India has no DST).
4. Cloudflare Worker example (illustrative, not deployed here):

```js
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const response = await fetch(
        'https://milvanta-backend.onrender.com/api/v1/internal/deliveries/generate',
        {
          method: 'POST',
          headers: { 'x-delivery-worker-secret': env.DELIVERY_CRON_SECRET }
        }
      );
      if (!response.ok) {
        console.error('Milvanta delivery cron failed', response.status);
        return;
      }
      const result = await response.json();
      console.log('Milvanta daily delivery generation', {
        targetDate: result.targetDate,
        generatedCount: result.generatedCount,
        skippedCount: result.skippedCount
      });
    })());
  }
};
```

The Worker must have the secret present as an **encrypted binding** and not use request bodies/query strings for authorization. Do not log the secret. Never pass merchant payments, tokens or customer PII to this worker.

5. Configure trigger `45 14 * * *`. Confirm the first invocation occurs at/after 20:00 IST and targets **the following date**, not the current/past date.
6. Check the admin read-only preview **before** the scheduled run:

```text
GET /api/v1/operations/deliveries/generate-preview?targetDate=2026-11-06
```

This requires the existing **admin-authenticated session** and returns eligible/excluded counts; do not send its full customer list outside secure admin channels. For Nov 6, source-based read-only eligibility checks of subscriptions #4 and #5 indicate paid proof, valid saved default address and no skip/pause. **Both have `keyMode: test`, so the proposed unattended cron deliberately excludes them**. Use a disposable test DB to test fulfillment generation; do not auto-dispatch synthetic Test Mode customer records.

7. Check next-day orders exist **once each** after cron runs. The existing admin reports route is `GET /api/v1/operations/deliveries?date=YYYY-MM-DD`. Operator may use protected manual `POST /api/v1/operations/deliveries/generate` if cron missed and before the morning dispatch, only under existing administrator authorization. The DB unique constraint makes repeated generation idempotent, but manual intervention should still be reconciled.
8. Alert if active eligible subscriptions exist but `subscription_delivery_orders` has zero records for tomorrow. For critical fulfillment, set up external health/error monitoring—do not treat a successful checkout as proof of dispatch.

## Operational caveats

- **Cold-start reliability:** a Cron Worker request may be delayed by a cold Render service; monitor outcome, and provide manual admin fallback.
- **Late subscriptions:** do not backdate deliveries or bypass cutoff. Clarify the first-delivery-date/paid-through billing policy before enabling production auto-fulfillment.
- **No delivery guarantee from tests:** tests verify policy and existing engine contracts; genuine cron invocation and persisted delivery orders still need separately authorized end-to-end verification.
- **Notification behavior:** reminder notifications are only queued by the engine for generated orders if `WHATSAPP_ENABLED === 'true'`. Existing Meta WhatsApp template and delivery status need separate check. Do not reintroduce Twilio.
- **Email status:** four subscription email outbox rows for #4/#5 show `sent` and provider `accepted` on Nov 4, not independently verified inbox arrival.
- **Test Mode delivery safety:** unattended cron enforces `liveGatewayOnly:true`, skipping Test Mode and unknown-mode records in shared Neon. The existing administrator-controlled manual generator remains usable for authorized operational testing and does **not** impose that filter, so never manually generate/dispatch actual orders for synthetic Test Mode customers without an explicit nonphysical fulfillment procedure.

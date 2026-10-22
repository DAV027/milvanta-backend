# Milvanta direct Meta WhatsApp migration

This branch implements direct Graph API messaging. **Production cutover is not ready**: credentials, approved templates, real OTP/customer delivery and a provisioned scheduler have not been verified. WhatsApp is disabled in both supplied Blueprints. Meta WhatsApp is the sole active phone-messaging implementation; there is no alternate transport or fallback. No deployment, production migration or live send was performed.

## Architecture and integration base

Base commit `814468e` contains six refund/admin/calendar commits beyond `origin/main`. Review this branch against that commit for the messaging-only diff. Merging directly against main will also include those six commits; integrate the refund work first or review it as a stacked dependency. The original checkout's two uncommitted refund-file edits and untracked files were preserved and are not included.

`notificationService.js` delegates exclusively to `whatsappService.js` and `whatsappOtpService.js`. The global unique event keys remain unchanged, including the historical `sms_` prefixes, so existing payment keys cannot create duplicate confirmations. New messages are always queued with `channel = 'whatsapp'`. Only WhatsApp rows can be claimed. Historical SMS rows, provider IDs and old preferences remain untouched as audit data; there is no worker, callback, dependency or runtime option that can send them or replay them through Meta.

`whatsappService.js` uses Node fetch directly against the fixed HTTPS Graph host, with a ten-second abort timeout, no redirects and up to two retries for explicit throttling rejections. The outbox instead schedules bounded retries in PostgreSQL (five attempts, exponential delay, honoring Retry-After). Authorization/configuration/template errors fail closed; raw provider error prose is never returned or logged. No intermediary or Meta SDK is used.

Atomic SKIP LOCKED claims use unique lease tokens and persist before HTTP. A returned Meta message ID records **accepted**, never delivered. Signed callbacks advance accepted/sent/failed/delivered/read states without downgrading delivered/read. Minimal deduplicated webhook records exclude inbound text and OTP values. WABA and phone-number IDs must match configured identities. Opaque callback data links early callbacks to an in-flight outbox row. Incoming STOP/UNSUBSCRIBE/CANCEL/END/QUIT revoke WhatsApp preferences only; ordinary inbound messages are acknowledged and deduplicated, without automated replies or storing message text.

No provider can guarantee exactly-once delivery across an HTTP crash boundary. A timeout, ambiguous 5xx/malformed success, database failure after dispatch, or processing lease older than five minutes is held as **uncertain**. A subsequent signed delivery callback can reconcile it. Never automatically resend an uncertain row; an operator must verify the original request with Meta before deciding whether to retry. Batch entries refresh their leases before dispatch. Opt-out cannot recall an HTTP request already in flight.

`whatsappOtpService.js` implements the existing account-first signup flow: OTP endpoints require an active database-backed login session unconditionally. A challenge is bound to customer, normalized account phone and SHA256 of the session token. Six digits come from crypto.randomInt; salted HMAC-SHA256 digests require a separate random secret. Challenges expire after five minutes, serialize 60-second resend cooldowns by phone, allow five attempts, supersede older requests and consume verification atomically with phone_verified_at. Verification uses timingSafeEqual and no plaintext code is persisted or logged. Failed sends cannot verify. Tests require an explicitly injected mock fetch and never infer success from missing credentials.

Registration and login policy remain unchanged. `MANDATORY_PHONE_VERIFICATION` continues to gate the existing subscription/payment/order operations. Email/password recovery remains available through existing secure account flows, and never marks a phone verified. If phone verification is mandatory and WhatsApp is unavailable, phone-dependent operations remain blocked; there is no email bypass.

Preferences require explicit consent, a verified number, matching current account number, category and locale. SMS opt-in is not migrated into WhatsApp consent. Recheck consent before dispatch. Signup consent is saved only after successful OTP validation. Profile supports verification, resend countdown, category preferences and opt-out. Future language options must be added only after the corresponding templates are approved.

Migration `015_meta_whatsapp_cloud_api.sql` adds challenges, preferences, minimal webhook events and outbox metadata/statuses/indexes. It preserves migrations 001–014 and old SMS rows. Apply through the existing migration runner on isolated staging first. It requires the existing refund migration 014 from the integration base. No credentials are stored in PostgreSQL. Decide an appropriate retention policy for expired challenges and webhook metadata before launch; automatic pruning is not included.

## Environment

Configure the API and scheduler consistently:

| Variable | Value or purpose |
|---|---|
| `WHATSAPP_ENABLED` | `false` until setup and consent/template checks are complete |
| `WHATSAPP_GRAPH_API_VERSION` | Pinned configurable `v25.0`; confirm support in Meta dashboard at deployment |
| `WHATSAPP_ACCESS_TOKEN` | System-user token with WhatsApp messaging permissions; secret |
| `WHATSAPP_PHONE_NUMBER_ID` | Registered business phone-number ID, digits only |
| `WHATSAPP_WABA_ID` | Expected WhatsApp Business Account ID |
| `WHATSAPP_APP_SECRET` | App secret for exact-raw-body HMAC verification |
| `WHATSAPP_VERIFY_TOKEN` | Independently generated webhook handshake secret |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Default `en`; must match approved locale exactly |
| `WHATSAPP_OTP_HASH_SECRET` | Independent cryptographically random secret, at least 32 characters |
| `WHATSAPP_APPROVED_TEMPLATES` | Comma-separated exact `name:locale` pairs, empty by default |
| `DELIVERY_REMINDER_TIME_IST` | `21:00` default; previous evening in Asia/Kolkata |
| `MANDATORY_PHONE_VERIFICATION` | Preserve existing production policy |

Do not rotate the OTP hash secret while active challenges exist unless invalidating those challenges is intended. Do not place any credentials in frontend code, archives, URLs or database rows. Webhook verification-token query values are redacted from request logs.

## Proposed templates — all approval statuses unverified

The registry does not imply Meta approval. Each exact name/locale must be verified in WhatsApp Manager before being added to the allowlist. English `en` and `en_US` are different locales. Environment overrides `WHATSAPP_TEMPLATE_<KEY>` select actual approved names while preserving these positional schemas.

| Key | Proposed Meta name | Category | Body parameters in order |
|---|---|---|---|
| AUTH_OTP | milvanta_auth_otp | Authentication | code |
| ORDER_CONFIRMED | milvanta_order_confirmed | Utility | orderNumber, amount, deliveryDate, orderLink |
| SUBSCRIPTION_ACTIVATED | milvanta_subscription_activated | Utility | productName, quantity, startDate |
| SUBSCRIPTION_PAUSED | milvanta_subscription_paused | Utility | productName, pauseDate |
| SUBSCRIPTION_RESUMED | milvanta_subscription_resumed | Utility | productName, nextDate |
| SUBSCRIPTION_CANCELLED | milvanta_subscription_cancelled | Utility | productName |
| NEXT_DAY_REMINDER | milvanta_next_day_reminder | Utility | quantity, productName |
| OUT_FOR_DELIVERY | milvanta_out_for_delivery | Utility | quantity, productName |
| DELIVERY_COMPLETED | milvanta_delivery_completed | Utility | quantity, productName, time |
| DELIVERY_FAILED | milvanta_delivery_failed | Utility | reason |
| BILLING_ISSUE / BILLING_REMINDER | milvanta_billing_reminder | Utility | productName, dueDate |

Create the authentication template with Meta's Authentication category, expiration of five minutes and **Copy Code** button. Sending includes the same code in the body and button parameter (`type: button`, `sub_type: url`, index `0`); Meta's send schema uses `url` for this authentication button. Utility templates currently use body text parameters, including the order link; adding URL buttons requires corresponding registry/client schema changes. No delivery-skipped notification is sent because no approved skip template was supplied.

## Meta dashboard setup

1. Create/select the Milvanta business app and WhatsApp Business Account in Meta Business settings. Complete required business verification, business phone registration, display-name review and billing setup.
2. Assign the WABA and phone assets to an appropriate system user; generate a token with `whatsapp_business_messaging`, and `whatsapp_business_management` when required for asset/template administration. Store secrets in Render, never in source control.
3. In WhatsApp Manager, submit the exact authentication and utility schemas/locales above (or map existing approved templates with the override variables). Check their actual approval/quality state; populate the allowlist only with approved pairs.
4. Register the staging callback `https://<staging-host>/api/v1/webhooks/whatsapp` and the verify token. Subscribe the app to the WABA and its `messages` field. POST callbacks require `X-Hub-Signature-256` generated from the app secret over the exact body bytes. Keep the existing Razorpay webhook URL/signature configuration intact.
5. After separate authorization for real staging sends, use Meta test recipients and test credentials to verify OTP Copy Code, captured-payment confirmations, subscription transitions, delivery receipts and opt-out. No real send was authorized or performed in this implementation task.

Primary references: [Meta Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/), [authentication templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/authentication-templates/), [Graph v25 release](https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/), [Meta webhook handling](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/). Meta developer pages returned HTTP 429/unavailable during research; recheck current dashboard requirements/version support before enabling. The linked archived SDK documents handshake/signature behavior only; this implementation does not depend on it.

## Events, scheduler and rollout

Captured orders use the same unique event key from checkout verification and Razorpay callbacks, with a paid/confirmed order check. Paid subscription activation uses shared evidence validation after existing payment reconciliation. Customer pause/resume/cancel and delivery-status messages are queued atomically with their existing database mutations. WhatsApp Razorpay activation/cancel/billing hooks participate in the webhook transaction. No payment/refund calculation or state decision was changed.

Daily generation still runs at 20:15 IST (`45 14 * * *` UTC). It excludes unpaid, paused, skipped, vacation and out-of-entitlement subscriptions. Next-day reminders are scheduled for the configurable prior-evening time instead of sent at generation; the API's existing 30-second outbox sweep sends due rows. Worker rechecks current eligibility and drops stale reminders/out-for-delivery messages. Delivered/failed templates require the corresponding recorded outcome. Scheduler also queues idempotent renewal reminders three days before the recorded paid-through date. Gateway pending/halted events queue the billing-attention template.

**Provisioning assessment, 2026-10-22:** after user selected the Milvanta Render workspace, list_services returned `null` both with and without previews. The required cron service could not be verified as provisioned. No service was created or triggered. Blueprint declarations alone do not establish an active scheduler. Before launch, verify the service/repository/branch, isolated staging DB, environment, enabled status, last successful run, generated deliveries and due outbox processing. Since the cron runs before reminder time, the API sweep must also be healthy at reminder time. The staging scheduler remains disabled by default.

Cutover requires a separate production approval. Readiness is **BLOCKED** until every prerequisite is verified:

1. Integrate/review the refund dependency without unintended merges and validate unchanged migrations through 015 on isolated staging. No new SQL migration is required by the cleanup branch.
2. Verify the registered Meta WABA/business number, production system-user access token and webhook app secret.
3. Verify approved authentication and utility templates for every enabled name/locale; populate the allowlist only from actual approval evidence.
4. Confirm the signed Meta callback and run separately authorized real staging OTP and utility-message delivery tests, including receipts, failed-send behavior and consent/opt-out. No real send is authorized by this implementation brief.
5. Verify a provisioned scheduler, correct database/branch/environment and a successful generation/reminder run. A Blueprint is not provisioning evidence.
6. Inventory historical SMS and uncertain rows without sending or requeueing them. Preserve their keys and audit metadata. Resolve unknown Meta outcomes through authentic receipts/operator investigation rather than automatic retries.
7. With explicit production authorization, deploy the WhatsApp-only branch, apply existing pending migrations and configure Meta consistently on API and scheduler. Enable WHATSAPP_ENABLED only after the checks above. Verify production OTP, confirmations, reminders and consent behavior under that authorization.
8. Keep all previous-provider credentials removed from new deployment settings. If WhatsApp fails, disable sending and investigate; never switch to SMS or use email as proof of phone ownership. Existing Resend email purposes are unchanged.

This branch has exactly one phone-messaging provider. Previous two-provider rollout instructions are superseded. Historical implementation evidence remains available in Git.

## Sanitized send example

```http
POST https://graph.facebook.com/v25.0/PHONE_NUMBER_ID/messages
Authorization: Bearer [REDACTED]
Content-Type: application/json
```

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "91XXXXXXXXXX",
  "type": "template",
  "biz_opaque_callback_data": "mv:123",
  "template": {
    "name": "milvanta_order_confirmed",
    "language": {"code": "en"},
    "components": [{"type": "body", "parameters": [
      {"type": "text", "text": "MV-EXAMPLE"},
      {"type": "text", "text": "300"},
      {"type": "text", "text": "2026-10-23"},
      {"type": "text", "text": "https://milvanta.in/profile.html?order=MV-EXAMPLE"}
    ]}]
  }
}
```

Illustrative provider response, not evidence of a real send:

```json
{"messaging_product":"whatsapp","messages":[{"id":"wamid.SANITIZED"}]}
```

Internal result: `{"accepted":true,"messageId":"wamid.SANITIZED","status":"accepted"}`. Only subsequent authentic delivery/read callbacks establish delivery.

## Reproducible validation

Use Node 22+ and a **disposable local PostgreSQL database**, never production Neon/Render. Tests use separate disposable schemas and cleanup verification. Installation used embedded-postgres `18.4.0-beta.17` as temporary external tooling; it is not a production dependency. The final database uses UTF8 encoding.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:PORT/DISPOSABLE_TEST_DB'
node --test tests/whatsapp-client.test.js tests/whatsapp-postgresql.test.js
npm test
```

The new tests inject mocked fetch and signed raw-body fixtures. No real Meta request is made. See `meta-whatsapp-validation.md` for exact results and baseline comparison. Equivalent frontend files are synchronized byte-for-byte; the complete `frontend/cloudflare-upload` tree is packaged in `frontend/milvanta-cloudflare-upload.zip`. Uploading/deploying that tree is a later authorized step, not something performed by rebuilding the archive.

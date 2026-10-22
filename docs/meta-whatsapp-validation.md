# WhatsApp-only validation and delivery report - 2026-10-22

Production readiness: **BLOCKED**. Implementation is complete for review; no production deployment, migration, external provisioning or live message was performed.

## Test evidence

Node v24.21.0, local PostgreSQL 18.4 UTF8 on 127.0.0.1:55439, isolated disposable schemas, fully injected Meta transports. No production Neon or Render database was used. `npm ci --ignore-scripts --no-audit --no-fund` successfully installed the cleaned lockfile (113 packages); the removed provider is absent from both the manifest and installed dependency tree.

| Check | Result |
|---|---|
| Complete suite: npm test | 324 passed, 0 failed, 0 skipped |
| Guarded standalone integration entrypoint | 38 passed, 0 failed, 0 skipped |
| Browser, Chromium mobile 390x844 | OTP success, countdown, failed-send recovery, registration, post-verification signup consent, preference/opt-out saving, mandatory skip suppression passed |
| Browser layout | No page errors or horizontal overflow |
| Historical SMS fixture | Original row/status/attempts unchanged; shared event key blocks a duplicate Meta message |
| Active dependency/config/source absence contract | No old transport, selector, dual-drain option or callback implementation |
| Removed callback | HTTP 404 |
| SQL migrations | No changes; migration 015 byte-for-byte identical to a6aac72 |
| Frontend parity/archive | Both ZIPs synchronized; archive CRC and each equivalent file checked byte-for-byte |
| Source review | Earlier findings fixed; no remaining backend blockers reported |

The full-suite count changed from 328 to 324 because 32 mixed legacy-transport/domain cases were replaced by 23 sole-channel cases, while five additional assertions were added as independently named tests across the contract, history and admin suites. All delivery state-machine, cutoff, authorization and ownership coverage remains. Obsolete telecom/SHA1/mock-success tests were replaced by real PostgreSQL OTP and mocked Graph behavior, strict session checks, configuration failures, mandatory-phone checks, Meta template mappings, removed-route checks and signed SHA256 callbacks. No meaningful failure was hidden with skips or broad accepted-status lists.

The old standalone integration script is consolidated onto the guarded customer-acceptance, delivery-calendar and WhatsApp PostgreSQL suites. All twenty acceptance scenarios still execute, with actual challenge hashes and Graph acceptance rather than an in-memory fake verification success.

## Individual investigation of the twelve previous failures

| Previous failing test | Root cause and correction |
|---|---|
| Admin HTML disallows innerHTML | Four refund-rendering assignments interpreted server values as markup. Replaced with DOM/textContent/dataset APIs. Original security assertion preserved; added hostile-data renderer checks for fields, action IDs, reviewed/empty/error states and correct rupee amounts. |
| Valid admin key can read orders | Test had no migrated schema; SQL failed before response. Isolated schema now exists and valid key gets exactly 200. |
| Invalid checkout idempotency key | JWT fixture had no real database session/schema, never reached input validation. Real authenticated fixture now gets exactly 400 and inserts no order. |
| Missing subscription payment ID | Missing valid session/schema hid validation. Correct fixture gets 400 payment_id_required and creates no subscription. |
| Unverifiable subscription payment | Same fixture issue. Mocked gateway rejection now gets 400 invalid_payment_proof and creates no subscription. |
| Halted subscription webhook | Missing database/event/subscription fixture. Real signed event proves persisted paused state. |
| Resumed subscription webhook | Missing persisted subscription/event fixture. Real signed event proves active state. |
| Completed unpaid subscription webhook | Missing persisted fixture. Explicitly unpaid subscription proves expired state; paid entitlement rules were not changed. |
| Duplicate payment webhook | Missing persistence and previous test sent only one request. Now submits twice and proves duplicate=true, one stored event and unchanged state. |
| Outside-Hyderabad checkout | Invalid authentication fixture prevented pincode validation. Real authenticated request gets exactly 422 outside_hyderabad and no order. |
| Non-admin delivery generation | Invented JWT had no session/schema, producing SQL failure rather than authorization. Real non-admin session now gets exactly 403. |
| Unauthenticated quantity change | Quantity-change endpoint was deliberately removed in the retained calendar/refund work. Correct contract is 404 for unauthenticated and authenticated callers; no subscription mutation is allowed. No endpoint was restored. |

The API/phase-one fixture fixes alone pass 44 tests. The admin suite keeps its original injection-prevention assertion and adds a behavioral renderer regression. Product billing/refund decisions were not loosened to make these tests pass.

## Files changed and removed

- Removed src/services/twilioService.js and src/services/smsTemplates.js.
- Removed the old transport package and lockfile subtree; changed .env.example, render.yaml and render.staging.yaml to contain only Meta phone-messaging settings, disabled pending prerequisites.
- Changed src/services/notificationService.js to unconditional Meta delegates; simplified src/server.js authentication/preferences/event hooks and deleted the old callback. Existing Meta OTP/client/template implementations remain authoritative.
- Updated subscription notification comments and daily scheduler; converted scripts/verify-disposable-integration.mjs to a guarded mocked integration runner.
- Updated frontend registration/profile/checkout wording, preserved separate email-recovery wording, secured admin refund DOM, synchronized equivalent upload files, bumped affected bundles to 20261022-3 and rebuilt both tracked deployment ZIPs.
- Replaced tests/stage2-subscription-delivery-twilio.test.js with tests/stage2-subscription-delivery-whatsapp.test.js. Updated acceptance, API/payment fixtures, admin security and cache assertions; added mockWhatsApp helper, sole-channel absence/UI contracts and historical-row isolation regression.
- Updated active deployment/validation guidance and superseded old two-provider planning documents. No applied SQL migration was changed.

See the Git diff against a6aac72 for the exact per-file list.

## Remaining historical references

Remaining references to the removed provider are immutable migration 013 (filename/comments and historical provider-ID column), the historical preservation comment in immutable migration 015, negative tests asserting the package/service/config/callback are absent, and the removal filenames listed in this report. Existing schema columns and SMS history are retained. Active source, scripts, dependency manifests, deployment configuration and frontend contain no reference or execution path for that provider. Historical sms_ event-key prefixes are intentionally retained to prevent duplicate confirmations. Git history retains the original implementation for audit, not as a runtime fallback.

No new SQL migration is needed. WhatsApp outbox processing cannot claim or modify historical SMS rows, and uncertain sends are never automatically replayed.

## Missing production prerequisites

| Required evidence | Status |
|---|---|
| Registered production Meta WABA and business number | Not verified |
| Valid production system-user token and app secret | Not verified |
| Approved Authentication template, Copy Code button, exact locale | Not verified |
| Approved utility templates and allowlist entries | Not verified |
| Authentic signed Meta webhook at staging/production URL | Not verified live |
| Real staging OTP delivery and verification | Not performed; requires explicit authorization |
| Real staging utility delivery and receipt | Not performed; requires explicit authorization |
| Provisioned scheduler and successful reminder run | Not verified; prior read of user-selected Milvanta Render workspace returned no services |
| Consent/category/opt-out behavior | Local mocked integration and browser checks pass; live acceptance remains required |

Therefore deployment is BLOCKED. WHATSAPP_ENABLED remains false in deployment templates. No alternate phone transport is available if Meta fails, and email never substitutes for mandatory phone ownership.

## Reproduce

Use an explicitly disposable local TEST_DATABASE_URL, then run npm ci, npm test and node scripts/verify-disposable-integration.mjs. The test database guard fails closed without isolated configuration. All Meta traffic is injected; no live message is sent during tests. Setup/template schemas and the sole-channel production approval checklist are in meta-whatsapp-cutover.md.

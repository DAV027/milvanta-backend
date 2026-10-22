# Validation evidence - 2026-10-22

All database checks ran against a newly created localhost PostgreSQL 18.4 database with UTF8 encoding and disposable schemas. Node v24.21.0 was used (application requires Node 22+). Meta fetch was fully mocked. No production database test, deployment or live message was performed.

| Run | Passed | Failed |
|---|---:|---:|
| New WhatsApp client and PostgreSQL tests | 14 | 0 |
| Focused WhatsApp, payment reconciliation, subscriptions, refunds, delivery calendar and customer acceptance | 163 | 0 |
| Complete feature-branch suite | 316 | 12 |
| Complete unchanged base 814468e suite, same local database | 301 | 13 |

Every remaining feature failure also occurs on the base. The base's additional failure was its stale profile asset version assertion; affected assertions were updated to the new 20261022-2 bundles. No other existing expected behaviors were changed to hide failures. The full suite is not green and production readiness is not claimed.

## Remaining baseline failures

- verifies frontend/admin.html does NOT use innerHTML for dynamic tables or error reporting
- allows access to admin routes when valid x-admin-key header is provided
- rejects order checkout with invalid idempotency key
- rejects POST /api/v1/subscriptions if paymentId is missing with 400
- rejects POST /api/v1/subscriptions if paymentId cannot be verified with 400/402
- safely handles subscription.halted as paused (recoverable, NOT cancelled)
- safely handles subscription.resumed back to active
- safely handles subscription.completed as expired
- handles idempotent duplicate webhooks gracefully
- rejects order with outside-Hyderabad pincode (422)
- blocks non-admin users from triggering daily delivery generation
- blocks unauthenticated quantity change requests with 401

The unchanged admin HTML source assertion and older API/security fixtures need separate investigation before production integration. This migration did not change admin rendering, quantity-change routing or billing decisions to satisfy those tests. Passing focused reconciliation/refund tests do not erase these failures.

## Browser and artifacts

Playwright Chromium mobile viewport 390x844 passed inline OTP verification, countdown, failed-send recovery, category/consent saving, opt-out, signup with persisted post-verification consent, and mandatory skip suppression. No page errors or horizontal overflow occurred. API responses were intercepted locally; browser failures initially exposed test-harness backend routing, which was corrected before the successful run. Tests were run locally, not against the deployed storefront (no deployment was requested).

The complete Cloudflare ZIP passed archive CRC checks and every archived file was compared with its source. All equivalent files in frontend and frontend/cloudflare-upload were checked byte-for-byte. Script/profile bundles reference cache version 20261022-2. The historical repository-root ZIP was left untouched; use the requested frontend/milvanta-cloudflare-upload.zip artifact.

The Milvanta Render workspace was selected by the user. Both service-list reads returned null, so no provisioned scheduler could be verified. No provisioning or cron execution occurred.

## Security and failure-mode review

A separate read-only code review identified signup-consent persistence, stale fulfillment messages and provider queue draining. These were addressed and checked with browser/database tests and a documented explicit drain switch. A second review found swallowed outbox errors in the shared payment webhook transaction; a forced PostgreSQL error reproduced the false acknowledgement, and error propagation now ensures a retryable response and correct rollback. Retrying the signed event and checkout verification queues exactly one order message. OTP account/session binding, HMAC signatures, concurrent outbox claiming, callback-before-response, deduplication, replay, expiry, five attempts and failed-send behavior have direct test coverage. Uncertain sends require reconciliation rather than automatic replay. Approved templates and real delivery remain external launch prerequisites.

See meta-whatsapp-validation.json for machine-readable results and meta-whatsapp-cutover.md for setup, configuration, templates, deployment boundaries and exact reproduction commands.

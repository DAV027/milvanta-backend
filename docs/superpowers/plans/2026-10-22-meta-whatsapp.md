# Meta WhatsApp Implementation Plan

Goal: implement the supplied direct Meta migration brief for review without production changes.

Architecture: provider facade over the existing event outbox; durable account/session-bound OTP; authenticated monotonic webhook reconciliation. Preserve Twilio as the default until cutover.

Spec: ../specs/2026-10-22-meta-whatsapp-design.md

## Constraints and review focus

- No production deploy, live messages, production DB access or billing changes.
- Preserve refund branch and historical migrations; use additive migration 015.
- Fail closed on absent consent, approval, configuration, session or phone match.
- Ambiguous HTTP outcomes and worker crashes must not automatically resend.
- Callback-before-response, provider switch, stale delivery, concurrent OTP and opt-out races need coverage.

## Tasks (native execution)

- [x] Write failing mocked Graph/signature/template tests. Add migration 015, template registry and HTTPS fetch service. Check real response IDs and structured sanitized errors.
- [x] Write durable OTP integration tests for success, expiry, replay, attempts, cooldown and account/session binding. Implement transactional challenge service and authenticated existing endpoints.
- [x] Test consent, idempotent queue, concurrent claims, interrupted sends, retry scheduling and monotonic callbacks. Implement preferences, outbox and signed webhook endpoints.
- [x] Route existing events through provider facade, preserve event keys and payment guards; add cancellation, webhook activation/billing and renewal hooks. Schedule and recheck delivery eligibility. Run existing subscription/refund/payment suites.
- [x] Implement WhatsApp UI, consent and preferences, resend/verification states. Sync equivalent frontend assets, bump versions, rebuild ZIP and check mobile browser behavior with mocked API.
- [x] Document configuration, proposed template schemas, sanitized API examples, cutover and reconciliation. Verify cron read-only if connector access permits. Review diff, run checks, commit phases and push feature branch.

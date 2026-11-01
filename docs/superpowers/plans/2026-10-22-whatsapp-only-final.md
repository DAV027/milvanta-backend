# WhatsApp-only implementation plan

Spec: ../specs/2026-10-22-whatsapp-only-design.md

- [x] Add failing sole-provider contract and legacy-row isolation tests; remove selector, service, callback, package and config.
- [x] Replace legacy notification/acceptance tooling with PostgreSQL-backed challenges and mocked Graph delivery; preserve domain tests and audit event keys.
- [x] Investigate twelve failures individually; fix unsafe admin DOM and test isolation/authentication/payment fixtures, preserving assertions and business decisions.
- [x] Apply exact WhatsApp-only UI labels, check error/consent/countdown flows, synchronize Cloudflare tree and rebuild ZIP.
- [x] Run full suite, review changes and deployment blockers, document results/historical references/migration impact, push reviewable commits.

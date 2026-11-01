# WhatsApp-only finalization

User brief supersedes the earlier dual-provider cutover design. Base a6aac72 on feature/meta-whatsapp-cloud-api, retaining the refund/admin/calendar dependency at 814468e. Work on feature/whatsapp-only-final without merging or deploying.

Keep a thin notification domain module that delegates exclusively to the existing Meta services. Remove selection/fallback/draining logic, obsolete service/template files, callbacks, package and environment settings. Existing event keys and SMS rows remain audit history; no historical/uncertain send is replayed. No SQL migration is required and migration 015 is immutable.

Require the existing database-backed authentication on both phone endpoints unconditionally. Retain secure challenge rules, explicit consent, approved-template allowlist, signed callbacks, concurrency/retries and unknown-send holds. Frontend always says WhatsApp and uses phone config only for mandatory verification policy.

Replace legacy transport tests with real PostgreSQL and injected Meta mocks, preserving domain/security coverage. Investigate each of the twelve known failures: fix actual DOM risks; repair deficient test fixtures to assert real authorization/payment state without weakening security contracts. Keep refund/billing business decisions intact.

Both deployment templates stay messaging-disabled pending real staging prerequisites. Rewrite active deployment guidance for one provider; mark previous design/results as historical. No production changes, live sends or external provisioning are authorized.

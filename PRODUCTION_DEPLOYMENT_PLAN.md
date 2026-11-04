# MILVANTA — Controlled subscription fix release plan

**Branch:** `fix/razorpay-subscription-create-root-cause-400`
**Environment:** Render API / Neon PostgreSQL / Razorpay Test Mode
**Current decision:** **HOLD MERGE / NO-GO for public subscriptions** until gateway and entitlement checks pass.

## Before any deployment

1. Verify latest PR HEAD has green isolated GitHub CI.
2. Review the **additive** `020_subscription_plan_registry.sql` migration and its active-plan unique partial index. Verify no pre-existing registry table/rows require reconciliation.
3. Review that all registry failures abort checkout without unexpected gateway writes, and that the transaction-scoped advisory lock serializes plan creation for the same product/price/account.
4. Confirm normal one-time order checkout remains unaffected; the patch changes only subscription code, migration, diagnostics and tests.
5. Review outstanding **customer-level subscription creation race**: plan locking does not guarantee per-customer subscription idempotency across concurrent requests. Keep broad public rollout disabled until this is handled.
6. Confirm authorized Render deployment configuration and Test/Live API key mode. Never paste secrets into logs or PR discussions.
7. Obtain explicit owner approval before merging. Render auto-deploys `main` and may run migrations at process startup.

## Release steps — only after approval

1. Merge PR after review, record merge SHA.
2. Observe Render auto-deploy and check for migration failure. Confirm service status `live`.
3. Read startup logs for `Database schema is up to date` and server listening.
4. Use the application's documented health endpoint if one exists; do not assume `/api/v1/health` without verifying source.
5. Verify no regressions in order checkout with read-only checks and synthetic/mocked tests.
6. **With separate approval**, run exactly one controlled Razorpay Test Mode `POST /v1/subscriptions` using a previously verified compatible plan. Do not authorize payment or mandate at this stage.
7. Confirm the gateway returned a valid subscription object; check its current status without creating additional resources or repeating ambiguous requests. Document the plan ID and subscription ID in a restricted reconciliation record.
8. Only after the gateway creation step succeeds, plan a separate approved Test Mode authorization and webhook test, with clear controls preventing any actual milk fulfillment or customer messaging.
9. Audit test-mode historical subscriptions and real-payment entitlement separation before activating recurring subscriptions for real customers.

## If the first Test Mode POST still fails

- Record only sanitized `gatewayStatus`, `stage`, `gatewayReason`; do not dump provider credentials or entire error payload.
- **Stop retrying.** Inspect why `unclassified` remains, compare documented request shape and get a provider-side error description through authorized merchant support channels.
- Reconcile any new gateway plan or subscription resources before attempting another request.

## Rollback

- Roll back the Render service to the last known good commit, using the platform's documented rollback procedure.
- Leave additive registry data in place for audit unless a separately approved DB migration is necessary. Do not drop the table automatically.
- Gateway subscriptions or plans created before rollback **will not be reverted by code rollback** and must be reconciled separately.

## Release success criteria

- App starts after migration and existing checkout remains unaffected.
- No raw gateway error or customer data leaks into client responses.
- Parallel matching plan requests result in one active registry plan, one external plan creation.
- Actual Razorpay Test Mode subscription **POST** succeeds.
- Payment authorization, webhook integrity, paid-entitlement, and renewal flows subsequently pass their own approved tests before real-world activation.

# Razorpay Subscriptions: Controlled Test-Mode API Diagnostic

**Scope:** Diagnose Milvanta's `POST /v1/subscriptions` HTTP 400 from Test Mode. This script is intended to be run on the developer's trusted **local machine**, not via GitHub Actions, Render production or a customer browser.

## Evidence

The confirmed production error on November 4, 2026, 09:16:25 UTC was `stage=subscription_create`, `gatewayStatus=400`, `gatewayErrorCode=BAD_REQUEST_ERROR`, `gatewayReason=unclassified`. A verified Razorpay Test Mode monthly plan for 1-litre cow milk is recorded in Neon at ₹3,150 or **315000 paise**: `plan_Tw2gBPDNylnx9v`. The corresponding gateway POST error description was **not** retained in Render logs. Neither changing the PostgreSQL database nor the last boolean/notes/code changes has resolved the observed 400.

## Safety

- **Default execution is GET-only**: fetch an existing `plan_...`, verify ID, period, interval, INR and amount.
- The optional POST is **guarded twice**: requires `--execute-one-test-create` AND `ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE=YES_CREATE_ONE_TEST_SUBSCRIPTION`, which must be deliberately set **only after separate approval**.
- The code rejects `rzp_live_` and unknown key prefixes even when POST is requested.
- Optional POST does not create a plan or process a charge. It can create **one pending Razorpay Test Mode subscription**, which must be reconciled in the dashboard. **Do not authorize a payment or mandate.**
- No customer name, phone, email, address, notes, database ID or local subscription row is sent to the optional gateway POST. It uses a minimal `plan_id`, `total_count:1`, `quantity:1`, `customer_notify:true` body.
- No retries. A network timeout after POST is **ambiguous**—look up the Razorpay Test Mode subscription list before any other attempt.
- Provider responses are reduced to useful safe fields. Do not share console output without reviewing it for identifiers.
- Do not use this script in Render backend production, CI, or a web endpoint. Its design is intentionally local-only.

## Windows PowerShell: read-only plan verification

Open a terminal in the *checked-out diagnostic branch*:

```powershell
git fetch origin diagnostics/razorpay-test-subscription-error-probe-20261104
git switch diagnostics/razorpay-test-subscription-error-probe-20261104
$cred = Get-Credential -Message "Razorpay TEST Key ID as username, TEST Key Secret as password"
$env:RAZORPAY_KEY_ID = $cred.UserName
$env:RAZORPAY_KEY_SECRET = $cred.GetNetworkCredential().Password
try {
  node scripts/razorpay-subscription-test-probe.mjs --plan-id plan_Tw2gBPDNylnx9v --expected-amount-paise 315000
} finally {
  Remove-Item Env:\RAZORPAY_KEY_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\RAZORPAY_KEY_SECRET -ErrorAction SilentlyContinue
  Remove-Variable cred -ErrorAction SilentlyContinue
}
```

Expected successful read-only result: `preflight.match = true`, `postAttempted = false`, `diagnosis = READ_ONLY_OK...`.

## Optional: request separate approval before a single Test Mode POST

Only after the merchant explicitly authorizes a single Test Mode subscription creation, set `$env:ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE = "YES_CREATE_ONE_TEST_SUBSCRIPTION"` in the same PowerShell process as the credential setup and add `--execute-one-test-create` to the command.

- On **HTTP 400**, the script prints the sanitized Razorpay error `code`, `field`, `reason`, `source`, `step` and short redacted `description`.
- On success, the script prints the created Test Mode `sub_...` ID and state. This verifies that a **minimal direct API POST** works; it does not prove the full Milvanta checkout, customer verification, webhook or delivery entitlement works.
- Keep Test Mode subscriptions from triggering real fulfillment. No customer authorization should be completed as part of this diagnostic.
- On an ambiguous timeout, stop and reconcile against the Razorpay dashboard.

If the minimal POST succeeds while the website still returns 400, investigate the **difference in request fields/SDK serialization, credential/account, or plan selection** between this script and the app. If the minimal POST also returns 400, use the returned field/description with Razorpay Support to determine the account/plan restriction. Never assume the error cause from the status code alone.

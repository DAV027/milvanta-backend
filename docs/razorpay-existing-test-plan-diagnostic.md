# Milvanta: controlled Razorpay Test Mode subscription diagnostics

## Purpose

The November 4 subscription checkout successfully created a plan but failed on POST /v1/subscriptions with HTTP 400. The error description was not recognized by the existing classifier. Razorpay docs permit total_count=1, missing start_at, and customer_notify=1; none of those is conclusively wrong.

Instead of creating another orphan plan, this tool uses an existing Test Mode plan from the merchant screenshot.

## Default safe mode

Run the script with --plan-id and --expected-amount-paise. It performs only an authenticated GET /v1/plans/:planId, checks plan owner/name, billing amount, currency, and monthly period, and returns READY_FOR_EXPLICIT_TEST. No plan or subscription is created.

Plan from screenshot: plan_TvzJ4KxG8YLmEJ
Expected amount: 315000 paise (INR 3150).

## Windows PowerShell

In a NEW isolated folder:

    cd $HOME
    git clone --branch diagnostic/razorpay-existing-test-plan-20261104 --single-branch https://github.com/DAV027/milvanta-backend.git milvanta-sub-diagnostic
    cd .\milvanta-sub-diagnostic

Configure Razorpay TEST credentials without pasting them into the chat:

    $cred = Get-Credential -Message 'Razorpay TEST key ID (username), secret (password)'
    $env:RAZORPAY_KEY_ID = $cred.UserName
    $env:RAZORPAY_KEY_SECRET = $cred.GetNetworkCredential().Password

Run the READ-ONLY preflight:

    node scripts/razorpay-existing-test-plan-diagnostic.mjs --plan-id plan_TvzJ4KxG8YLmEJ --expected-amount-paise 315000

Expected: READY_FOR_EXPLICIT_TEST with createAttempted=false.

## One optional, explicitly approved Test Mode create

If authorized separately, add --create-test-subscription-once to the above command. This performs one POST /v1/subscriptions against the validated existing plan using only plan_id, total_count=1, quantity=1, customer_notify=true. No new plan, mandate authorization, payment capture, or production Milvanta DB write occurs.

An OS-temp file acts as a one-attempt lock; it remains even if the POST times out. Do not delete the lock or retry before Razorpay reconciliation because the POST may have succeeded on the server.

Output is sanitized: success includes a subscription identifier for reconciliation; errors include only HTTP status, known reason classification and allowlisted field. Raw gateway descriptions and secrets are not printed.

If the minimal request succeeds but website checkout fails, isolate optional fields in the website request with mocks and investigate request construction. If it also fails, request the Razorpay merchant-specific rejection reason using the failure timestamp and plan ID.

## Clean up environment variables

    Remove-Item Env:\RAZORPAY_KEY_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\RAZORPAY_KEY_SECRET -ErrorAction SilentlyContinue
    Remove-Variable cred -ErrorAction SilentlyContinue

Do not treat Test Mode subscriptions as genuine paid delivery entitlements or send any production customer communications.

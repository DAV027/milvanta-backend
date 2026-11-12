# Milvanta transactional email redesign — manual approval gate

**Branch:** feature/branded-transactional-emails-20261112
**PR:** #38 (review branch; no deployment or sending performed)

## Design and compatibility
- Presentation module: src/emailTemplateRenderers.js. Transport, outbox, gateway and authentication code remain in src/email.js.
- All six types share a 600px-wide table-based shell, inline CSS, navy #123b56, deep teal #16675f, pale backgrounds, preheader, clear headings, and support footer.
- Uses system fonts, readable text and a large tappable link. Does not rely on CSS gradients, remote fonts or JavaScript.
- Customer-supplied text is HTML-escaped. Product images use HTTPS only; missing images never hide essential information.

## Financial and delivery wording
- Order receipts show a subtotal, delivery charge and total **only if** the authoritative values are complete and subtotal + delivery === total.
- The order is described as paid and confirmed only when explicit statuses are supplied in the outbox payload.
- Subscription amounts are labeled reference plan amounts. Mandate registration never becomes a captured-payment receipt.
- A legacy text value claiming tomorrow at 6:00 AM is NOT treated as a scheduled delivery. No first eligible date means Pending delivery scheduling. An explicit eligible ISO date still is not called a scheduled order.
- No default daily price, delivery fee, or zero payment is invented by the new templates.
- Recurring finance approval and physical delivery reconciliation remain separately blocked by Issue #36 and draft PR #37.

## Generate synthetic previews locally
From the repository (Node.js 22+):

    node scripts/preview-email-templates.mjs

Open email-previews/index.html locally. This generator uses fake customer, transaction and OTP values only. It sends nothing, contacts no gateway and does not touch the database. The generated directory is ignored by Git.

## Testing and release checklist
1. Run the full npm test suite and confirm all CI checks.
2. Compare all six previews in Gmail web/mobile, Outlook and narrow/mobile viewports. Check image-blocked and dark-mode variants.
3. Confirm brand, support address and merchant identity. Merchant finance should approve recurring billing wording.
4. Test unpaid, Test Mode, mandate-only, paid live, paused, after-cutoff and unknown gateway-mode subscription cases.
5. Check OTP validity in the auth backend matches the displayed ten-minute expiry.
6. Confirm outbox idempotency and email-provider fallback. This PR makes no sending/dispatch configuration changes.
7. Obtain explicit production approval before merge and deployment. Keep PR #37 separate and draft.

## Integration note
PR #37 also changes authoritative subscription delivery-date logic. Before merging both branches, reconcile which verified first-eligible-date fields should be passed to the email layer; rerun financial, cutoff, PostgreSQL, and visual tests. Do not restore the unsupported tomorrow language.

## Reviewable CI preview artifact (no delivery)
- Every email-template PR build also runs `email-preview-artifact` from the payment/receipt regression workflow. It creates **only synthetic HTML** and uploads a seven-file folder (six templates + index.html) as `milvanta-synthetic-email-previews`, retained for seven days.
- Open the successful GitHub Actions workflow run, locate **Artifacts**, download the named archive, unzip locally and open `index.html` to inspect all six emails. This is a static review artifact, **not** live email provider testing or a website deployment.
- Automated evidence checks now reject impossible eligible calendar dates, conflicting line item amounts, invalid money coercion and unsupported tomorrow promises. Even when order totals reconcile, a mismatched item line is marked for review rather than silently presented as authoritative.
- The long full-suite workflow must finish successfully on the **latest** commit. A cancelled run cannot be interpreted as success.

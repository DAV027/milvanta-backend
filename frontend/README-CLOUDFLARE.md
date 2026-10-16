# Milvanta Cloudflare deployment

The site is static HTML, CSS, and JavaScript; it has no build step.

## Your current `workers.dev` site

Your URL is a Cloudflare Worker. Put the contents of `cloudflare-upload` in the static-assets directory configured for that existing Worker, then redeploy it. Cloudflare recommends deploying Workers with static assets through Wrangler. In the existing `wrangler.jsonc`, set `assets.directory` to the extracted `cloudflare-upload` folder (or its equivalent relative path), then deploy the existing Worker with `npx wrangler deploy`. See [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).

The upload directory contains `index.html`, `assets`, `css`, `js`, `_headers`, and `robots.txt`. Keep the directory structure intact so the relative image, style, and script paths resolve.

## Cloudflare Pages alternative

To host this separately as a Pages project, use Direct Upload with the contents of `cloudflare-upload`. No build command or build output directory is needed.

## Storefront scope

The product browser, product detail views, and cart are client-side. The cart is stored in the visitor's browser. Checkout connects to the Milvanta API for email verification, saved delivery details, order submission, inventory reservation, and Razorpay payment. Set the API URL and configure the backend before enabling live orders.

For production sign-in and checkout, serve this storefront on a custom domain under `milvanta.in` (for example, `shop.milvanta.in`) and point a same-site API hostname (for example, `api.milvanta.in`) to Render. Set `window.MILVANTA_API_URL` to the API hostname and allow the exact storefront origin in the API's `ALLOWED_ORIGINS`. Browsers may block session cookies when the storefront uses `workers.dev` and the API uses `onrender.com`, because those are cross-site origins.

## Before launch

- Deploy the backend with PostgreSQL connected, all four database migrations applied, and the real, verified product catalogue and stock loaded.
- Configure and exercise email OTP delivery, password sign-in, delivery serviceability/charges, Razorpay test checkout, signature verification, webhooks, and reservation expiry in a non-production test environment.
- Rotate any credential ever pasted into chat, source control, logs, or screenshots. Store new secrets only in the hosting provider's secret manager.
- Verify that the storefront and API use a same-site custom domain, the production origin is allowed by API CORS, and security headers are enabled at the static host.
- Before accepting live payment, complete test-mode order, payment failure, delayed webhook, duplicate webhook, out-of-stock, and expired-reservation scenarios; configure refunds, customer support, privacy/terms/returns/shipping policies, and monitoring for the actual business.

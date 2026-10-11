# Milvanta Cloudflare deployment

The site is static HTML, CSS, and JavaScript; it has no build step.

## Your current `workers.dev` site

Your URL is a Cloudflare Worker. Put the contents of `cloudflare-upload` in the static-assets directory configured for that existing Worker, then redeploy it. Cloudflare recommends deploying Workers with static assets through Wrangler. In the existing `wrangler.jsonc`, set `assets.directory` to the extracted `cloudflare-upload` folder (or its equivalent relative path), then deploy the existing Worker with `npx wrangler deploy`. See [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).

The upload directory contains `index.html`, `assets`, `css`, `js`, `_headers`, and `robots.txt`. Keep the directory structure intact so the relative image, style, and script paths resolve.

## Cloudflare Pages alternative

To host this separately as a Pages project, use Direct Upload with the contents of `cloudflare-upload`. No build command or build output directory is needed.

## Storefront scope

The product browser, product detail views, and cart are client-side. The cart is stored in the visitor's browser. This static site does not yet include payment processing, order submission, inventory synchronization, or a configured contact/order endpoint. Connect those services before accepting live orders.

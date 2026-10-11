# Milvanta API (Render)

This is the initial backend service for the existing Milvanta storefront. It provides a health check and a database-backed active-products endpoint. It is a deployment foundation, not the complete commerce backend described in the implementation prompt.

## Deploy

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect the repository, and select `render.yaml`.
3. Review the PostgreSQL and web service plans in the Blueprint before creating them. Render will inject the database connection string.
4. After the first deploy, check `https://<service>.onrender.com/health`.
5. Run `migrations/001_initial.sql` against the Render database using Render's database connection instructions.
6. Set `ALLOWED_ORIGINS` to the exact storefront origins. Add other secrets only when the matching feature is implemented.

## Local run

Use Node.js 22+, create a PostgreSQL database, copy `.env.example` to `.env` and set `DATABASE_URL`, then run `npm install` and `npm start` from the repository root.

## Current API

- `GET /health`: service and optional database status.
- `GET /api/v1/products`: active catalog records from PostgreSQL.
- `POST /api/v1/payments/orders`: creates a Razorpay order from active database products and server-calculated prices.
- `POST /api/v1/payments/verify`: verifies the checkout signature and fetches the payment/order from Razorpay before updating payment status.
- `POST /api/v1/payments/webhook`: verifies Razorpay's raw-body signature, checks amount/currency, deduplicates event IDs, and records captured/failed/authorized states.

Prices use integer paise. No credentials are committed. Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in Render using Razorpay test credentials first. Run the updated `migrations/001_initial.sql` to create the payment tables. Configure the Razorpay webhook URL as `https://<service>.onrender.com/api/v1/payments/webhook` and subscribe to `payment.authorized`, `payment.captured`, and `payment.failed`.

This is not a complete checkout integration yet: there is no authenticated customer identity, durable customer order/address model, stock reservation, receipt, or refund flow, and the current storefront still has a hard-coded catalog. The payment endpoints therefore are not connected to a public Pay button. Do not accept live orders/payments until the catalog, customer orders, fulfillment, and receipts are implemented and verified.

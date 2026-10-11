# Milvanta API (Render)

Backend API for the Milvanta storefront, including email-verified customer accounts, saved addresses, customer order history, inventory reservations, and Razorpay checkout.

## Deploy

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect the repository, and select `render.yaml`.
3. Review the PostgreSQL and web service plans in the Blueprint before creating them. Render will inject the database connection string.
4. After the first deploy, check `https://<service>.onrender.com/health`.
5. Run `migrations/001_initial.sql`, `migrations/002_customer_accounts_orders.sql`, `migrations/003_customer_addresses.sql`, and `migrations/004_email_otp_registration.sql` in order against the Render database using Render's database connection instructions.
6. Set `ALLOWED_ORIGINS` to the exact storefront origins. Add other secrets only when the matching feature is implemented.

## Local run

Use Node.js 22+, create a PostgreSQL database, copy `.env.example` to `.env` and set `DATABASE_URL`, then run `npm install` and `npm start` from the repository root.

## Current API

- `GET /health`: service and optional database status.
- `GET /api/v1/products`: active catalog records from PostgreSQL.
- `POST /api/v1/auth/register` sends a six-digit email verification code; `POST /api/v1/auth/verify-email` creates the account only after the code is verified. Sign in with email and password using `POST /api/v1/auth/login`.
- `GET/PATCH /api/v1/auth/me` returns account details and updates the customer's name during checkout; sessions use HTTP-only cookies and CSRF checks.
- `GET /api/v1/addresses`: saved delivery addresses for the signed-in customer. A checkout saves or updates its delivery address as the customer's default address; address records are isolated by customer ID.
- `POST /api/v1/orders`: authenticated checkout; validates serviceability, locks inventory rows, reserves stock, calculates prices on the server, and creates a Razorpay order.
- `GET /api/v1/orders` and `GET /api/v1/orders/:orderNumber`: authenticated customer order history and details, scoped to the signed-in customer.
- `POST /api/v1/payments/verify`: verifies the checkout signature and fetches the payment/order from Razorpay before updating payment status.
- `POST /api/v1/payments/webhook`: verifies Razorpay's raw-body signature, checks amount/currency, deduplicates event IDs, and records captured/failed/authorized states.

Prices use integer paise. Registration requires an email verification code and password; the account, salted password hash, sessions, saved delivery addresses, and orders are stored in PostgreSQL. Checkout proceeds through cart and customer details, delivery address, then Razorpay payment. No credentials are committed. Run migrations `001` through `004` in order against the Render database. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in Render to deliver verification codes. Also configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SERVICEABLE_PIN_CODES` (comma-separated six-digit PIN codes), and `DELIVERY_CHARGE_PAISE` (integer paise). Use Razorpay test credentials first and enable automatic payment capture in Razorpay. Configure the webhook URL as `https://<service>.onrender.com/api/v1/payments/webhook` and subscribe to `payment.authorized`, `payment.captured`, and `payment.failed`.

Set `window.MILVANTA_API_URL` in `frontend/index.html` to the Render service URL. For reliable cross-origin session cookies, use a same-site custom API hostname such as `api.milvanta.in` pointed to the Render service, and include the storefront origin in `ALLOWED_ORIGINS`.

Checkout requires active products with accurate prices and stock in PostgreSQL. The storefront catalog must be migrated/entered into that database and the delivery charge and service PINs configured before orders can be placed. Automatic receipts, refunds, admin order management/KOT, and password reset are not implemented. Use Razorpay test mode and verify the full email-to-payment flow before accepting live payments.

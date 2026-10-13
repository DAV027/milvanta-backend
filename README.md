# Milvanta API (Render)

Backend API for the Milvanta storefront, including direct email/password signup, customer accounts, saved addresses, order history, inventory reservations, and Razorpay checkout.

## Deploy

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect the repository, and select `render.yaml`.
3. Review the PostgreSQL and web service plans in the Blueprint before creating them. The Blueprint creates a database and injects its connection string into the web service. If you already have a Render database, set `DATABASE_URL` in the web service's Environment settings to that database's **internal** connection string instead of creating an unused second database. Keep this value in Render's secret settings; never commit or paste it into source files.
4. In the web service's Environment settings, set `JWT_SECRET` to a cryptographically random value of at least 32 characters. Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` for welcome email. SMTP is optional for signup. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` using Razorpay **test-mode** credentials first. Set `SERVICEABLE_PIN_CODES` to comma-separated six-digit PIN codes and `DELIVERY_CHARGE_PAISE` to an integer amount in paise. Configure `ALLOWED_ORIGINS` with the exact deployed storefront origin(s).
5. Run `migrations/001_initial.sql`, `migrations/002_customer_accounts_orders.sql`, and `migrations/003_customer_addresses.sql` in order against the Render database using Render's database connection instructions.
6. Insert active catalog products with their correct prices and stock into the `products` table. The API intentionally returns no storefront catalog until the database is configured and products are available.
7. After deploy, `https://<service>.onrender.com/health` must return HTTP 200 with `"database":"connected"` and `"schema":"ready"`. It returns HTTP 503 when the database, required tables, or schema is not ready; fix this before testing customer registration or checkout.

## Local run

Use Node.js 22+, create a PostgreSQL database, copy `.env.example` to `.env` and set `DATABASE_URL`, then run `npm install` and `npm start` from the repository root.

## Current API

- `GET /health`: service readiness; returns HTTP 200 only when PostgreSQL is connected and HTTP 503 otherwise.
- `GET /api/v1/products`: active catalog records from PostgreSQL.
- `POST /api/v1/auth/signup` immediately creates an account using name, email, password, and an optional 10-digit Indian phone number. It returns a bearer token and sends a best-effort welcome email; email is not verified. Duplicate email or phone returns HTTP 409.
- `POST /api/v1/auth/login` accepts email and password and returns a bearer token. Use `Authorization: Bearer <token>` for protected routes. Tokens expire after 30 days and are tracked in PostgreSQL so logout can revoke the token.
- `GET/PATCH /api/v1/auth/me` returns account details and updates the customer's name during checkout.
- `POST /api/v1/auth/logout` revokes the presented bearer token.
- `GET /api/v1/addresses`: saved delivery addresses for the signed-in customer. A checkout saves or updates its delivery address as the customer's default address; address records are isolated by customer ID.
- `POST /api/v1/orders`: authenticated checkout; validates serviceability, locks inventory rows, reserves stock, calculates prices on the server, and creates a Razorpay order.
- `GET /api/v1/orders` and `GET /api/v1/orders/:orderNumber`: authenticated customer order history and details, scoped to the signed-in customer.
- `POST /api/v1/payments/verify`: verifies the checkout signature and fetches the payment/order from Razorpay before updating payment status.
- `POST /api/v1/payments/webhook`: verifies Razorpay's raw-body signature, checks amount/currency, deduplicates event IDs, and records captured/failed/authorized states.

Prices use integer paise. Signup does not verify email ownership; use email verification or another recovery process before relying on email for account recovery or sensitive notifications. Passwords are stored using salted scrypt hashes. Accounts, revocable bearer sessions, saved delivery addresses, and orders are stored in PostgreSQL. Checkout proceeds through cart and customer details, delivery address, then Razorpay payment. Run migrations `001` through `003` in order against the Render database. Configure SMTP to send optional welcome emails. Also configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SERVICEABLE_PIN_CODES` (comma-separated six-digit PIN codes), and `DELIVERY_CHARGE_PAISE` (integer paise). Use Razorpay test credentials first and enable automatic payment capture in Razorpay. Configure the webhook URL as `https://<service>.onrender.com/api/v1/payments/webhook` and subscribe to `payment.authorized`, `payment.captured`, and `payment.failed`.

Set `window.MILVANTA_API_URL` in `frontend/index.html` to the API URL and include the exact storefront origin in `ALLOWED_ORIGINS`. The storefront keeps the bearer token in tab-scoped `sessionStorage` and sends it in the Authorization header; API CORS must allow the storefront origin. Avoid storing tokens in URLs or logs.

Checkout requires active products with accurate prices and stock in PostgreSQL. The storefront catalog must be migrated/entered into that database and the delivery charge and service PINs configured before orders can be placed. Automatic receipts, refunds, admin order management/KOT, and password reset are not implemented. Use Razorpay test mode and verify the full email-to-payment flow before accepting live payments.

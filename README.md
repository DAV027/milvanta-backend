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

Prices use integer paise. No credentials are committed. Authentication, order processing, inventory reservation, Razorpay, Zoho, image storage, admin APIs and customer APIs are not implemented yet. Do not accept live orders through this API until those flows are implemented and verified.

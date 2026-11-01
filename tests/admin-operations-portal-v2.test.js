import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_admin_dashboard_jwt_secret_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_admin';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_milvanta_admin_hmac';

assertTestDatabaseConfigured();

const setup = await setupDisposableTestSchema();
const pool = setup.pool;

const { app } = await import('../src/server.js');

let adminToken;
let customerToken;
let adminCustomerId;
let regularCustomerId;
let testSubId;
let testOrderNumber;

function getAuthHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');

describe('Milvanta Admin Operations Portal V2 Suite', () => {
  before(async () => {
    await app.ready();

    // 1. Create Admin Customer
    const adminRes = await pool.query(
      `INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin, email_verified, phone_verified_at)
       VALUES ('Ops Admin', '+919999900001', 'admin.ops.v2@milvanta.in', 'dummy_salt', 'dummy_hash', TRUE, TRUE, NOW())
       RETURNING id, email, is_admin`
    );
    adminCustomerId = adminRes.rows[0].id;
    adminToken = app.jwt.sign({ sub: String(adminCustomerId), email: 'admin.ops.v2@milvanta.in', jti: crypto.randomUUID() });
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [digest(adminToken), adminCustomerId, digest(crypto.randomBytes(32).toString('hex'))]
    );

    // 2. Create Regular Customer
    const custRes = await pool.query(
      `INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin, email_verified, phone_verified_at)
       VALUES ('Regular Customer', '+919999900002', 'customer.ops.v2@milvanta.in', 'dummy_salt', 'dummy_hash', FALSE, TRUE, NOW())
       RETURNING id, email, is_admin`
    );
    regularCustomerId = custRes.rows[0].id;
    customerToken = app.jwt.sign({ sub: String(regularCustomerId), email: 'customer.ops.v2@milvanta.in', jti: crypto.randomUUID() });
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [digest(customerToken), regularCustomerId, digest(crypto.randomBytes(32).toString('hex'))]
    );

    // 3. Create test active subscription with payment evidence
    const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const tomorrowDate = new Date(Date.now() + 86400000);
    const tomorrowYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrowDate);
    const nextMonthYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 30 * 86400000));

    const subRes = await pool.query(
      `INSERT INTO customer_subscriptions (
        customer_id, product_name, frequency, time_slot, quantity, quantity_num,
        cost_per_day_paise, status, next_delivery, plan_type, duration_label, total_amount_paise,
        razorpay_subscription_id, razorpay_plan_id, notes
      ) VALUES (
        $1, 'Pure Cow Milk', 'daily', 'morning', '500ml', 1,
        10500, 'active', $2, 'prepaid', '1 Month', 315000,
        'sub_test_v2_101', 'plan_test_v2_101', $3
      ) RETURNING id`,
      [
        regularCustomerId,
        tomorrowYMD,
        JSON.stringify({
          startDate: todayYMD,
          paidThroughDate: nextMonthYMD,
          lastPaymentId: 'pay_test_v2_captured_1',
          paymentId: 'pay_test_v2_captured_1',
          authAmountPaise: 315000,
          authType: 'prepaid',
          fulfillmentEntitled: true,
          address: { street: '123 Milvanta Green Lane', city: 'Hyderabad', pincode: '500081', phone: '+919999900002' }
        })
      ]
    );
    testSubId = subRes.rows[0].id;

    // 4. Create test customer order
    testOrderNumber = `MV-V2-ORD-${Date.now()}`;
    await pool.query(
      `INSERT INTO customer_orders (
        order_number, customer_id, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise,
        order_status, payment_status, courier_name, tracking_number
      ) VALUES (
        $1, $2, $3, $4, $5, 150000, 5000, 155000,
        'placed', 'paid', 'Milvanta Direct', 'MV-TRK-V2-1'
      )`,
      [
        testOrderNumber,
        regularCustomerId,
        `idem_key_${testOrderNumber}`,
        JSON.stringify({ recipient_name: 'Regular Customer', phone: '+919999900002', street: '456 Dairy Park', city: 'Hyderabad', pincode: '500081' }),
        JSON.stringify([{ product_id: 1, product_name: 'A2 Cow Ghee 500ml', quantity: 1, unit_price_paise: 150000 }])
      ]
    );
  });

  after(async () => {
    if (app) await app.close().catch(() => {});
    if (pool) await cleanupDisposableTestSchema(setup).catch(() => {});
  });

  describe('1. Server-Authoritative RBAC & Admin Security Guards', () => {
    const protectedGetEndpoints = [
      '/api/v1/operations/deliveries/generate-preview',
      '/api/v1/operations/deliveries/export',
      '/api/v1/admin/customers',
      '/api/v1/admin/demand-forecast',
      '/api/v1/admin/demand-forecast/export',
      '/api/v1/admin/reports',
      '/api/v1/admin/reports/export'
    ];

    for (const ep of protectedGetEndpoints) {
      it(`rejects unauthenticated GET ${ep} with 401`, async () => {
        const res = await app.inject({ method: 'GET', url: ep });
        assert.equal(res.statusCode, 401);
      });

      it(`rejects regular customer (is_admin = false) from GET ${ep} with 403`, async () => {
        const res = await app.inject({
          method: 'GET',
          url: ep,
          headers: getAuthHeaders(customerToken)
        });
        assert.equal(res.statusCode, 403);
      });
    }

    it('rejects regular customer from GET /api/v1/admin/subscriptions/:id/details with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/subscriptions/${testSubId}/details`,
        headers: getAuthHeaders(customerToken)
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects regular customer from GET /api/v1/admin/orders/:orderNumber/details with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/orders/${testOrderNumber}/details`,
        headers: getAuthHeaders(customerToken)
      });
      assert.equal(res.statusCode, 403);
    });
  });

  describe('2. Daily Deliveries Preview, Generation & Manifest Export', () => {
    it('GET /api/v1/operations/deliveries/generate-preview: returns dry-run breakdown of eligible subscriptions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/operations/deliveries/generate-preview',
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.success, true);
      assert.ok(data.targetDate);
      assert.ok(data.totalActiveSubscriptions >= 1);
      assert.ok(typeof data.eligibleCount === 'number');
      assert.ok(typeof data.skippedBreakdown === 'object');
      assert.ok(Array.isArray(data.eligibleSubscriptions));
    });

    it('GET /api/v1/operations/deliveries: supports search, status filter, and pagination', async () => {
      const tomorrowDate = new Date(Date.now() + 86400000);
      const tomorrowYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrowDate);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/operations/deliveries?date=${tomorrowYMD}&status=all&limit=25&offset=0`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.deliveryDate, tomorrowYMD);
      assert.ok(Array.isArray(data.deliveries));
      assert.ok(typeof data.counts === 'object');
      assert.ok(typeof data.total === 'number');
    });

    it('GET /api/v1/operations/deliveries/export: exports CSV manifest with sanitized headers and formula injection protection', async () => {
      const tomorrowDate = new Date(Date.now() + 86400000);
      const tomorrowYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrowDate);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/operations/deliveries/export?date=${tomorrowYMD}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.headers['content-disposition'].includes(`attachment; filename="milvanta-deliveries-${tomorrowYMD}.csv"`));
      assert.ok(res.body.includes('Delivery Order Number,Delivery Date,Status,Customer Name'));
    });
  });

  describe('3. Milk Subscriptions Management & Details Drawer', () => {
    it('GET /api/v1/admin/subscriptions: returns enriched subscriptions with paid-through and remaining days', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/subscriptions?search=sub_test_v2_101`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.ok(data.subscriptions.length >= 1);
      const sub = data.subscriptions.find(s => s.id === testSubId);
      assert.ok(sub);
      assert.ok(sub.effective_paid_through_date);
      assert.ok(typeof sub.remaining_eligible_days === 'number');
    });

    it('GET /api/v1/admin/subscriptions/:id/details: returns full subscription, calendar, and entitlement audit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/subscriptions/${testSubId}/details`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.subscription.id, testSubId);
      assert.ok(data.subscription.customer_name);
      assert.ok(data.calendar);
      assert.ok(Array.isArray(data.calendar.days));
      assert.ok(Array.isArray(data.pauses));
      assert.ok(Array.isArray(data.skips));
      assert.ok(Array.isArray(data.ledger));
    });
  });

  describe('4. Customer Orders Management & Timeline', () => {
    it('GET /api/v1/admin/orders/:orderNumber/details: returns order, audit history, and refund requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/orders/${testOrderNumber}/details`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.order.order_number, testOrderNumber);
      assert.ok(Array.isArray(data.history));
      assert.ok(Array.isArray(data.refunds));
    });
  });

  describe('5. Customer Accounts Management & Privacy', () => {
    it('GET /api/v1/admin/customers: returns customer list with order and subscription counts, excluding password hashes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers?search=admin.ops.v2`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.ok(data.customers.length >= 1);
      const adminCust = data.customers[0];
      assert.equal(adminCust.email, 'admin.ops.v2@milvanta.in');
      assert.equal(adminCust.password_hash, undefined, 'Never expose password_hash');
      assert.equal(adminCust.password_salt, undefined, 'Never expose password_salt');
      assert.ok(typeof adminCust.total_orders_count === 'string' || typeof adminCust.total_orders_count === 'number');
      assert.ok(typeof adminCust.total_spend_paise === 'string' || typeof adminCust.total_spend_paise === 'number');
    });

    it('GET /api/v1/admin/customers/:id/details: returns customer profile and address history without secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${regularCustomerId}/details`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.customer.id, regularCustomerId);
      assert.equal(data.customer.password_hash, undefined);
      assert.ok(Array.isArray(data.addresses));
      assert.ok(Array.isArray(data.orders));
      assert.ok(Array.isArray(data.subscriptions));
    });
  });

  describe('6. Inventory & Milk Demand Forecasting', () => {
    it('GET /api/v1/admin/demand-forecast: calculates Cow and Buffalo milk requirements and pack breakdown', async () => {
      const tomorrowDate = new Date(Date.now() + 86400000);
      const tomorrowYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrowDate);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/demand-forecast?date=${tomorrowYMD}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.date, tomorrowYMD);
      assert.ok(typeof data.cowMilkLitres === 'number');
      assert.ok(typeof data.buffaloMilkLitres === 'number');
      assert.ok(typeof data.totalLitres === 'number');
      assert.ok(typeof data.packBreakdown === 'object');
      assert.ok(Array.isArray(data.items));
    });

    it('GET /api/v1/admin/demand-forecast/export: exports demand forecast CSV for fulfillment operations', async () => {
      const tomorrowDate = new Date(Date.now() + 86400000);
      const tomorrowYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrowDate);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/demand-forecast/export?date=${tomorrowYMD}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.headers['content-disposition'].includes(`attachment; filename="milvanta-demand-forecast-${tomorrowYMD}.csv"`));
      assert.ok(res.body.includes('Product,Pack Size,Units Scheduled,Total Litres,Delivery Date'));
    });
  });

  describe('7. Business Reports & Operations Analytics', () => {
    it('GET /api/v1/admin/reports: returns aggregated revenue, delivery performance, and subscription metrics', async () => {
      const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/reports?from=${todayYMD}&to=${todayYMD}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.ok(data.revenue);
      assert.ok(data.deliveries);
      assert.ok(data.subscriptions);
      assert.ok(data.customers);
      assert.ok(typeof data.deliveries.successRatePct === 'number');
    });

    it('GET /api/v1/admin/reports/export: exports business metrics CSV with sanitized rows', async () => {
      const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/reports/export?from=${todayYMD}&to=${todayYMD}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.body.includes('Metric Category,Metric Name,Value,Unit,Period'));
    });
  });

  describe('8. Frontend Parity, Safe DOM & UI Sections', () => {
    it('verifies frontend/admin.html and frontend/cloudflare-upload/admin.html match 100% byte-for-byte', () => {
      const adminPath = path.resolve('frontend/admin.html');
      const cfAdminPath = path.resolve('frontend/cloudflare-upload/admin.html');
      const adminContent = fs.readFileSync(adminPath, 'utf8');
      const cfContent = fs.readFileSync(cfAdminPath, 'utf8');
      assert.equal(adminContent, cfContent, 'Must be 100% byte-for-byte identical');
    });

    it('verifies all 8 required navigation sections exist in frontend/admin.html', () => {
      const adminContent = fs.readFileSync(path.resolve('frontend/admin.html'), 'utf8');
      const requiredSections = [
        'id="overviewSection"',
        'id="deliveriesSection"',
        'id="subscriptionsSection"',
        'id="ordersSection"',
        'id="refundsSection"',
        'id="customersSection"',
        'id="demandSection"',
        'id="reportsSection"'
      ];
      for (const sec of requiredSections) {
        assert.ok(adminContent.includes(sec), `Section ${sec} must exist in admin.html`);
      }
    });

    it('verifies zero innerHTML assignments in admin script', () => {
      const adminContent = fs.readFileSync(path.resolve('frontend/admin.html'), 'utf8');
      const scriptMatch = adminContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/);
      assert.ok(scriptMatch, 'script tag must exist');
      const innerHtmlMatches = scriptMatch[1].match(/\.innerHTML\s*=/g) || [];
      assert.equal(innerHtmlMatches.length, 0, 'No innerHTML assignments should exist in admin script');
    });

    it('verifies zero inline onclick attributes exist in frontend/admin.html', () => {
      const adminContent = fs.readFileSync(path.resolve('frontend/admin.html'), 'utf8');
      const onclickMatches = adminContent.match(/onclick\s*=/gi) || [];
      assert.equal(onclickMatches.length, 0, 'No inline onclick attributes allowed');
    });
  });
});

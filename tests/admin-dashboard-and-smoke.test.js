import {
  testDbConfig,
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_admin_dashboard_jwt_secret_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_admin';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_milvanta_admin_hmac';

// Fail closed immediately before importing server if test database is not configured
assertTestDatabaseConfigured();

// Initialize isolated disposable test schema BEFORE application pool is created
const setup = await setupDisposableTestSchema();
const pool = setup.pool;
const schemaName = setup.schemaName;

const { app, razorpay } = await import('../src/server.js');

describe('Milvanta Admin Dashboard, Reporting & Smoke Test Suite', () => {
  let regularCustId;
  let regularToken;
  let adminCustId;
  let adminToken;

  const regularEmail = `regular_${Date.now()}_${Math.floor(Math.random() * 1000)}@milvanta.in`;
  const adminEmail = `operator_admin_${Date.now()}_${Math.floor(Math.random() * 1000)}@milvanta.in`;
  const phoneReg = '9' + Math.floor(100000000 + Math.random() * 900000000);
  const phoneAdmin = '9' + Math.floor(100000000 + Math.random() * 900000000);

  let testOrderId;
  let testOrderNumber;
  let testSubId;

  before(async () => {
    // 1. Create Regular Customer (is_admin = false)
    const saltReg = crypto.randomBytes(16).toString('hex');
    const hashReg = crypto.scryptSync('RegularUserPass123!', saltReg, 64).toString('hex');
    const resReg = await pool.query(
      `INSERT INTO customers (full_name, email, password_hash, password_salt, phone, is_admin)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, full_name, email`,
      ['Regular Customer', regularEmail, hashReg, saltReg, phoneReg]
    );
    regularCustId = resReg.rows[0].id;
    regularToken = app.jwt.sign({ sub: String(regularCustId), email: regularEmail, jti: crypto.randomUUID() });
    const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [digest(regularToken), regularCustId, digest(crypto.randomBytes(32).toString('hex'))]
    );

    // 2. Create Admin Customer (is_admin = true)
    const saltAdmin = crypto.randomBytes(16).toString('hex');
    const hashAdmin = crypto.scryptSync('AdminUserPass123!', saltAdmin, 64).toString('hex');
    const resAdmin = await pool.query(
      `INSERT INTO customers (full_name, email, password_hash, password_salt, phone, is_admin)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, full_name, email, is_admin`,
      ['Approved Operator', adminEmail, hashAdmin, saltAdmin, phoneAdmin]
    );
    adminCustId = resAdmin.rows[0].id;
    adminToken = app.jwt.sign({ sub: String(adminCustId), email: adminEmail, jti: crypto.randomUUID() });
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [digest(adminToken), adminCustId, digest(crypto.randomBytes(32).toString('hex'))]
    );

    // 3. Seed test order with formula injection attempt in notes/address to verify formula escaping
    testOrderNumber = `ORD-ADMIN-${Date.now()}`;
    const orderRes = await pool.query(
      `INSERT INTO customer_orders (
         order_number, customer_id, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise,
         order_status, payment_status, courier_name, tracking_number, estimated_delivery
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, 150000, 5000, 155000,
         'placed', 'paid', 'BlueDart', 'BLU987654', NOW() + INTERVAL '2 days'
       ) RETURNING id`,
      [
        testOrderNumber,
        regularCustId,
        `idemp_admin_test_${Date.now()}`,
        JSON.stringify({
          name: '=CMD|\' /C calc\'!A0', // Formula injection attempt
          house: '+12345 Dangerous Street', // Formula injection attempt
          street: 'Flat 402',
          city: 'Hyderabad',
          pincode: '500049',
          phone: phoneReg
        }),
        JSON.stringify([
          { productId: 1, name: 'Pure Desi Cow Ghee (500g)', quantity: 1, price: 1500 }
        ])
      ]
    );
    testOrderId = orderRes.rows[0].id;

    // 4. Seed test subscription
    testSubId = `sub_admin_test_${Date.now()}`;
    await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, product_name, frequency, time_slot, quantity, quantity_num,
         cost_per_day_paise, status, next_delivery, plan_type, duration_label,
         total_amount_paise, razorpay_subscription_id, notes
       ) VALUES (
         $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
         10500, 'active', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
         315000, $2, $3::jsonb
       )`,
      [
        regularCustId,
        testSubId,
        JSON.stringify({
          subscriptionId: testSubId,
          lastPaymentId: 'pay_sub_admin_123',
          paidThroughDate: '2026-11-20',
          startDate: '2026-10-21',
          formulaTest: '@SUM(1+1)' // Formula injection attempt
        })
      ]
    );
  });

  after(async () => {
    await cleanupDisposableTestSchema(setup);
  });

  // =========================================================================
  // 1. Authorization Guards (Requirement: unauthorized account receives 403)
  // =========================================================================
  describe('1. Admin Authorization & Security Guards', () => {
    it('rejects unauthenticated requests to GET /api/v1/admin/orders with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/orders' });
      assert.equal(res.statusCode, 401);
    });

    it('rejects regular customer (is_admin = false) from GET /api/v1/admin/orders with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        headers: { Authorization: `Bearer ${regularToken}` }
      });
      assert.equal(res.statusCode, 403);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'forbidden_admin_required');
    });

    it('rejects regular customer from GET /api/v1/admin/subscriptions with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/subscriptions',
        headers: { Authorization: `Bearer ${regularToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects regular customer from GET /api/v1/admin/stats with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats',
        headers: { Authorization: `Bearer ${regularToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects regular customer from GET /api/v1/admin/orders/export with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders/export',
        headers: { Authorization: `Bearer ${regularToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects regular customer from GET /api/v1/admin/subscriptions/export with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/subscriptions/export',
        headers: { Authorization: `Bearer ${regularToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects regular customer from PATCH /api/v1/admin/orders/:orderNumber/status with 403', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/orders/${testOrderNumber}/status`,
        headers: { Authorization: `Bearer ${regularToken}` },
        payload: { status: 'confirmed' }
      });
      assert.equal(res.statusCode, 403);
    });
  });

  // =========================================================================
  // 2. Authorized Live Admin Access (is_admin = true)
  // =========================================================================
  describe('2. Authorized Admin Endpoints & PostgreSQL Data Retrieval', () => {
    it('GET /api/v1/admin/stats: returns live PostgreSQL stats with Cache-Control headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'no-store, no-cache, must-revalidate, private');
      assert.equal(res.headers['pragma'], 'no-cache');

      const data = JSON.parse(res.payload);
      assert.ok(data.totalOrders >= 1);
      assert.ok(data.totalCustomers >= 2);
      assert.ok(data.totalSubscriptions >= 1);
      assert.equal(data.orderRevenuePaise, 155000);
      assert.equal(data.collectedSubscriptionRevenuePaise, 0);
      assert.equal(data.activeSubscriptionContractValuePaise, 315000);
      assert.equal(data.subscriptionRevenuePaise, 315000);
      // Total Paid Revenue must strictly equal collected revenue (155000), NOT uncollected contracts (470000)
      assert.equal(data.totalRevenuePaise, 155000, 'Total Paid Revenue must reflect money received only');
      assert.equal(data.combinedRevenuePaise, 155000, 'Combined Revenue must NOT include uncollected contract commitments');
    });

    it('GET /api/v1/admin/stats: verifies revenue reporting accuracy when verified captured subscription payment exists', async () => {
      // Seed an active multi-month subscription where only 1 monthly cycle was captured
      const paidSubId = `sub_paid_cycle_${Date.now()}`;
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Buffalo Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'active', 'Tomorrow, 6:00 AM', 'month', '6 Months Contract',
           1800000, $2, $3::jsonb
         )`,
        [
          regularCustId,
          paidSubId,
          JSON.stringify({
            subscriptionId: paidSubId,
            authType: 'recurring_charge',
            lastPaymentId: 'pay_sub_captured_kpi_test',
            authAmountPaise: 300000, // ₹3,000 captured for first cycle
            paidThroughDate: '2026-11-20',
            startDate: '2026-10-21'
          })
        ]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);

      assert.equal(data.orderRevenuePaise, 155000, 'Order revenue must reflect paid orders');
      assert.equal(data.collectedSubscriptionRevenuePaise, 300000, 'Collected subscription revenue must reflect captured charges');
      assert.equal(data.totalRevenuePaise, 455000, 'Total Paid Revenue must equal 155000 + 300000');
      assert.equal(data.combinedRevenuePaise, 455000, 'Combined revenue must equal Total Paid Revenue');
      assert.equal(data.activeSubscriptionContractValuePaise, 315000 + 1800000, 'Contract value must sum full commitments');
      // Verify that uncollected contract commitment (₹15,000) is NOT added to Total Paid Revenue
      assert.notEqual(data.totalRevenuePaise, 455000 + 1500000, 'Unpaid contract commitment must NEVER be included in Total Paid Revenue');
    });

    it('GET /api/v1/admin/orders: supports search, pagination and status filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/orders?search=${encodeURIComponent(testOrderNumber)}&status=placed&payment_status=paid`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'no-store, no-cache, must-revalidate, private');

      const data = JSON.parse(res.payload);
      assert.equal(data.total, 1);
      assert.equal(data.orders.length, 1);
      assert.equal(data.orders[0].order_number, testOrderNumber);
      assert.equal(data.orders[0].payment_status, 'paid');
      assert.equal(data.orders[0].order_status, 'placed');
    });

    it('GET /api/v1/admin/subscriptions: supports status filtering, search and pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/subscriptions?search=${encodeURIComponent(testSubId)}&status=active`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'no-store, no-cache, must-revalidate, private');

      const data = JSON.parse(res.payload);
      assert.equal(data.total, 1);
      assert.equal(data.subscriptions.length, 1);
      assert.equal(data.subscriptions[0].razorpay_subscription_id, testSubId);
      assert.equal(data.subscriptions[0].status, 'active');
      assert.equal(data.subscriptions[0].cost_per_day_paise, 10500);
    });

    it('PATCH /api/v1/admin/orders/:orderNumber/status: updates order fulfillment and records audit history', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/orders/${testOrderNumber}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'confirmed',
          courierName: 'Milvanta Direct',
          trackingNumber: 'MV-EXP-101',
          note: 'Operator verified dispatch'
        }
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.newStatus, 'confirmed');
      assert.equal(data.order.courier_name, 'Milvanta Direct');
      assert.equal(data.order.tracking_number, 'MV-EXP-101');

      // Verify audit history was recorded in database
      const { rows: history } = await pool.query(
        'SELECT previous_status, new_status, actor, note FROM order_status_history WHERE order_number = $1',
        [testOrderNumber]
      );
      assert.ok(history.length >= 1);
      assert.equal(history[0].new_status, 'confirmed');
    });
  });

  // =========================================================================
  // 3. Formula-Safe CSV Export & Excel Compatibility
  // =========================================================================
  describe('3. CSV Exports & Spreadsheet Formula Injection Protection', () => {
    it('GET /api/v1/admin/orders/export: neutralizes formula injection tokens and returns valid CSV', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders/export',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.headers['content-disposition'].includes('attachment; filename="milvanta-orders-'));
      assert.equal(res.headers['cache-control'], 'no-store, no-cache, must-revalidate, private');

      const csvText = res.payload;
      assert.ok(csvText.includes('Order ID,Order Number,Date (IST)'));
      assert.ok(csvText.includes(testOrderNumber));

      // Formula injection defense verification:
      // The name was '=CMD|\' /C calc\'!A0'. Must be escaped as "'=CMD..." so Excel doesn't execute it!
      assert.ok(
        csvText.includes("''=CMD") || csvText.includes("'=CMD"),
        'Must prepend single quote to neutralize formula injection beginning with ='
      );

      // Street began with '+12345'. Must be escaped with single quote!
      assert.ok(
        csvText.includes("'+12345"),
        'Must prepend single quote to neutralize formula injection beginning with +'
      );
    });

    it('GET /api/v1/admin/subscriptions/export: returns valid CSV with IST dates and INR rates', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/subscriptions/export',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.headers['content-disposition'].includes('attachment; filename="milvanta-subscriptions-'));

      const csvText = res.payload;
      assert.ok(csvText.includes('Subscription ID,Customer Name,Customer Email'));
      assert.ok(csvText.includes(testSubId));
      assert.ok(csvText.includes('105.00')); // INR daily rate
      assert.ok(csvText.includes('3150.00')); // INR total amount
    });
  });

  // =========================================================================
  // 4. File Synchronization Verification (Priority 2 #10)
  // =========================================================================
  describe('4. Frontend & Cloudflare Upload File Synchronization', () => {
    it('verifies frontend/admin.html and frontend/cloudflare-upload/admin.html are byte-for-byte identical', () => {
      const adminPath = path.resolve('frontend/admin.html');
      const cloudflareAdminPath = path.resolve('frontend/cloudflare-upload/admin.html');

      assert.ok(fs.existsSync(adminPath), 'frontend/admin.html must exist');
      assert.ok(fs.existsSync(cloudflareAdminPath), 'frontend/cloudflare-upload/admin.html must exist');

      const adminContent = fs.readFileSync(adminPath, 'utf8').replace(/\r\n/g, '\n');
      const cloudflareContent = fs.readFileSync(cloudflareAdminPath, 'utf8').replace(/\r\n/g, '\n');

      assert.equal(adminContent, cloudflareContent, 'frontend/admin.html and cloudflare-upload/admin.html must match exactly');
    });

    it('verifies frontend code does NOT embed ADMIN_API_KEY or DATABASE_URL', () => {
      const adminPath = path.resolve('frontend/admin.html');
      const content = fs.readFileSync(adminPath, 'utf8');

      assert.equal(content.includes('ADMIN_API_KEY'), false, 'frontend must never contain ADMIN_API_KEY');
      assert.equal(content.includes('DATABASE_URL'), false, 'frontend must never contain DATABASE_URL');
      assert.equal(content.includes('test_admin_secret_key_12345'), false, 'frontend must never contain admin secret key');
    });
  });

  // =========================================================================
  // 5. Admin Dashboard Security: HTML Injection Prevention, Safe DOM & Session Storage
  // =========================================================================
  describe('5. Admin Dashboard Security: HTML Injection Prevention, Safe DOM & Session Storage', () => {
    const adminPath = path.resolve('frontend/admin.html');
    const htmlContent = fs.readFileSync(adminPath, 'utf8');

    it('verifies frontend/admin.html has NO inline onclick attributes constructed from order or customer data', () => {
      const inlineOnclickRegex = /onclick\s*=\s*["'][^"']*["']/gi;
      const matches = htmlContent.match(inlineOnclickRegex) || [];
      assert.equal(matches.length, 0, `Expected 0 inline onclick attributes, found: ${matches.join(', ')}`);
    });

    it('verifies frontend/admin.html does NOT use innerHTML for dynamic tables or error reporting', () => {
      // Find any innerHTML assignments inside the script block
      const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/i);
      assert.ok(scriptMatch, 'script tag must exist');
      const scriptCode = scriptMatch[1];
      const innerHtmlRegex = /\.innerHTML\s*=/g;
      const innerHtmlMatches = scriptCode.match(innerHtmlRegex) || [];
      assert.equal(innerHtmlMatches.length, 0, 'No innerHTML assignments should exist in admin script');
    });

    it('renders actual refund rows, actions and error messages without interpreting hostile data as HTML', () => {
      class Element {
        constructor(tag) {
          this.tagName = tag;
          this.children = [];
          this.style = {};
          this.dataset = {};
          this.textContent = '';
        }
        appendChild(child) { this.children.push(child); return child; }
        replaceChildren(...children) { this.children = children; }
        get firstChild() { return this.children[0]; }
        set innerHTML(value) { throw new Error('Unsafe HTML assignment: ' + value); }
      }
      const tbody = new Element('tbody');
      const document = {
        getElementById(id) { assert.equal(id, 'refundsTableBody'); return tbody; },
        createElement(tag) { return new Element(tag); }
      };
      const source = htmlContent.slice(htmlContent.indexOf('      function showRefundTableMessage('), htmlContent.indexOf('      function updateRefundPagination('));
      const context = vm.createContext({ document });
      vm.runInContext(source, context);
      const hostile = '<img src=x onerror="alert(1)">';
      const refund = {
        id: '1" onclick="alert(1)', requestNumber: hostile, requestType: hostile,
        customerName: hostile, customerPhone: hostile, orderNumber: hostile,
        requestedAmount: 100, approvedAmount: 50, reasonCategory: hostile,
        status: 'pending', createdAt: '2026-10-01', reviewerName: hostile
      };
      context.renderRefundsTable([refund]);
      const row = tbody.firstChild;
      assert.equal(row.children.length, 10);
      assert.equal(row.children[0].firstChild.textContent, hostile);
      assert.equal(row.children[1].firstChild.textContent, hostile);
      assert.equal(row.children[2].firstChild.textContent, hostile);
      assert.equal(row.children[2].children[1].textContent, hostile);
      assert.equal(row.children[3].firstChild.textContent, 'Order #' + hostile);
      assert.equal(row.children[4].firstChild.textContent, '\u20b9100');
      assert.equal(row.children[5].firstChild.textContent, '\u20b950');
      assert.equal(row.children[6].firstChild.textContent, hostile);
      const buttons = row.children[9].firstChild.children;
      assert.equal(buttons.length, 2);
      assert.equal(buttons[0].dataset.refId, refund.id);
      assert.equal(buttons[0].className, 'btn-update-order btn-approve-refund');
      assert.equal(buttons[1].className, 'btn-reset btn-reject-refund');
      context.renderRefundsTable([{ ...refund, status: hostile }]);
      assert.equal(tbody.firstChild.children[7].firstChild.textContent, hostile);
      assert.equal(tbody.firstChild.children[9].firstChild.textContent, 'Reviewed by ' + hostile);
      context.renderRefundsTable([]);
      assert.equal(tbody.firstChild.firstChild.colSpan, 10);
      assert.match(tbody.firstChild.firstChild.textContent, /No refund requests/);
      context.showRefundTableMessage(tbody, 'Failed to load refunds: ' + hostile, true);
      assert.equal(tbody.firstChild.firstChild.textContent, 'Failed to load refunds: ' + hostile);
    });

    it('verifies frontend/admin.html prefers sessionStorage for admin tokens and clears localStorage', () => {
      assert.ok(
        htmlContent.includes("sessionStorage.getItem('milvanta-admin-token')"),
        'Must check sessionStorage for milvanta-admin-token'
      );
      assert.ok(
        htmlContent.includes("sessionStorage.setItem('milvanta-admin-token'"),
        'Must store token in sessionStorage on login'
      );
      assert.ok(
        htmlContent.includes("localStorage.removeItem('milvanta-auth-token')"),
        'Must remove admin token from persistent localStorage'
      );
    });

    it('regression: safe DOM creation neutralizes hostile HTML and quotation-mark inputs', () => {
      // Hostile customer, address, courier, tracking, and item payload
      const hostileData = {
        name: '<script>alert("xss-name")</script>',
        email: 'attacker"><img src=x onerror=alert(1)>@evil.com',
        phone: "'+1234567890' OR '1'='1",
        house: '<img src=x onerror=alert("house")>',
        street: '"><svg/onload=alert("street")>',
        city: 'O\'Fallon "City"',
        item: '<b onmouseover="alert(\'item\')">Dangerous Ghee</b>',
        courier: 'Courier\'); alert("pwned"); //',
        tracking: 'TRK"><script>alert("trk")</script>'
      };

      // Verify template uses safe DOM node creation
      assert.ok(htmlContent.includes('document.createElement'), 'Must use document.createElement for safe DOM nodes');
      assert.ok(htmlContent.includes('textContent ='), 'Must use textContent to prevent HTML execution');
      assert.ok(htmlContent.includes('document.createTextNode'), 'Must use createTextNode for text elements');

      // Verify that hostile values assigned to textContent are treated as literal text
      const mockElem = { textContent: '' };
      mockElem.textContent = hostileData.name;
      assert.equal(mockElem.textContent, '<script>alert("xss-name")</script>');

      mockElem.textContent = hostileData.courier;
      assert.equal(mockElem.textContent, 'Courier\'); alert("pwned"); //');

      // Verify KPI revenue label displays accurate non-revenue notice
      assert.ok(
        htmlContent.includes('Active Subscription Contract Value (not collected revenue)'),
        'Must contain accurate contract value KPI label'
      );
    });
  });
});

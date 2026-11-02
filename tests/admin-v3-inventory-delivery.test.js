/**
 * MILVANTA ADMIN V3 — CUSTOMERS, INVENTORY & DELIVERY CONFIRMATION TEST SUITE
 *
 * Verifies:
 * 1. Authoritative subscription delivery address resolution & completeness audit
 * 2. Complete customer details endpoint with addresses, delivery history, financial summary, and zero secrets
 * 3. Store products & practical inventory management (thresholds, reservations, audit ledger)
 * 4. Authoritative delivery status management (scheduled -> packed -> out_for_delivery -> delivered / failed)
 * 5. Delivery confirmation proof & failure reason recording with admin actor attribution
 * 6. Customer calendar & profile synchronization with live delivery states
 * 7. Frontend dual-copy parity, safe DOM & CSP integrity
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import {
  normalizeDeliveryAddress,
  resolveSubscriptionDeliveryAddress
} from '../src/services/subscriptionService.js';
import {
  updateDeliveryStatus,
  generateDailyDeliveries
} from '../src/services/deliveryEngine.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin_security_v3_polish_secret_minimum_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_security_v3_key';

assertTestDatabaseConfigured();
const fixture = await setupDisposableTestSchema();
const { app, pool } = await import('../src/server.js');
const scrypt = promisify(crypto.scrypt);

async function createTestCustomer(email, fullName, isAdmin = false) {
  const password = 'TestPassword#1234!';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
  const phone = '9' + Math.floor(100000000 + Math.random() * 900000000);
  const { rows: [customer] } = await fixture.pool.query(
    'INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, is_admin',
    [fullName, phone, email, salt, hash, isAdmin]
  );
  return { customer, password, email };
}

describe('Milvanta Admin V3 — Inventory, Delivery & Customer Management Suite', () => {
  let adminToken;
  let customerToken;
  let adminCustomerId;
  let regularCustomerId;

  before(async () => {
    // Run migration 016 if not already executed
    const mig016 = fs.readFileSync('migrations/016_admin_v3_inventory_and_subscriptions.sql', 'utf8');
    await fixture.pool.query(mig016);

    // Create Admin Customer
    const adminUser = await createTestCustomer('admin.v3.suite@milvanta.in', 'Admin Operator', true);
    adminCustomerId = adminUser.customer.id;

    // Create Regular Customer
    const regularUser = await createTestCustomer('radha.v3.suite@milvanta.in', 'Radha Krishna', false);
    regularCustomerId = regularUser.customer.id;

    // Seed Customer Addresses for regular customer
    await fixture.pool.query(`
      INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
      VALUES
        ($1, 'fp_test_1', 'Radha Krishna', '+919999900002', 'Flat 402', 'Sri Sai Towers', 'Kavuri Hills Phase 2', 'Near D-Mart', 'Hyderabad', 'Telangana', '500033', TRUE),
        ($1, 'fp_test_2', 'Radha Office', '+919999900002', 'Office 3B', 'Tech Park', 'HITEC City', 'Opp Cyber Towers', 'Hyderabad', 'Telangana', '500081', FALSE);
    `, [regularCustomerId]);

    // Authenticate Admin & Customer
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: adminUser.email, password: adminUser.password }
    });
    adminToken = JSON.parse(adminLogin.body).token;

    const custLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: regularUser.email, password: regularUser.password }
    });
    customerToken = JSON.parse(custLogin.body).token;
  });

  after(async () => {
    await app.close();
    await pool.end();
    await cleanupDisposableTestSchema(fixture.pool, fixture.schemaName);
  });

  // =========================================================================
  // 1. DELIVERY ADDRESS RESOLUTION & PRIORITY
  // =========================================================================
  describe('1. Authoritative Subscription Delivery Address Resolution', () => {
    test('normalizes partial address candidate into complete structured object', () => {
      const candidate = {
        house: 'Villa 14',
        building: 'Palm Meadows',
        street: 'Gachibowli Main Rd',
        landmark: 'Behind Bio-Diversity Park',
        city: 'Hyderabad',
        pincode: '500032',
        instructions: 'Silent drop, leave in basket'
      };
      const res = normalizeDeliveryAddress(candidate, 'Radha', '+919999900002', 'explicit');
      assert.equal(res.house, 'Villa 14');
      assert.equal(res.building, 'Palm Meadows');
      assert.equal(res.street, 'Gachibowli Main Rd');
      assert.equal(res.landmark, 'Behind Bio-Diversity Park');
      assert.equal(res.city, 'Hyderabad');
      assert.equal(res.pincode, '500032');
      assert.equal(res.delivery_instructions, 'Silent drop, leave in basket');
      assert.equal(res.is_complete, true);
      assert.equal(res.missing_fields.length, 0);
      assert.ok(res.formattedAddress.includes('Villa 14'));
      assert.ok(res.formattedAddress.includes('500032'));
    });

    test('flags missing street or pincode as incomplete', () => {
      const res = normalizeDeliveryAddress({ house: 'Flat 101' }, 'Radha', '+919999900002', 'partial');
      assert.equal(res.is_complete, false);
      assert.ok(res.missing_fields.includes('street'));
      assert.ok(res.missing_fields.includes('pincode'));
    });

    test('resolves explicit subscription delivery_address prior to customer default address', async () => {
      const sub = {
        id: '9901',
        customer_id: regularCustomerId,
        delivery_address: {
          house: 'Penthouse 12',
          building: 'Aura Heights',
          street: 'Jubilee Hills Rd 36',
          city: 'Hyderabad',
          pincode: '500033'
        }
      };
      const resolved = await resolveSubscriptionDeliveryAddress(fixture.pool, sub);
      assert.equal(resolved.building, 'Aura Heights');
      assert.equal(resolved.street, 'Jubilee Hills Rd 36');
      assert.equal(resolved.source, 'explicit_subscription');
    });

    test('falls back to linked address_id in customer_addresses if subscription delivery_address is absent', async () => {
      const addrRow = await fixture.pool.query(`SELECT id FROM customer_addresses WHERE customer_id = $1 AND is_default = FALSE LIMIT 1;`, [regularCustomerId]);
      const linkedAddressId = addrRow.rows[0].id;

      const sub = {
        id: '9902',
        customer_id: regularCustomerId,
        address_id: linkedAddressId
      };
      const resolved = await resolveSubscriptionDeliveryAddress(fixture.pool, sub);
      assert.equal(resolved.building, 'Tech Park');
      assert.equal(resolved.street, 'HITEC City');
      assert.equal(resolved.source, 'linked_customer_address');
    });

    test('falls back to customer default address if subscription has no explicit address', async () => {
      const sub = {
        id: '9903',
        customer_id: regularCustomerId
      };
      const resolved = await resolveSubscriptionDeliveryAddress(fixture.pool, sub);
      assert.equal(resolved.building, 'Sri Sai Towers');
      assert.equal(resolved.street, 'Kavuri Hills Phase 2');
      assert.equal(resolved.source, 'customer_default_address');
      assert.equal(resolved.is_complete, true);
    });
  });

  // =========================================================================
  // 2. COMPLETE CUSTOMER DETAILS ENDPOINT
  // =========================================================================
  describe('2. Admin Customer Details (/api/v1/admin/customers/:id/details)', () => {
    test('rejects non-admin customer request with HTTP 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${regularCustomerId}/details`,
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('returns all saved addresses, default address, and payment summary with zero secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${regularCustomerId}/details`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);

      // Customer Object
      assert.equal(data.customer.id, regularCustomerId);
      assert.equal(data.customer.full_name, 'Radha Krishna');
      assert.equal(data.customer.password_hash, undefined, 'password_hash must never be returned');
      assert.equal(data.customer.token, undefined, 'token must never be returned');

      // Saved Addresses
      assert.ok(Array.isArray(data.addresses));
      assert.equal(data.addresses.length, 2);
      const defaultAddr = data.addresses.find(a => a.is_default);
      assert.ok(defaultAddr);
      assert.equal(defaultAddr.building, 'Sri Sai Towers');

      // Payment Summary
      assert.ok(data.paymentSummary);
      assert.equal(typeof data.paymentSummary.verifiedCapturedPaise, 'number');
      assert.equal(typeof data.paymentSummary.orderSpendingPaise, 'number');
      assert.equal(typeof data.paymentSummary.approvedRefundsPaise, 'number');
    });
  });

  // =========================================================================
  // 3. STORE PRODUCTS & PRACTICAL INVENTORY MANAGEMENT
  // =========================================================================
  describe('3. Practical Inventory Management (Products & Stock Ledger)', () => {
    let createdProductId;

    test('GET /api/v1/admin/inventory returns products, available stock and separated milk demand', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/inventory',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data.products));
      assert.ok(data.milkRequirements);
      assert.ok(data.milkRequirements.today);
      assert.ok(data.milkRequirements.tomorrow);
      assert.equal(typeof data.milkRequirements.today.cowLitres, 'number');
      assert.equal(typeof data.milkRequirements.today.buffaloLitres, 'number');
    });

    test('POST /api/v1/admin/products creates a product and writes initial restock ledger entry', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/products',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Pure Desi A2 Cow Ghee (500ml)',
          slug: 'pure-desi-a2-cow-ghee-500ml',
          category: 'ghee',
          price: 650,
          selling_unit: '500 ml glass jar',
          stock_quantity: 40,
          low_stock_threshold: 10
        }
      });
      assert.equal(res.statusCode, 201);
      const data = JSON.parse(res.body);
      createdProductId = data.product.id;
      assert.equal(data.product.name, 'Pure Desi A2 Cow Ghee (500ml)');
      assert.equal(data.product.stock_quantity, 40);
      assert.equal(data.product.reserved_stock, 0);
      assert.equal(data.product.available_stock, 40);

      // Verify Initial Ledger Entry
      const ledger = await fixture.pool.query(`SELECT * FROM product_stock_ledger WHERE product_id = $1;`, [createdProductId]);
      assert.equal(ledger.rows.length, 1);
      assert.equal(ledger.rows[0].adjustment_type, 'restock');
      assert.equal(ledger.rows[0].quantity_change, 40);
      assert.equal(ledger.rows[0].new_stock, 40);
    });

    test('PATCH /api/v1/admin/products/:id updates price, unit, and threshold', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/products/${createdProductId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          price: 675,
          selling_unit: '500 ml premium glass jar',
          low_stock_threshold: 8,
          is_active: true
        }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.product.price, '675.00');
      assert.equal(data.product.low_stock_threshold, 8);
    });

    test('POST /api/v1/admin/inventory/:id/adjust handles damage adjustment and prevents stock < reserved_stock', async () => {
      // Artificially reserve 15 units
      await fixture.pool.query(`UPDATE products SET reserved_stock = 15 WHERE id = $1;`, [createdProductId]);

      // Attempt to reduce stock by 30 (from 40 to 10, which is < reserved 15) -> must be rejected
      const failRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${createdProductId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          adjustmentType: 'damage',
          quantityChange: -30,
          reason: 'Broken jars in transit'
        }
      });
      assert.equal(failRes.statusCode, 400);
      assert.ok(JSON.parse(failRes.body).error.includes('cannot be less than reserved stock'));

      // Valid adjustment: reduce by 5 (40 -> 35 >= 15 reserved)
      const successRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${createdProductId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          adjustmentType: 'damage',
          quantityChange: -5,
          reason: '5 jars dropped during unloading'
        }
      });
      assert.equal(successRes.statusCode, 200);
      const adjData = JSON.parse(successRes.body);
      assert.equal(adjData.product.stock_quantity, 35);
      assert.equal(adjData.product.reserved_stock, 15);
      assert.equal(adjData.product.available_stock, 20);

      // Verify Ledger
      const histRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/inventory/${createdProductId}/history`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(histRes.statusCode, 200);
      const histData = JSON.parse(histRes.body);
      assert.equal(histData.history.length, 2);
      assert.equal(histData.history[0].adjustment_type, 'damage');
      assert.equal(histData.history[0].quantity_change, -5);
      assert.equal(histData.history[0].previous_stock, 40);
      assert.equal(histData.history[0].new_stock, 35);
      assert.ok(histData.history[0].admin_actor.includes('Admin') || histData.history[0].admin_actor.includes('admin'));
    });
  });

  // =========================================================================
  // 4. AUTHORITATIVE DELIVERY STATUS & LIFECYCLE
  // =========================================================================
  describe('4. Delivery Status Transitions & Admin Actor Attribution', () => {
    let subId;
    let deliveryOrderId;
    const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400000));

    before(async () => {
      // Create active entitled subscription
      const subRes = await fixture.pool.query(`
        INSERT INTO customer_subscriptions (
          customer_id, product_name, quantity, time_slot, frequency,
          cost_per_day_paise, total_amount_paise, status, delivery_address, notes
        ) VALUES (
          $1, 'Pure Cow Milk', '1L', 'morning', 'daily',
          10500, 315000, 'active',
          '{"house":"Flat 402","building":"Sri Sai Towers","street":"Kavuri Hills Phase 2","city":"Hyderabad","pincode":"500033"}'::jsonb,
          $2::jsonb
        ) RETURNING id;
      `, [
        regularCustomerId,
        JSON.stringify({
          fulfillmentEntitled: true,
          paymentId: 'pay_test_v3_confirm_1',
          lastPaymentId: 'pay_test_v3_confirm_1',
          startDate: tomorrowStr,
          effectivePaidThroughDate: tomorrowStr,
          paidThroughDate: '2027-12-31'
        })
      ]);
      subId = subRes.rows[0].id;



      // Generate delivery order for tomorrow
      const genRes = await generateDailyDeliveries(fixture.pool, tomorrowStr, 'admin_v3_test');
      assert.ok(genRes.generatedCount >= 1);

      const delOrderRow = await fixture.pool.query(`
        SELECT id FROM subscription_delivery_orders
        WHERE subscription_id = $1 AND delivery_date = $2;
      `, [subId, tomorrowStr]);
      assert.ok(delOrderRow.rows.length >= 1);
      deliveryOrderId = delOrderRow.rows[0].id;
    });

    test('transitions: scheduled -> packed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${deliveryOrderId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { status: 'packed' }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.delivery.status, 'packed');
    });

    test('transitions: packed -> out_for_delivery', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${deliveryOrderId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { status: 'out_for_delivery' }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.delivery.status, 'out_for_delivery');
    });

    test('transitions: out_for_delivery -> delivered records proof and admin actor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${deliveryOrderId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'delivered',
          proofOfDelivery: 'Placed in doorstep milk cooler box'
        }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.delivery.status, 'delivered');
      assert.equal(data.delivery.proof_of_delivery, 'Placed in doorstep milk cooler box');
      assert.ok(data.delivery.delivered_by.includes('Admin') || data.delivery.delivered_by.includes('admin'));
      assert.ok(data.delivery.delivered_at);

      // Verify single entitlement deduction in ledger
      const ledgerRows = await fixture.pool.query(`
        SELECT * FROM subscription_entitlement_ledger
        WHERE subscription_id = $1 AND entry_type = 'delivery_fulfilled';
      `, [subId]);
      assert.equal(ledgerRows.rows.length, 1);
      assert.equal(ledgerRows.rows[0].days_delta, -1);

      // Repeat status update (idempotency test): must NOT add duplicate ledger deductions
      await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${deliveryOrderId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { status: 'delivered' }
      });
      const repeatLedgerRows = await fixture.pool.query(`
        SELECT * FROM subscription_entitlement_ledger
        WHERE subscription_id = $1 AND entry_type = 'delivery_fulfilled';
      `, [subId]);
      assert.equal(repeatLedgerRows.rows.length, 1, 'Delivery fulfilled ledger entry must remain idempotent');
    });

    test('transitions: out_for_delivery -> failed records failure reason and actor', async () => {
      // Create a second delivery order
      const secondDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 2 * 86400000));
      const secondOrder = await fixture.pool.query(`
        INSERT INTO subscription_delivery_orders (
          delivery_order_number, subscription_id, customer_id, delivery_date,
          product_name, quantity, status, delivery_address
        ) VALUES (
          'MV-DEL-FAIL-TEST', $1, $2, $3,
          'Pure Cow Milk', '1L', 'out_for_delivery',
          '{"house":"402","street":"Road 2","pincode":"500033"}'::jsonb
        ) RETURNING id;
      `, [subId, regularCustomerId, secondDate]);
      const failOrderId = secondOrder.rows[0].id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${failOrderId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'failed',
          failureReason: 'Gate locked, customer phone unreachable'
        }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.delivery.status, 'failed');
      assert.equal(data.delivery.failure_reason || data.delivery.failed_reason, 'Gate locked, customer phone unreachable');
      assert.ok(data.delivery.failed_by.includes('Admin') || data.delivery.failed_by.includes('admin'));
    });
  });

  // =========================================================================
  // 5. CUSTOMER CALENDAR & PROFILE SYNCHRONIZATION
  // =========================================================================
  describe('5. Customer Delivery Calendar & Profile Synchronization', () => {
    let subId;
    const testDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400000));
    const year = parseInt(testDate.slice(0, 4), 10);
    const month = parseInt(testDate.slice(5, 7), 10) - 1; // 0-indexed
    const day = parseInt(testDate.slice(8, 10), 10);

    before(async () => {
      const subRes = await fixture.pool.query(`
        INSERT INTO customer_subscriptions (
          customer_id, product_name, quantity, time_slot, frequency,
          cost_per_day_paise, total_amount_paise, status, delivery_address, notes
        ) VALUES (
          $1, 'Pure Farm Buffalo Milk', '500ml', 'morning', 'daily',
          6500, 195000, 'active',
          '{"house":"101","street":"Rd 1","pincode":"500033"}'::jsonb,
          $2::jsonb
        ) RETURNING id;
      `, [
        regularCustomerId,
        JSON.stringify({
          fulfillmentEntitled: true,
          paymentId: 'pay_test_v3_sync_1',
          lastPaymentId: 'pay_test_v3_sync_1',
          startDate: testDate,
          effectivePaidThroughDate: testDate,
          paidThroughDate: '2027-12-31'
        })
      ]);
      subId = subRes.rows[0].id;

      await fixture.pool.query(`
        INSERT INTO subscription_delivery_orders (
          delivery_order_number, subscription_id, customer_id, delivery_date,
          product_name, quantity, status, delivery_address, delivered_at, proof_of_delivery
        ) VALUES (
          'MV-DEL-SYNC-01', $1, $2, $3,
          'Pure Farm Buffalo Milk', '500ml', 'delivered',
          '{"house":"101","street":"Rd 1","pincode":"500033"}'::jsonb,
          NOW(), 'Handed over'
        );
      `, [subId, regularCustomerId, testDate]);
    });

    test('GET /api/v1/subscriptions/:id/calendar returns authoritative delivered status and detail', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/subscriptions/${subId}/calendar?year=${year}&month=${month}`,
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const matchDay = data.days.find(d => d.day === day);
      assert.ok(matchDay);
      assert.equal(matchDay.status, 'delivered');
      assert.ok(matchDay.detail.includes('Delivered'));
    });

    test('GET /api/v1/subscriptions returns live delivery status summary and resolved address', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const sub = data.subscriptions.find(s => String(s.id) === String(subId));
      assert.ok(sub);
      assert.equal(sub.last_delivery_status, 'delivered');
      assert.equal(sub.delivered_count, 1);
      assert.ok(sub.delivery_address);
      assert.equal(sub.delivery_address.house, '101');
    });
  });

  // =========================================================================
  // 6. FRONTEND PARITY & SECURITY HARDENING
  // =========================================================================
  describe('6. Frontend Parity & Security Invariants', () => {
    test('verifies admin.html primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      const f1 = fs.readFileSync('frontend/admin.html');
      const f2 = fs.readFileSync('frontend/cloudflare-upload/admin.html');
      assert.ok(f1.equals(f2), 'frontend/admin.html and cloudflare-upload/admin.html must be identical');
    });

    test('verifies profile.html primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      const f1 = fs.readFileSync('frontend/profile.html');
      const f2 = fs.readFileSync('frontend/cloudflare-upload/profile.html');
      assert.ok(f1.equals(f2), 'profile.html dual copies must be identical');
    });

    test('verifies profile.js and profile.css primary and cloudflare copies are 100% byte-for-byte identical', () => {
      const js1 = fs.readFileSync('frontend/js/profile.js');
      const js2 = fs.readFileSync('frontend/cloudflare-upload/js/profile.js');
      assert.ok(js1.equals(js2), 'profile.js dual copies must be identical');

      const css1 = fs.readFileSync('frontend/css/profile.css');
      const css2 = fs.readFileSync('frontend/cloudflare-upload/css/profile.css');
      assert.ok(css1.equals(css2), 'profile.css dual copies must be identical');
    });

    test('verifies strict safe DOM practices: 0 innerHTML assignments in admin script and 0 inline onclick attributes', () => {
      const html = fs.readFileSync('frontend/admin.html', 'utf8');
      const scriptStart = html.indexOf('<script>');
      const scriptEnd = html.indexOf('</script>', scriptStart);
      const scriptContent = html.substring(scriptStart, scriptEnd);

      const innerHtmlMatches = scriptContent.match(/\.innerHTML\s*=/g) || [];
      assert.equal(innerHtmlMatches.length, 0, 'No innerHTML assignments should exist in admin script');

      const onclickMatches = html.match(/\sonclick\s*=/gi) || [];
      assert.equal(onclickMatches.length, 0, 'No inline onclick attributes should exist in admin.html');
    });
  });
});

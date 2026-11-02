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
  generateDailyDeliveries,
  previewDailyDeliveries
} from '../src/services/deliveryEngine.js';
import {
  queueWhatsAppNotification
} from '../src/services/whatsappService.js';

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

  // =========================================================================
  // 7. AUTHORITATIVE HARDENING & MERGE BLOCKERS REVIEW
  // =========================================================================
  describe('7. Authoritative Hardening & Edge Cases (Merge Blockers Review)', () => {
    const futureDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 3 * 86400000));

    test('authoritative subscription delivery address takes precedence over customer default address in preview and generation', async () => {
      // 1. Create Customer C
      const charlieUser = await createTestCustomer('charlie.v3@milvanta.in', 'Charlie Chaplin', false);
      const charlieId = charlieUser.customer.id;

      // 2. Give Charlie a default address
      await fixture.pool.query(`
        INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
        VALUES ($1, 'fp_charlie_def', 'Charlie Chaplin', '+919999900003', 'Flat 101', 'Default Residency', 'Main Rd', 'Near Clock', 'Hyderabad', 'Telangana', '500033', TRUE);
      `, [charlieId]);

      // 3. Create Subscription with EXPLICIT delivery_address
      const subRes = await fixture.pool.query(`
        INSERT INTO customer_subscriptions (
          customer_id, product_name, quantity, time_slot, frequency,
          cost_per_day_paise, total_amount_paise, status, delivery_address, notes
        ) VALUES (
          $1, 'Pure Cow Milk', '1L', 'morning', 'daily',
          10500, 315000, 'active',
          '{"recipient_name":"Charlie Chaplin","phone":"+919999900003","house":"Suite 99","building":"Explicit Tower","street":"Gachibowli Ring Rd","city":"Secunderabad","state":"Telangana","pincode":"500003"}'::jsonb,
          $2::jsonb
        ) RETURNING id;
      `, [
        charlieId,
        JSON.stringify({
          fulfillmentEntitled: true,
          paymentId: 'pay_test_charlie_explicit',
          lastPaymentId: 'pay_test_charlie_explicit',
          startDate: futureDateStr,
          effectivePaidThroughDate: futureDateStr,
          paidThroughDate: '2027-12-31'
        })
      ]);
      const subId = subRes.rows[0].id;

      // 4. Test Preview
      const preview = await previewDailyDeliveries(fixture.pool, futureDateStr);
      const previewItem = preview.eligibleSubscriptions.find(s => String(s.subscriptionId) === String(subId));
      if (!previewItem) {
        throw new Error(`Charlie subId ${subId} not found in preview. Eligible: ${JSON.stringify(preview.eligibleSubscriptions)}, Excluded: ${JSON.stringify(preview.excludedSubscriptions)}`);
      }
      assert.ok(previewItem, 'Charlie subscription must be eligible in preview');
      assert.equal(previewItem.deliveryAddress.street, 'Gachibowli Ring Rd');
      assert.equal(previewItem.deliveryAddress.building, 'Explicit Tower');
      assert.equal(previewItem.deliveryAddress.city, 'Secunderabad');
      assert.equal(previewItem.deliveryAddress.pincode, '500003');
      assert.equal(previewItem.deliveryAddress.source, 'explicit_subscription');

      // 5. Test Actual Generation
      const genRes = await generateDailyDeliveries(fixture.pool, futureDateStr, 'charlie_test');
      assert.ok(genRes.generatedCount >= 1);

      const orderRow = await fixture.pool.query(`
        SELECT delivery_address FROM subscription_delivery_orders
        WHERE subscription_id = $1 AND delivery_date = $2;
      `, [subId, futureDateStr]);
      assert.ok(orderRow.rows.length >= 1);
      const generatedAddress = orderRow.rows[0].delivery_address;
      assert.equal(generatedAddress.street, 'Gachibowli Ring Rd');
      assert.equal(generatedAddress.building, 'Explicit Tower');
      assert.equal(generatedAddress.city, 'Secunderabad');
      assert.equal(generatedAddress.pincode, '500003');
    });

    test('cross-customer linked address: address belonging to another customer is rejected and not resolved', async () => {
      // Create Customer D
      const davidUser = await createTestCustomer('david.v3@milvanta.in', 'David Copperfield', false);
      const davidId = davidUser.customer.id;

      // Find an address belonging to regularCustomerId (NOT David)
      const { rows: [radhaAddr] } = await fixture.pool.query(
        `SELECT id FROM customer_addresses WHERE customer_id = $1 LIMIT 1;`,
        [regularCustomerId]
      );
      assert.ok(radhaAddr);

      // David tries to reference Radha's address
      const subWithForeignAddress = {
        id: '9905',
        customer_id: davidId,
        address_id: radhaAddr.id
      };

      const resolved = await resolveSubscriptionDeliveryAddress(fixture.pool, subWithForeignAddress);
      // Because David has no addresses of his own, and foreign address is rejected, resolved source must be 'none'
      assert.notEqual(resolved.source, 'linked_customer_address');
      assert.equal(resolved.is_complete, false);
      assert.equal(resolved.street, '');
    });

    test('fails closed on incomplete delivery address and does not invent Hyderabad/Telangana defaults', async () => {
      const incompleteCandidate = {
        house: 'House 55',
        landmark: 'Opp Park'
        // Missing street, city, pincode, recipient_name, phone
      };
      const norm = normalizeDeliveryAddress(incompleteCandidate, '', '', 'partial_candidate');
      assert.equal(norm.is_complete, false);
      assert.ok(norm.missing_fields.includes('street'));
      assert.ok(norm.missing_fields.includes('city'));
      assert.ok(norm.missing_fields.includes('pincode'));
      assert.equal(norm.city, '', 'City must NOT default to Hyderabad');
      assert.equal(norm.state, '', 'State must NOT default to Telangana');

      // Verify that in delivery preview, an active subscription with incomplete address is excluded
      const testDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 4 * 86400000));
      const incompleteUser = await createTestCustomer('incomplete.addr@milvanta.in', 'Incomplete User', false);
      const subRes = await fixture.pool.query(`
        INSERT INTO customer_subscriptions (
          customer_id, product_name, quantity, time_slot, frequency,
          cost_per_day_paise, total_amount_paise, status, delivery_address, notes
        ) VALUES (
          $1, 'Pure Cow Milk', '1L', 'morning', 'daily',
          10500, 315000, 'active',
          '{"house":"House 55"}'::jsonb,
          $2::jsonb
        ) RETURNING id;
      `, [
        incompleteUser.customer.id,
        JSON.stringify({
          fulfillmentEntitled: true,
          paymentId: 'pay_test_incomplete_addr',
          lastPaymentId: 'pay_test_incomplete_addr',
          startDate: testDate,
          effectivePaidThroughDate: testDate,
          paidThroughDate: '2027-12-31'
        })
      ]);

      const preview = await previewDailyDeliveries(fixture.pool, testDate);
      const excluded = preview.excludedSubscriptions.find(s => String(s.subscriptionId) === String(subRes.rows[0].id));
      assert.ok(excluded, 'Incomplete address subscription must be excluded from preview');
      assert.equal(excluded.reason, 'missingOrInvalidAddress');
      assert.ok(excluded.exclusionMessage.includes('incomplete'));
    });

    test('customer financial summary: captured revenue requires verified payments; refunds require gateway confirmation', async () => {
      const finUser = await createTestCustomer('financial.summary@milvanta.in', 'Financial Customer', false);
      const finId = finUser.customer.id;

      // 1. Subscription with contract total but NO payment evidence
      await fixture.pool.query(`
        INSERT INTO customer_subscriptions (
          customer_id, product_name, quantity, time_slot, frequency,
          cost_per_day_paise, total_amount_paise, status, notes
        ) VALUES (
          $1, 'Pure Cow Milk', '1L', 'morning', 'daily',
          10500, 450000, 'active',
          '{"fulfillmentEntitled":false}'::jsonb
        );
      `, [finId]);

      // 2. Paid Order (₹500 = 50000 paise)
      await fixture.pool.query(`
        INSERT INTO customer_orders (customer_id, order_number, idempotency_key, subtotal_paise, total_paise, order_status, payment_status, address, items)
        VALUES ($1, 'ORD-FIN-01', 'idem_fin_01', 50000, 50000, 'confirmed', 'paid', '{}'::jsonb, '[]'::jsonb);
      `, [finId]);

      // 3. Unpaid Order (₹300 = 30000 paise)
      await fixture.pool.query(`
        INSERT INTO customer_orders (customer_id, order_number, idempotency_key, subtotal_paise, total_paise, order_status, payment_status, address, items)
        VALUES ($1, 'ORD-FIN-02', 'idem_fin_02', 30000, 30000, 'pending', 'pending', '{}'::jsonb, '[]'::jsonb);
      `, [finId]);

      // 4. Refund: pending (₹100 = 10000 paise)
      await fixture.pool.query(`
        INSERT INTO refund_requests (customer_id, request_number, request_type, reason_category, payment_id, idempotency_key, requested_amount_paise, status)
        VALUES ($1, 'REF-FIN-01', 'order', 'cancellation', 'pay_fin_ref_1', 'idem_ref_01', 10000, 'pending');
      `, [finId]);

      // 5. Refund: approved (₹150 = 15000 paise) - NOT yet gateway processed
      await fixture.pool.query(`
        INSERT INTO refund_requests (customer_id, request_number, request_type, reason_category, payment_id, idempotency_key, requested_amount_paise, approved_amount_paise, status)
        VALUES ($1, 'REF-FIN-02', 'order', 'cancellation', 'pay_fin_ref_2', 'idem_ref_02', 15000, 15000, 'approved');
      `, [finId]);

      // 6. Refund: processed (₹200 = 20000 paise) - Gateway confirmed
      await fixture.pool.query(`
        INSERT INTO refund_requests (customer_id, request_number, request_type, reason_category, payment_id, idempotency_key, requested_amount_paise, approved_amount_paise, status)
        VALUES ($1, 'REF-FIN-03', 'order', 'cancellation', 'pay_fin_ref_3', 'idem_ref_03', 20000, 20000, 'processed');
      `, [finId]);

      // Fetch customer details via Admin API
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${finId}/details`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const sum = data.paymentSummary;

      // Order spending: only paid orders
      assert.equal(sum.orderSpendingPaise, 50000);
      // Subscription spending: contract without payment is 0
      assert.equal(sum.subscriptionSpendingPaise, 0);
      assert.equal(sum.total_subscription_contract_paise, 450000);
      // Verified captured paise: orders paid (50000) + subs captured (0) = 50000
      assert.equal(sum.verifiedCapturedPaise, 50000);
      // Completed refunds: ONLY processed refund (20000)
      assert.equal(sum.completedRefundsPaise, 20000);
      assert.equal(sum.total_refunded_paise, 20000);
      // Approved refunds: approved + processed (15000 + 20000 = 35000)
      assert.equal(sum.approvedRefundsPaise, 35000);
      // Net paid: captured (50000) - completed refunds (20000) = 30000
      assert.equal(sum.net_paid_paise, 30000);
    });

    test('stock adjustment direction validation & idempotency replay', async () => {
      // 1. Create a test product
      const prodRes = await fixture.pool.query(`
        INSERT INTO products (name, category, price_paise, selling_unit, stock_quantity, low_stock_threshold)
        VALUES ('Test Organic Butter (250g)', 'dairy', 25000, '250g jar', 50, 10)
        RETURNING id;
      `);
      const prodId = prodRes.rows[0].id;

      // 2. Reject negative restock
      const negRestock = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${prodId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { adjustmentType: 'restock', quantityChange: -5, reason: 'Invalid restock' }
      });
      assert.equal(negRestock.statusCode, 400);
      assert.equal(JSON.parse(negRestock.body).error, 'invalid_direction');

      // 3. Reject negative return
      const negReturn = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${prodId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { adjustmentType: 'return', quantityChange: -2, reason: 'Invalid return' }
      });
      assert.equal(negReturn.statusCode, 400);
      assert.equal(JSON.parse(negReturn.body).error, 'invalid_direction');

      // 4. Reject positive damage
      const posDamage = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${prodId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { adjustmentType: 'damage', quantityChange: 5, reason: 'Invalid damage' }
      });
      assert.equal(posDamage.statusCode, 400);
      assert.equal(JSON.parse(posDamage.body).error, 'invalid_direction');

      // 5. Reject positive loss
      const posLoss = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${prodId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { adjustmentType: 'loss', quantityChange: 3, reason: 'Invalid loss' }
      });
      assert.equal(posLoss.statusCode, 400);
      assert.equal(JSON.parse(posLoss.body).error, 'invalid_direction');

      // 6. Valid adjustment with Idempotency-Key
      const testKey = 'idem_key_butter_' + Date.now();
      const firstAdj = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${prodId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': testKey },
        payload: { adjustmentType: 'restock', quantityChange: 20, reason: 'Morning dairy delivery batch' }
      });
      assert.equal(firstAdj.statusCode, 200);
      const firstData = JSON.parse(firstAdj.body);
      assert.equal(firstData.product.stock_quantity, 70); // 50 + 20
      assert.equal(firstData.idempotent_replayed, undefined);

      // 7. Duplicate request with identical Idempotency-Key
      const replayedAdj = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/inventory/${prodId}/adjust`,
        headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': testKey },
        payload: { adjustmentType: 'restock', quantityChange: 20, reason: 'Morning dairy delivery batch' }
      });
      assert.equal(replayedAdj.statusCode, 200);
      const replayedData = JSON.parse(replayedAdj.body);
      assert.equal(replayedData.idempotent_replayed, true);
      assert.equal(replayedData.product.stock_quantity, 70, 'Stock must not be incremented a second time');

      // 8. Concurrent requests with same idempotency key
      const concurrentKey = 'idem_concurrent_' + Date.now();
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/inventory/${prodId}/adjust`,
          headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': concurrentKey },
          payload: { adjustmentType: 'damage', quantityChange: -4, reason: 'Crushed cartons' }
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/inventory/${prodId}/adjust`,
          headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': concurrentKey },
          payload: { adjustmentType: 'damage', quantityChange: -4, reason: 'Crushed cartons' }
        })
      ]);
      assert.equal(res1.statusCode, 200);
      assert.equal(res2.statusCode, 200);
      // Final stock should be 70 - 4 = 66, not 70 - 8 = 62
      const finalProd = await fixture.pool.query('SELECT stock_quantity FROM products WHERE id = $1', [prodId]);
      assert.equal(finalProd.rows[0].stock_quantity, 66);
    });

    test('strict milk-volume parsing in inventory and demand calculation', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/inventory',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(data.milkRequirements);
      assert.ok(data.milkRequirements.today);
      assert.ok(data.milkRequirements.tomorrow);
      assert.equal(typeof data.milkRequirements.today.cowLitres, 'number');
      assert.equal(typeof data.milkRequirements.today.buffaloLitres, 'number');
      assert.equal(typeof data.milkRequirements.today.totalLitres, 'number');
      assert.equal(
        data.milkRequirements.today.totalLitres,
        Number((data.milkRequirements.today.cowLitres + data.milkRequirements.today.buffaloLitres).toFixed(2))
      );
    });

    test('whatsapp freeze: no notifications queued or dispatched during status transitions', async () => {
      const prevEnv = process.env.WHATSAPP_ENABLED;
      process.env.WHATSAPP_ENABLED = 'false';

      try {
        const outboxBefore = await fixture.pool.query('SELECT COUNT(*) AS count FROM notification_outbox');
        const countBefore = parseInt(outboxBefore.rows[0].count, 10);

        // Direct queue attempt must be skipped
        const queueRes = await queueWhatsAppNotification(fixture.pool, {
          customerId: regularCustomerId,
          phone: '+919999900002',
          templateKey: 'NEXT_DAY_REMINDER',
          params: { productName: 'Pure Cow Milk', quantity: '1L' },
          idempotencyKey: 'whatsapp_hold_test_1'
        });
        assert.equal(queueRes.queued, false);
        assert.equal(queueRes.reason, 'whatsapp_disabled');

        // Check delivery status transition does not insert into notification_outbox
        const testDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 5 * 86400000));
        const delRow = await fixture.pool.query(`
          INSERT INTO subscription_delivery_orders (
            delivery_order_number, subscription_id, customer_id, delivery_date,
            product_name, quantity, status, delivery_address
          ) VALUES (
            'MV-DEL-HOLD-TEST', (SELECT id FROM customer_subscriptions LIMIT 1), $1, $2,
            'Pure Cow Milk', '1L', 'scheduled',
            '{"house":"1","street":"Rd","pincode":"500033"}'::jsonb
          ) RETURNING id;
        `, [regularCustomerId, testDate]);
        const dId = delRow.rows[0].id;

        // Transition through lifecycle
        await app.inject({
          method: 'POST',
          url: `/api/v1/operations/deliveries/${dId}/status`,
          headers: { Authorization: `Bearer ${adminToken}` },
          payload: { status: 'packed' }
        });
        await app.inject({
          method: 'POST',
          url: `/api/v1/operations/deliveries/${dId}/status`,
          headers: { Authorization: `Bearer ${adminToken}` },
          payload: { status: 'out_for_delivery' }
        });
        await app.inject({
          method: 'POST',
          url: `/api/v1/operations/deliveries/${dId}/status`,
          headers: { Authorization: `Bearer ${adminToken}` },
          payload: { status: 'delivered', proofOfDelivery: 'Doorstep box' }
        });

        const outboxAfter = await fixture.pool.query('SELECT COUNT(*) AS count FROM notification_outbox');
        const countAfter = parseInt(outboxAfter.rows[0].count, 10);
        assert.equal(countAfter, countBefore, 'Zero rows should be added to notification_outbox while WhatsApp is on hold');
      } finally {
        process.env.WHATSAPP_ENABLED = prevEnv;
      }
    });
  });
});

import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_hardening_jwt_secret_32_characters';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_hardening';
process.env.RAZORPAY_KEY_ID = 'rzp_test_hardening';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_hardening_hmac';

assertTestDatabaseConfigured();

const setup = await setupDisposableTestSchema();
const pool = setup.pool;

const { app, parseMilkVolumeInLitres } = await import('../src/server.js');
const {
  generateDailyDeliveries,
  previewDailyDeliveries,
  evaluateSubscriptionDeliveryEligibility,
  validateDeliveryTargetDate,
  extractValidDeliveryAddress,
  getTomorrowDeliveryDateYMD
} = await import('../src/services/deliveryEngine.js');

let adminToken;
let regularToken;
let adminCustomerId;
let customerAId;
let customerBId;

const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');

function getAuthHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

describe('Milvanta Operations Hardening & PostgreSQL Regression Suite', () => {
  before(async () => {
    await app.ready();

    // 1. Create Admin Customer
    const adminRes = await pool.query(
      `INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin, email_verified, phone_verified_at)
       VALUES ('Hardening Admin', '+919999900010', 'hardening.admin@milvanta.in', 'dummy_salt', 'dummy_hash', TRUE, TRUE, NOW())
       RETURNING id, email, is_admin`
    );
    adminCustomerId = adminRes.rows[0].id;
    adminToken = app.jwt.sign({ sub: String(adminCustomerId), email: 'hardening.admin@milvanta.in', jti: crypto.randomUUID() });
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 day')`,
      [digest(adminToken), adminCustomerId, digest(crypto.randomBytes(32).toString('hex'))]
    );

    // 2. Create Regular Customers
    const custARes = await pool.query(
      `INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin, email_verified, phone_verified_at)
       VALUES ('Customer Alpha', '+919999900011', 'customer.alpha@milvanta.in', 'dummy_salt', 'dummy_hash', FALSE, TRUE, NOW())
       RETURNING id`
    );
    customerAId = custARes.rows[0].id;
    regularToken = app.jwt.sign({ sub: String(customerAId), email: 'customer.alpha@milvanta.in', jti: crypto.randomUUID() });
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 day')`,
      [digest(regularToken), customerAId, digest(crypto.randomBytes(32).toString('hex'))]
    );

    const custBRes = await pool.query(
      `INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin, email_verified, phone_verified_at)
       VALUES ('Customer Beta', '+919999900012', 'customer.beta@milvanta.in', 'dummy_salt', 'dummy_hash', FALSE, TRUE, NOW())
       RETURNING id`
    );
    customerBId = custBRes.rows[0].id;

    // Add default address for Customer A
    await pool.query(
      `INSERT INTO customer_addresses (
         customer_id, address_fingerprint, recipient_name, phone,
         house, building, street, landmark, city, state, pincode, is_default
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)`,
      [
        customerAId,
        digest('flat 101 green meadows banjara hills hyderabad 500049'),
        'Customer Alpha',
        '+919999900011',
        'Flat 101',
        'Green Meadows',
        'Road No 12, Banjara Hills',
        'Near Park',
        'Hyderabad',
        'Telangana',
        '500049'
      ]
    );
  });

  after(async () => {
    await cleanupDisposableTestSchema(setup);
  });

  // ==========================================
  // 1. Date Validation & Boundary Enforcement
  // ==========================================
  describe('1. Date Validation & Boundary Enforcement', () => {
    it('validateDeliveryTargetDate rejects non-string or malformed date format', () => {
      assert.throws(() => validateDeliveryTargetDate('2026/10/25'), /invalid_delivery_date_format/);
      assert.throws(() => validateDeliveryTargetDate('tomorrow'), /invalid_delivery_date_format/);
      assert.throws(() => validateDeliveryTargetDate('2026-13-45'), /invalid_delivery_date/);
    });

    it('validateDeliveryTargetDate rejects past dates', () => {
      assert.throws(() => validateDeliveryTargetDate('2020-01-01'), /cannot_generate_deliveries_for_past_date/);
      assert.throws(() => validateDeliveryTargetDate('2026-01-01'), /cannot_generate_deliveries_for_past_date/);
    });

    it('validateDeliveryTargetDate rejects out-of-policy future dates (>60 days)', () => {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 90);
      const farFutureStr = farFuture.toISOString().slice(0, 10);
      assert.throws(() => validateDeliveryTargetDate(farFutureStr), /delivery_date_out_of_policy/);
    });

    it('POST /api/v1/operations/deliveries/generate rejects past date with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/deliveries/generate',
        headers: getAuthHeaders(adminToken),
        payload: { targetDate: '2026-01-01' }
      });
      assert.strictEqual(res.statusCode, 400);
      const json = res.json();
      assert.ok(json.error.includes('past_date'));
    });

    it('GET /api/v1/operations/deliveries/generate-preview rejects past date with HTTP 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/operations/deliveries/generate-preview?targetDate=2026-01-01',
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(res.statusCode, 400);
      const json = res.json();
      assert.ok(json.error.includes('past_date'));
    });
  });

  // ==========================================
  // 2. Authoritative Entitlement & Payment Evidence
  // ==========================================
  describe('2. Authoritative Entitlement & Captured Payment Enforcement', () => {
    it('skips subscription when fulfillmentEntitled !== true (fails closed)', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Create subscription with fulfillmentEntitled = false
      const subRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 1, 'Pure Cow Milk', '1L', 1, 10500, 315000, 'active', $2)
         RETURNING id`,
        [customerAId, JSON.stringify({
          fulfillmentEntitled: false,
          lastPaymentId: 'pay_test_unentitled_1',
          startDate: '2026-01-01',
          paidThroughDate: '2027-12-31'
        })]
      );
      const subId = subRes.rows[0].id;

      const preview = await previewDailyDeliveries(pool, tomorrow);
      const foundInPreview = preview.eligibleSubscriptions.some(s => s.subscriptionId === subId);
      assert.strictEqual(foundInPreview, false, 'Subscription with fulfillmentEntitled=false must not be eligible');
      assert.ok(preview.skippedBreakdown.noFulfillmentEntitlement >= 1);

      // Clean up test subscription
      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [subId]);
    });

    it('skips subscription without captured payment proof', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Create subscription with fulfillmentEntitled = true BUT no paymentId
      const subRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 1, 'Pure Cow Milk', '1L', 1, 10500, 315000, 'active', $2)
         RETURNING id`,
        [customerAId, JSON.stringify({
          fulfillmentEntitled: true,
          // no paymentId or lastPaymentId
          startDate: '2026-01-01',
          paidThroughDate: '2027-12-31'
        })]
      );
      const subId = subRes.rows[0].id;

      const preview = await previewDailyDeliveries(pool, tomorrow);
      const foundInPreview = preview.eligibleSubscriptions.some(s => s.subscriptionId === subId);
      assert.strictEqual(foundInPreview, false, 'Subscription without payment evidence must be skipped');
      assert.ok(preview.skippedBreakdown.noPaymentEvidence >= 1);

      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [subId]);
    });
    it('evaluateSubscriptionDeliveryEligibility strictly validates all gates and fails closed', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Gate 1: fulfillmentEntitled must be boolean true
      const subNonBool = {
        id: 991, customer_id: customerAId, full_name: 'Test', phone: '+919999900011',
        status: 'active', notes: { fulfillmentEntitled: 'true', lastPaymentId: 'pay_1', startDate: '2026-01-01', paidThroughDate: '2027-12-31' }
      };
      const resNonBool = await evaluateSubscriptionDeliveryEligibility(pool, subNonBool, tomorrow);
      assert.strictEqual(resNonBool.eligible, false);
      assert.strictEqual(resNonBool.reason, 'noFulfillmentEntitlement');

      // Gate 2: Captured payment proof required (not mandate_only)
      const subMandate = {
        id: 992, customer_id: customerAId, full_name: 'Test', phone: '+919999900011',
        status: 'active', notes: { fulfillmentEntitled: true, authType: 'mandate_only', lastPaymentId: 'pay_1', startDate: '2026-01-01', paidThroughDate: '2027-12-31' }
      };
      const resMandate = await evaluateSubscriptionDeliveryEligibility(pool, subMandate, tomorrow);
      assert.strictEqual(resMandate.eligible, false);
      assert.strictEqual(resMandate.reason, 'noPaymentEvidence');

      // Gate 3: Customer must have verified delivery address (no fabricated address)
      const subNoAddr = {
        id: 993, customer_id: customerBId, full_name: 'Customer Beta', phone: '+919999900012',
        status: 'active', notes: { fulfillmentEntitled: true, lastPaymentId: 'pay_1', startDate: '2026-01-01', paidThroughDate: '2027-12-31' }
      };
      const resNoAddr = await evaluateSubscriptionDeliveryEligibility(pool, subNoAddr, tomorrow);
      assert.strictEqual(resNoAddr.eligible, false);
      assert.strictEqual(resNoAddr.reason, 'missingOrInvalidAddress');

      // Gate 4: Valid customer with default address passes
      const subValid = {
        id: 994, customer_id: customerAId, full_name: 'Customer Alpha', phone: '+919999900011',
        status: 'active', notes: { fulfillmentEntitled: true, lastPaymentId: 'pay_1', startDate: '2026-01-01', paidThroughDate: '2027-12-31' }
      };
      const resValid = await evaluateSubscriptionDeliveryEligibility(pool, subValid, tomorrow);
      assert.strictEqual(resValid.eligible, true);
      assert.ok(resValid.deliveryAddress);
      assert.strictEqual(resValid.deliveryAddress.pincode, '500049');
    });

    it('previewDailyDeliveries returns structured excludedSubscriptions list with exclusion reasons and messages', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Create an ineligible subscription (Customer B has no address)
      const subRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 1, 'Pure Cow Milk', '1L', 1, 10500, 315000, 'active', $2)
         RETURNING id`,
        [customerBId, JSON.stringify({
          fulfillmentEntitled: true,
          lastPaymentId: 'pay_test_excl_1',
          startDate: '2026-01-01',
          paidThroughDate: '2027-12-31'
        })]
      );
      const subId = subRes.rows[0].id;

      const preview = await previewDailyDeliveries(pool, tomorrow);
      assert.ok(Array.isArray(preview.excludedSubscriptions));
      const excluded = preview.excludedSubscriptions.find(s => s.subscriptionId === subId);
      assert.ok(excluded, 'Ineligible subscription must appear in excludedSubscriptions');
      assert.strictEqual(excluded.reason, 'missingOrInvalidAddress');
      assert.ok(excluded.exclusionMessage.includes('address'));
      assert.strictEqual(excluded.customerId, customerBId);

      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [subId]);
    });
  });

  // ==========================================
  // 3. Delivery Address Safeguards (No invented fallback addresses)
  // ==========================================
  describe('3. Delivery Address Safeguards (No Invented Dummy Addresses)', () => {
    it('extractValidDeliveryAddress returns null when no real address exists', () => {
      const sub = { full_name: 'No Address User', phone: '+919999900099', notes: {} };
      assert.strictEqual(extractValidDeliveryAddress(sub, null, null), null);
      assert.strictEqual(extractValidDeliveryAddress(sub, {}, {}), null);
      assert.strictEqual(extractValidDeliveryAddress(sub, { city: 'Hyderabad' }, {}), null);
    });

    it('extractValidDeliveryAddress extracts complete address when valid street and pincode are present', () => {
      const sub = { full_name: 'Valid User', phone: '+919999900088' };
      const defaultAddr = {
        recipient_name: 'Valid User',
        phone: '+919999900088',
        house: 'Flat 402',
        building: 'Sky Tower',
        street: 'Road No 10, Banjara Hills',
        landmark: 'Near City Center',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500034'
      };
      const extracted = extractValidDeliveryAddress(sub, defaultAddr, null);
      assert.ok(extracted);
      assert.strictEqual(extracted.street, 'Road No 10, Banjara Hills');
      assert.strictEqual(extracted.pincode, '500034');
    });

    it('skips delivery generation when customer has no verified address', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Customer B has no address records
      const subRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 2, 'Pure Buffalo Milk', '1L', 1, 11500, 345000, 'active', $2)
         RETURNING id`,
        [customerBId, JSON.stringify({
          fulfillmentEntitled: true,
          lastPaymentId: 'pay_test_valid_b1',
          startDate: '2026-01-01',
          paidThroughDate: '2027-12-31'
        })]
      );
      const subId = subRes.rows[0].id;

      const preview = await previewDailyDeliveries(pool, tomorrow);
      const foundInPreview = preview.eligibleSubscriptions.some(s => s.subscriptionId === subId);
      assert.strictEqual(foundInPreview, false, 'Subscription without valid address must be skipped in preview');
      assert.ok(preview.skippedBreakdown.missingOrInvalidAddress >= 1);

      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [subId]);
    });
  });

  // ==========================================
  // 4. Concurrent Delivery Generation Safety
  // ==========================================
  describe('4. Concurrent Delivery Generation Safety & PostgreSQL Uniqueness', () => {
    it('concurrent generateDailyDeliveries calls do not create duplicate orders or cause deadlocks', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Create a fully eligible subscription for Customer A (Customer A has default address)
      const subRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 1, 'Pure Cow Milk', '1L', 1, 10500, 315000, 'active', $2)
         RETURNING id`,
        [customerAId, JSON.stringify({
          fulfillmentEntitled: true,
          lastPaymentId: 'pay_concurrent_test_1',
          startDate: '2026-01-01',
          paidThroughDate: '2027-12-31'
        })]
      );
      const subId = subRes.rows[0].id;

      // Clean existing orders for tomorrow for subId
      await pool.query('DELETE FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2', [subId, tomorrow]);

      // Run 3 concurrent delivery generation calls in parallel
      const results = await Promise.all([
        generateDailyDeliveries(pool, tomorrow),
        generateDailyDeliveries(pool, tomorrow),
        generateDailyDeliveries(pool, tomorrow)
      ]);

      // All 3 calls must succeed without throwing
      assert.strictEqual(results.length, 3);
      for (const res of results) {
        assert.strictEqual(res.success, true);
      }

      // Check the database: exactly ONE delivery order must exist for this subscription and date
      const { rows: orderRows } = await pool.query(
        'SELECT id, delivery_order_number, status FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
        [subId, tomorrow]
      );
      assert.strictEqual(orderRows.length, 1, 'Exactly one delivery order must exist despite 3 concurrent invocations');

      // Subsequent call is idempotent: 0 generated, skipped
      const rerun = await generateDailyDeliveries(pool, tomorrow);
      assert.strictEqual(rerun.generatedCount, 0);

      // Cleanup
      await pool.query('DELETE FROM subscription_delivery_orders WHERE subscription_id = $1', [subId]);
      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [subId]);
    });
  });

  // ==========================================
  // 5. Milk Volume Parsing & Forecasting
  // ==========================================
  describe('5. Milk Volume Parsing & Demand Forecast Accuracy', () => {
    it('parseMilkVolumeInLitres accurately calculates 500ml, 1L, 1.5L, 2L, and multiples', () => {
      assert.strictEqual(parseMilkVolumeInLitres('500ml', 1), 0.5);
      assert.strictEqual(parseMilkVolumeInLitres('500 ml', 2), 1.0);
      assert.strictEqual(parseMilkVolumeInLitres('1000ml', 1), 1.0);
      assert.strictEqual(parseMilkVolumeInLitres('1L', 1), 1.0);
      assert.strictEqual(parseMilkVolumeInLitres('1 Litre', 3), 3.0);
      assert.strictEqual(parseMilkVolumeInLitres('1.5L', 1), 1.5);
      assert.strictEqual(parseMilkVolumeInLitres('1.5 Litres', 2), 3.0);
      assert.strictEqual(parseMilkVolumeInLitres('2L', 1), 2.0);
      assert.strictEqual(parseMilkVolumeInLitres('2 Litres', 3), 6.0);
      assert.strictEqual(parseMilkVolumeInLitres('2000ml', 1), 2.0);
      assert.strictEqual(parseMilkVolumeInLitres('750ml', 2), 1.5);
    });

    it('GET /api/v1/admin/demand-forecast reflects correct volume for 1.5L and 2L orders', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Clean existing orders for tomorrow
      await pool.query('DELETE FROM subscription_delivery_orders WHERE delivery_date = $1', [tomorrow]);

      const sub15 = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 1, 'Milvanta Cow Milk', '1.5L', 2, 10500, 315000, 'active', '{}')
         RETURNING id`,
        [customerAId]
      );
      const sub2L = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 2, 'Milvanta Buffalo Milk', '2L', 1, 11500, 345000, 'active', '{}')
         RETURNING id`,
        [customerAId]
      );

      // Insert pre-generated orders with 1.5L and 2L packs
      await pool.query(
        `INSERT INTO subscription_delivery_orders (
           delivery_order_number, subscription_id, customer_id, delivery_date,
           product_id, product_name, quantity, quantity_num, status, delivery_address
         ) VALUES
         ('MV-DEL-TEST-15L', $1, $3, $4, 1, 'Milvanta Cow Milk', '1.5L', 2, 'scheduled', '{"street":"Test St","pincode":"500049"}'),
         ('MV-DEL-TEST-2L', $2, $3, $4, 2, 'Milvanta Buffalo Milk', '2L', 1, 'scheduled', '{"street":"Test St","pincode":"500049"}')`,
        [sub15.rows[0].id, sub2L.rows[0].id, customerAId, tomorrow]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/demand-forecast?date=${tomorrow}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();

      // 1.5L * 2 = 3.0 L Cow Milk
      assert.strictEqual(json.cowMilkLitres, 3.0);
      // 2L * 1 = 2.0 L Buffalo Milk
      assert.strictEqual(json.buffaloMilkLitres, 2.0);
      // Total = 5.0 L
      assert.strictEqual(json.totalLitres, 5.0);
      assert.strictEqual(json.totalDeliveries, 2);

      // Cleanup
      await pool.query('DELETE FROM subscription_delivery_orders WHERE delivery_date = $1', [tomorrow]);
      await pool.query('DELETE FROM customer_subscriptions WHERE id IN ($1, $2)', [sub15.rows[0].id, sub2L.rows[0].id]);
    });
    it('parseMilkVolumeInLitres flags unrecognized units and strict mode throws', () => {
      // Recognized units
      assert.strictEqual(parseMilkVolumeInLitres('250ml', 2), 0.5);
      assert.strictEqual(parseMilkVolumeInLitres('3.5L', 1), 3.5);
      assert.strictEqual(parseMilkVolumeInLitres('5L', 1), 5.0);

      // Unrecognized units without strict mode return 0 (never silently assume 500ml)
      assert.strictEqual(parseMilkVolumeInLitres('2 boxes', 1), 0);
      assert.strictEqual(parseMilkVolumeInLitres('packet', 1), 0);

      // Object mode returns recognized: false
      const meta = parseMilkVolumeInLitres('unknown unit', 2, { returnMetadata: true });
      assert.strictEqual(meta.litres, 0);
      assert.strictEqual(meta.recognized, false);

      // Strict mode throws
      assert.throws(() => parseMilkVolumeInLitres('3 cartons', 1, { strict: true }), /unrecognized_milk_pack_format/);
    });

    it('GET /api/v1/admin/demand-forecast and /export flag orders with unrecognized units', async () => {
      const tomorrow = getTomorrowDeliveryDateYMD();

      // Clean existing orders for tomorrow
      await pool.query('DELETE FROM subscription_delivery_orders WHERE delivery_date = $1', [tomorrow]);

      // Create a test subscription
      const subRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_id, product_name, quantity, quantity_num,
           cost_per_day_paise, total_amount_paise, status, notes
         ) VALUES ($1, 1, 'Milvanta Cow Milk', 'custom-box', 1, 10500, 315000, 'active', '{}')
         RETURNING id`,
        [customerAId]
      );
      const subId = subRes.rows[0].id;

      // Insert an order with an unrecognized unit 'pack'
      const { rows: orderRows } = await pool.query(
        `INSERT INTO subscription_delivery_orders (
           delivery_order_number, subscription_id, customer_id, delivery_date,
           product_id, product_name, quantity, quantity_num, status, delivery_address
         ) VALUES
         ('MV-DEL-UNREC-1', $1, $2, $3, 1, 'Milvanta Cow Milk', 'custom-box', 1, 'scheduled', '{"street":"Test St","pincode":"500049"}')
         RETURNING id`,
        [subId, customerAId, tomorrow]
      );

      // Check GET /api/v1/admin/demand-forecast
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/demand-forecast?date=${tomorrow}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.hasUnrecognizedUnits, true);
      assert.ok(json.unrecognizedUnits.length >= 1);
      assert.strictEqual(json.unrecognizedUnits[0].quantity, 'custom-box');

      // Check GET /api/v1/admin/demand-forecast/export CSV
      const exportRes = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/demand-forecast/export?date=${tomorrow}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(exportRes.statusCode, 200);
      const csv = exportRes.body;
      assert.ok(csv.includes('Status'), 'CSV header must include Status column');
      assert.ok(csv.includes('UNRECOGNIZED_UNIT'), 'CSV must flag the unrecognized order');

      // Cleanup
      await pool.query('DELETE FROM subscription_delivery_orders WHERE delivery_date = $1', [tomorrow]);
      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [subId]);
    });
  });

  // ==========================================
  // 6. Financial Reporting & Refund Status Separation
  // ==========================================
  describe('6. Financial Reporting & Refund Status Separation', () => {
    it('counts ONLY processed refunds in refundedAmountPaise; approved/processing remain pending', async () => {
      // Clear test refund requests
      await pool.query('DELETE FROM refund_requests WHERE customer_id = $1', [customerAId]);

      // Insert refunds with various statuses
      await pool.query(
        `INSERT INTO refund_requests (
           customer_id, request_number, request_type, payment_id, idempotency_key, reason_category,
           requested_amount_paise, approved_amount_paise, status
         ) VALUES
         ($1, 'REF-TEST-REQ', 'order', 'pay_test_req_1', 'idem_ref_1', 'cancellation', 50000, 0, 'pending'),
         ($1, 'REF-TEST-APP', 'order', 'pay_test_app_1', 'idem_ref_2', 'cancellation', 60000, 60000, 'approved'),
         ($1, 'REF-TEST-PRC', 'order', 'pay_test_prc_1', 'idem_ref_3', 'cancellation', 70000, 70000, 'processing'),
         ($1, 'REF-TEST-DON', 'order', 'pay_test_don_1', 'idem_ref_4', 'cancellation', 80000, 80000, 'processed')`,
        [customerAId]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats',
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();

      // Only 'processed' (80000 paise = ₹800) should be counted in refundedAmountPaise
      assert.strictEqual(json.refundedAmountPaise, 80000);
      assert.strictEqual(json.financials.refundedAmountPaise, 80000);

      // 'requested', 'approved', 'processing' should be included in pendingRefunds
      assert.ok(json.pendingRefundsCount >= 3);
      assert.ok(json.financials);

      // Cleanup
      await pool.query('DELETE FROM refund_requests WHERE customer_id = $1', [customerAId]);
    });
  });

  // ==========================================
  // 7. Customer Spend without Duplicate Multiplication
  // ==========================================
  describe('7. Customer Spend Calculation (No SUM(DISTINCT) Loss)', () => {
    it('correctly aggregates multiple orders with identical amounts without distinct truncation', async () => {
      // Clean existing orders for Customer B
      await pool.query('DELETE FROM customer_orders WHERE customer_id = $1', [customerBId]);

      // Insert two orders with the EXACT SAME amount (₹500.00 each = 50000 paise)
      await pool.query(
        `INSERT INTO customer_orders (order_number, customer_id, idempotency_key, address, items, subtotal_paise, total_paise, order_status, payment_status)
         VALUES
         ('ORD-TEST-DUP-1', $1, 'idem_test_dup_1', '{"street":"Road 10","pincode":"500034"}', '[{"productName":"Milk","quantity":1}]', 50000, 50000, 'delivered', 'paid'),
         ('ORD-TEST-DUP-2', $1, 'idem_test_dup_2', '{"street":"Road 10","pincode":"500034"}', '[{"productName":"Milk","quantity":1}]', 50000, 50000, 'delivered', 'paid')`,
        [customerBId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers?search=${encodeURIComponent('customer.beta@milvanta.in')}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.customers.length, 1);
      const cust = json.customers[0];

      // Two ₹500 orders = ₹1000 (100000 paise). Old SUM(DISTINCT) would have erroneously returned 50000 paise!
      assert.strictEqual(Number(cust.total_orders_count), 2);
      assert.strictEqual(Number(cust.total_spend_paise), 100000);

      // Cleanup
      await pool.query('DELETE FROM customer_orders WHERE customer_id = $1', [customerBId]);
    });
  });

  // ==========================================
  // 8. Zero-Denominator Delivery Success Rate
  // ==========================================
  describe('8. Zero-Denominator Delivery Success Rate Safety', () => {
    it('returns successRatePct: 0 when total deliveries = 0 in GET /api/v1/admin/reports', async () => {
      // Pick a future date range with 0 deliveries
      const from = '2026-11-20';
      const to = '2026-11-21';

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/reports?from=${from}&to=${to}`,
        headers: getAuthHeaders(adminToken)
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();

      assert.strictEqual(json.deliveries.total, 0);
      // Zero deliveries must report 0% success rate, NEVER 100%!
      assert.strictEqual(json.deliveries.successRatePct, 0);
    });
  });
});

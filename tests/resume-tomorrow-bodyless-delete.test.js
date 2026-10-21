/**
 * MILVANTA — Bodyless DELETE & Hardened Content-Type Parser Regression Suite
 * 
 * Tests the fix for "Unexpected end of JSON input" on bodyless DELETE requests:
 * 1. Bodyless DELETE with no Content-Type
 * 2. Bodyless DELETE with application/json
 * 3. Valid JSON POST
 * 4. Malformed nonempty JSON returns 400 (never 500, never silently accepted)
 * 5. Skip -> Resume restores delivery and creates exactly 1 positive and 1 negative billing adjustment
 * 6. Existing Razorpay webhook raw-body signature verification
 * 7. Frontend apiRequest() header construction verification
 */

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
import fs from 'fs';
import path from 'path';

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_bodyless_delete_test_secret_32_chars_minimum';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_bodyless';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_milvanta_bodyless_hmac';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_key_milvanta_secure';

assertTestDatabaseConfigured();

const setup = await setupDisposableTestSchema();
const pool = setup.pool;
const schemaName = setup.schemaName;

const { app } = await import('../src/server.js');
const { formatDateYMD } = await import('../src/services/subscriptionService.js');

describe('Milvanta — Bodyless DELETE & Hardened Content-Type Parser Suite', () => {
  let customerId;
  let customerToken;
  let subscriptionId;
  let testAddressId;

  const testEmail = `test_bodyless_${Date.now()}@milvanta.in`;
  const testPhone = '9' + Math.floor(100000000 + Math.random() * 900000000);

  // Compute test date for tomorrow in IST
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const testDeliveryDate = formatDateYMD(d);

  before(async () => {
    console.log(`[Test DB Isolation] Connected to '${setup.connectedDb}' on port ${setup.serverPort}, schema: '${schemaName}'`);

    // 1. Seed Customer
    const custRes = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash)
       VALUES ('Bodyless Test User', $1, $2, 'salt', 'hash')
       RETURNING id`,
      [testEmail, testPhone]
    );
    customerId = custRes.rows[0].id;
    customerToken = app.jwt.sign({ sub: String(customerId), email: testEmail });
    const tokenHash = crypto.createHash('sha256').update(customerToken).digest('hex');
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, 'csrf_mock', NOW() + INTERVAL '1 day')`,
      [tokenHash, customerId]
    );

    // 2. Seed Customer Address
    const addrRes = await pool.query(
      `INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
       VALUES ($1, 'fp_test_delete_1', 'Bodyless Test User', $2, 'Plot 10', 'Milvanta Enclave', 'Jubilee Hills Road 36', 'Near Hub', 'Hyderabad', 'Telangana', '500081', true)
       RETURNING id`,
      [customerId, testPhone]
    );
    testAddressId = addrRes.rows[0].id;

    // 3. Seed Paid, Active Customer Subscription
    const subRes = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, plan_type, product_id, product_name, quantity, cost_per_day_paise, total_amount_paise,
         status, notes, created_at, updated_at
       ) VALUES (
         $1, 'daily', 1, 'Buffalo Milk', '1 Litre', 9000, 270000,
         'active', $2::jsonb, NOW(), NOW()
       ) RETURNING id`,
      [
        customerId,
        JSON.stringify({
          fulfillmentEntitled: true,
          paidThroughDate: '2026-12-31',
          startDate: '2026-10-01',
          paidCount: 1,
          months: 1
        })
      ]
    );
    subscriptionId = subRes.rows[0].id;

    // 4. Seed Scheduled Delivery Order for Tomorrow
    await pool.query(
      `INSERT INTO subscription_delivery_orders (
         delivery_order_number, subscription_id, customer_id, delivery_date,
         product_id, product_name, quantity, quantity_num, status, delivery_address, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, 1, 'Buffalo Milk', '1 Litre', 1, 'scheduled', '{}'::jsonb, NOW(), NOW()
       )`,
      [
        `DEL-TEST-${Date.now()}`,
        subscriptionId,
        customerId,
        testDeliveryDate
      ]
    );
  });

  after(async () => {
    if (setup) {
      await cleanupDisposableTestSchema(setup);
    }
  });

  // =========================================================================
  // TASK 1: Bodyless DELETE with No Content-Type
  // =========================================================================
  describe('1. Bodyless DELETE with No Content-Type', () => {
    it('executes DELETE /api/v1/subscriptions/:id/skip-date cleanly without Content-Type header', async () => {
      // First skip the date so we have a skip to delete
      await pool.query(
        `INSERT INTO subscription_skipped_dates (subscription_id, customer_id, skip_date, reason)
         VALUES ($1, $2, $3, 'Pre-test skip')
         ON CONFLICT (subscription_id, skip_date) DO NOTHING`,
        [subscriptionId, customerId, testDeliveryDate]
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date?skipDate=${testDeliveryDate}`,
        headers: {
          Authorization: `Bearer ${customerToken}`
          // No content-type header sent!
        }
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.success, true);
      assert.equal(data.alreadyUnskipped, false);
    });

    it('executes DELETE /api/v1/addresses/:id cleanly without Content-Type header', async () => {
      // Create a temporary secondary address to delete
      const secondaryAddr = await pool.query(
        `INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
         VALUES ($1, 'fp_test_delete_2', 'Secondary Recipient', $2, 'Plot 11', 'Tower B', 'Banjara Hills', 'Landmark', 'Hyderabad', 'Telangana', '500034', false)
         RETURNING id`,
        [customerId, testPhone]
      );
      const addrIdToDelete = secondaryAddr.rows[0].id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/addresses/${addrIdToDelete}`,
        headers: {
          Authorization: `Bearer ${customerToken}`
          // No content-type header sent!
        }
      });

      assert.equal(res.statusCode, 200);
    });
  });

  // =========================================================================
  // TASK 2: Bodyless DELETE with application/json
  // =========================================================================
  describe('2. Bodyless DELETE with application/json', () => {
    it('executes DELETE /api/v1/subscriptions/:id/skip-date safely when Content-Type: application/json is sent with empty body', async () => {
      // First re-skip the date
      await pool.query(
        `INSERT INTO subscription_skipped_dates (subscription_id, customer_id, skip_date, reason)
         VALUES ($1, $2, $3, 'Test skip for empty json delete')
         ON CONFLICT (subscription_id, skip_date) DO NOTHING`,
        [subscriptionId, customerId, testDeliveryDate]
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date?skipDate=${testDeliveryDate}`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        }
        // No payload (body is empty)
      });

      // Must succeed with 200, NEVER throw SyntaxError / 500!
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.success, true);
      assert.equal(data.alreadyUnskipped, false);
    });

    it('executes DELETE safely when Content-Type: application/json has whitespace-only body', async () => {
      await pool.query(
        `INSERT INTO subscription_skipped_dates (subscription_id, customer_id, skip_date, reason)
         VALUES ($1, $2, $3, 'Test skip for whitespace delete')
         ON CONFLICT (subscription_id, skip_date) DO NOTHING`,
        [subscriptionId, customerId, testDeliveryDate]
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date?skipDate=${testDeliveryDate}`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        },
        payload: '   \r\n\t   '
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.success, true);
      assert.equal(data.alreadyUnskipped, false);
    });

    it('executes DELETE /api/v1/addresses/:id safely when Content-Type: application/json is sent without body', async () => {
      const extraAddr = await pool.query(
        `INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
         VALUES ($1, 'fp_test_delete_3', 'Tertiary Recipient', $2, 'Plot 12', 'Tower C', 'Hitec City', 'Landmark', 'Hyderabad', 'Telangana', '500081', false)
         RETURNING id`,
        [customerId, testPhone]
      );
      const extraAddrId = extraAddr.rows[0].id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/addresses/${extraAddrId}`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.statusCode, 200);
    });
  });

  // =========================================================================
  // TASK 3: Valid JSON POST
  // =========================================================================
  describe('3. Valid JSON POST', () => {
    it('accepts and correctly parses valid JSON POST payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify({
          skipDate: testDeliveryDate,
          reason: 'Valid JSON POST skip verification'
        })
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.success, true);
      assert.equal(data.alreadySkipped, false);
    });
  });

  // =========================================================================
  // TASK 4: Malformed Nonempty JSON Returns 400
  // =========================================================================
  describe('4. Malformed Nonempty JSON Returns 400', () => {
    it('returns HTTP 400 for malformed nonempty JSON on POST route (never 500)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        },
        payload: '{"skipDate": "2026-10-25", ' // Missing closing brace & invalid JSON
      });

      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.ok(data.error);
      assert.notEqual(data.error, 'internal_server_error');
    });

    it('returns HTTP 400 for malformed nonempty JSON on DELETE route (never 500)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date?skipDate=${testDeliveryDate}`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        },
        payload: '{ broken json '
      });

      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.ok(data.error);
      assert.notEqual(data.error, 'internal_server_error');
    });

    it('returns HTTP 400 for malformed nonempty JSON on public auth route (never 500)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: {
          'Content-Type': 'application/json'
        },
        payload: '{"email": "broken@milvanta.in", invalid'
      });

      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.ok(data.error);
      assert.notEqual(data.error, 'internal_server_error');
    });
  });

  // =========================================================================
  // TASK 5: Skip -> Resume Complete Lifecycle & Billing Verification
  // =========================================================================
  describe('5. Skip -> Resume Lifecycle & Billing Adjustment Integrity', () => {
    it('restores delivery and creates exactly one positive and one negative adjustment', async () => {
      // 1. Clean up any existing skips or adjustments for tomorrow
      await pool.query('DELETE FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2', [subscriptionId, testDeliveryDate]);
      await pool.query('DELETE FROM subscription_billing_adjustments WHERE subscription_id = $1', [subscriptionId]);
      await pool.query('UPDATE subscription_delivery_orders SET status = $1, failed_reason = NULL WHERE subscription_id = $2 AND delivery_date = $3', ['scheduled', subscriptionId, testDeliveryDate]);

      // 2. Perform Skip (POST with JSON)
      const skipRes = await app.inject({
        method: 'POST',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date`,
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify({
          skipDate: testDeliveryDate,
          reason: 'Single skip test'
        })
      });
      assert.equal(skipRes.statusCode, 200);

      // Verify skip row exists
      const skipCheck = await pool.query('SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2', [subscriptionId, testDeliveryDate]);
      assert.equal(skipCheck.rows.length, 1);

      // Verify order cancelled
      const orderAfterSkip = await pool.query('SELECT status, failed_reason FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2', [subscriptionId, testDeliveryDate]);
      assert.equal(orderAfterSkip.rows[0].status, 'cancelled');
      assert.equal(orderAfterSkip.rows[0].failed_reason, 'Delivery date skipped by customer');

      // Verify 1 positive adjustment (+9000 paise)
      const adjAfterSkip = await pool.query('SELECT amount_paise FROM subscription_billing_adjustments WHERE subscription_id = $1', [subscriptionId]);
      assert.equal(adjAfterSkip.rows.length, 1);
      assert.equal(Number(adjAfterSkip.rows[0].amount_paise), 9000);

      // 3. Perform Resume (Bodyless DELETE as sent by Resume Tomorrow in profile.js)
      const resumeRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/subscriptions/${subscriptionId}/skip-date?skipDate=${testDeliveryDate}`,
        headers: {
          Authorization: `Bearer ${customerToken}`
          // No content-type, no body
        }
      });
      assert.equal(resumeRes.statusCode, 200);
      const resumeData = JSON.parse(resumeRes.payload);
      assert.equal(resumeData.success, true);
      assert.equal(resumeData.alreadyUnskipped, false);

      // Verify skip row deleted
      const skipCheckAfterResume = await pool.query('SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2', [subscriptionId, testDeliveryDate]);
      assert.equal(skipCheckAfterResume.rows.length, 0);

      // Verify order restored to scheduled
      const orderAfterResume = await pool.query('SELECT status, failed_reason FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2', [subscriptionId, testDeliveryDate]);
      assert.equal(orderAfterResume.rows[0].status, 'scheduled');
      assert.equal(orderAfterResume.rows[0].failed_reason, null);

      // Verify adjustments: exactly 1 positive, exactly 1 negative, net 0
      const adjTotal = await pool.query('SELECT amount_paise FROM subscription_billing_adjustments WHERE subscription_id = $1 ORDER BY created_at ASC', [subscriptionId]);
      assert.equal(adjTotal.rows.length, 2);
      assert.equal(Number(adjTotal.rows[0].amount_paise), 9000);
      assert.equal(Number(adjTotal.rows[1].amount_paise), -9000);
      const net = adjTotal.rows.reduce((sum, r) => sum + Number(r.amount_paise), 0);
      assert.equal(net, 0, 'Net financial adjustments must sum to zero paise');

      // Verify calendar reports scheduled
      const calRes = await app.inject({
        method: 'GET',
        url: `/api/v1/subscriptions/${subscriptionId}/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`,
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(calRes.statusCode, 200);
      const calData = JSON.parse(calRes.payload);
      const tomDayObj = calData.days.find(x => x.date === testDeliveryDate);
      assert.ok(tomDayObj);
      assert.equal(tomDayObj.status, 'scheduled');
    });
  });

  // =========================================================================
  // TASK 6: Razorpay Webhook Raw-Body Signature Verification
  // =========================================================================
  describe('6. Razorpay Webhook Raw-Body Signature Verification', () => {
    it('accepts valid webhook with HMAC-SHA256 signature calculated from rawBody', async () => {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_test_raw_body_valid',
              status: 'captured',
              amount: 9000,
              currency: 'INR'
            }
          }
        }
      });

      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(Buffer.from(rawPayload, 'utf8'))
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': validSignature,
          'X-Razorpay-Event-Id': 'evt_raw_body_test_001'
        },
        payload: rawPayload
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.received, true);
    });

    it('rejects webhook with invalid signature with HTTP 400', async () => {
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_forged', status: 'captured' } }
        }
      });

      const forgedSignature = crypto
        .createHmac('sha256', 'wrong_secret')
        .update(Buffer.from(rawPayload, 'utf8'))
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': forgedSignature,
          'X-Razorpay-Event-Id': 'evt_forged_001'
        },
        payload: rawPayload
      });

      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'invalid_webhook_signature');
    });
  });

  // =========================================================================
  // TASK 7: Frontend apiRequest() Header Construction Verification
  // =========================================================================
  describe('7. Frontend apiRequest() Header Construction & Dual-Copy Parity', () => {
    it('profile.js sets Content-Type only when options.body is provided', () => {
      const profileJs = fs.readFileSync(path.join(process.cwd(), 'frontend/js/profile.js'), 'utf8');

      // Verify the apiRequest header construction line
      assert.ok(
        profileJs.includes("options.body !== undefined && options.body !== null ? { 'Content-Type': 'application/json' } : {}"),
        'profile.js must conditionally add Content-Type only when body is present'
      );
      assert.ok(
        !profileJs.includes("const headers = {\n      'Content-Type': 'application/json',"),
        'profile.js must not unconditionally add Content-Type'
      );
    });

    it('frontend/js/profile.js and frontend/cloudflare-upload/js/profile.js are 100% byte-for-byte identical', () => {
      const primary = fs.readFileSync(path.join(process.cwd(), 'frontend/js/profile.js'), 'utf8');
      const cloudflare = fs.readFileSync(path.join(process.cwd(), 'frontend/cloudflare-upload/js/profile.js'), 'utf8');
      assert.strictEqual(primary, cloudflare);
    });

    it('frontend/profile.html and frontend/cloudflare-upload/profile.html are 100% byte-for-byte identical', () => {
      const primary = fs.readFileSync(path.join(process.cwd(), 'frontend/profile.html'), 'utf8');
      const cloudflare = fs.readFileSync(path.join(process.cwd(), 'frontend/cloudflare-upload/profile.html'), 'utf8');
      assert.strictEqual(primary, cloudflare);
    });

    it('profile.html has incremented cache-busting version strings (?v=20261021-4)', () => {
      const primary = fs.readFileSync(path.join(process.cwd(), 'frontend/profile.html'), 'utf8');
      assert.ok(primary.includes('css/profile.css?v=20261021-4'));
      assert.ok(primary.includes('js/profile.js?v=20261021-4'));
    });
  });
});

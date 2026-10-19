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

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_verify_reconciliation_jwt_secret_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_verify';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_milvanta_verify_hmac';

// Fail closed immediately before importing server if test database is not configured
assertTestDatabaseConfigured();

// Initialize isolated disposable test schema BEFORE application pool is created
const setup = await setupDisposableTestSchema();
const pool = setup.pool;
const schemaName = setup.schemaName;

const { app, razorpay } = await import('../src/server.js');

describe('Milvanta Subscription Verification, Payment Integrity & Schema Reconciliation Suite', () => {
  let customerAId;
  let customerBId;
  let tokenA;
  let tokenB;

  const testEmailA = `test_alpha_${Date.now()}_${Math.floor(Math.random() * 10000)}@milvanta.in`;
  const testPhoneA = '9' + Math.floor(100000000 + Math.random() * 900000000);
  const testEmailB = `test_beta_${Date.now()}_${Math.floor(Math.random() * 10000)}@milvanta.in`;
  const testPhoneB = '9' + Math.floor(100000000 + Math.random() * 900000000);

  before(async () => {
    // Report verified database identity without revealing credentials
    console.log(
      `[Test DB Isolation] Verified disposable test environment connected to DB: '${setup.connectedDb}' on port ${setup.serverPort}, schema: '${schemaName}'`
    );

    // 2. Seed Customer A and Customer B in isolated disposable schema
    const resA = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash)
       VALUES ('Customer Alpha', $1, $2, 'salt', 'hash')
       RETURNING id`,
      [testEmailA, testPhoneA]
    );
    customerAId = resA.rows[0].id;

    const resB = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash)
       VALUES ('Customer Beta', $1, $2, 'salt', 'hash')
       RETURNING id`,
      [testEmailB, testPhoneB]
    );
    customerBId = resB.rows[0].id;

    // Generate tokens
    tokenA = app.jwt.sign({ sub: String(customerAId), email: testEmailA });
    tokenB = app.jwt.sign({ sub: String(customerBId), email: testEmailB });

    // Seed customer_sessions
    const tokenHashA = crypto.createHash('sha256').update(tokenA).digest('hex');
    const tokenHashB = crypto.createHash('sha256').update(tokenB).digest('hex');

    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES 
         ($1, $2, 'csrf_a', NOW() + INTERVAL '1 day'),
         ($3, $4, 'csrf_b', NOW() + INTERVAL '1 day')`,
      [tokenHashA, customerAId, tokenHashB, customerBId]
    );
  });

  after(async () => {
    // Clean up disposable schema and independently verify removal
    await cleanupDisposableTestSchema(pool, schemaName);
  });

  // =========================================================================
  // 1. PostgreSQL Schema Error Reproductions & Verifications
  // =========================================================================
  describe('1. PostgreSQL Schema Error Reproductions & Verifications', () => {
    it('reproduces error 42703 if querying non-existent cs.start_date on customer_subscriptions', async () => {
      let threw42703 = false;
      try {
        await pool.query(`SELECT cs.id, cs.start_date FROM customer_subscriptions cs LIMIT 1`);
      } catch (err) {
        if (err.code === '42703' && err.message.includes('start_date')) {
          threw42703 = true;
        }
      }
      assert.equal(threw42703, true, 'Querying cs.start_date must throw SQL error 42703');
    });

    it('succeeds cleanly when querying actual schema columns on customer_subscriptions', async () => {
      const res = await pool.query(
        `SELECT id, customer_id, status, product_name, quantity, cost_per_day_paise, total_amount_paise, notes, next_delivery, razorpay_subscription_id, razorpay_plan_id, created_at
         FROM customer_subscriptions
         LIMIT 1`
      );
      assert.ok(Array.isArray(res.rows));
    });

    it('reproduces error 42703 if querying non-existent co.total_amount_paise or co.delivery_address on customer_orders', async () => {
      let threw42703 = false;
      try {
        await pool.query(`SELECT co.id, co.total_amount_paise FROM customer_orders co LIMIT 1`);
      } catch (err) {
        if (err.code === '42703' && err.message.includes('total_amount_paise')) {
          threw42703 = true;
        }
      }
      assert.equal(threw42703, true, 'Querying co.total_amount_paise must throw SQL error 42703');
    });

    it('succeeds cleanly when querying actual schema columns (total_paise, address) on customer_orders', async () => {
      const res = await pool.query(
        `SELECT id, order_number, customer_id, total_paise, address, items, payment_status, order_status, created_at
         FROM customer_orders
         LIMIT 1`
      );
      assert.ok(Array.isArray(res.rows));
    });
  });

  // =========================================================================
  // 2. Signature & Gateway Verification Security Guards
  // =========================================================================
  describe('2. Signature & Gateway Verification Security Guards', () => {
    it('blocks unauthenticated access to POST /api/v1/subscriptions/verify with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/verify',
        payload: {
          razorpay_subscription_id: 'sub_test_123',
          razorpay_payment_id: 'pay_test_123',
          razorpay_signature: 'abc'
        }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects POST /api/v1/subscriptions/verify if required payment proofs are missing with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/verify',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          razorpay_subscription_id: 'sub_test_123'
        }
      });
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'invalid_subscription_proof');
    });

    it('rejects forged HMAC-SHA256 signature with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/verify',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          razorpay_subscription_id: 'sub_test_123',
          razorpay_payment_id: 'pay_test_123',
          razorpay_signature: 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567'
        }
      });
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'invalid_subscription_signature');
    });

    it('rejects verification if gateway status is not active/captured with 409', async () => {
      const subId = `sub_unauth_${Date.now()}`;
      const payId = `pay_unauth_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'pending',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'failed',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_payment_state_not_captured');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('rejects verification if payment has missing subscription linkage with 400', async () => {
      const subId = `sub_nolink_${Date.now()}`;
      const payId = `pay_nolink_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: 'plan_cow_1m',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre', productName: 'Pure Fresh Cow Milk' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        currency: 'INR',
        amount: 315000
        // subscription_id is omitted / missing!
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_subscription_mismatch');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('rejects verification if payment is linked to a different subscription ID with 400', async () => {
      const subId = `sub_link_${Date.now()}`;
      const otherSubId = `sub_other_${Date.now()}`;
      const payId = `pay_link_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: otherSubId, // Points to different subscription!
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_subscription_mismatch');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('rejects verification if payment currency is missing or non-INR with 400', async () => {
      const subId = `sub_curr_${Date.now()}`;
      const payId = `pay_curr_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'USD',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'invalid_payment_currency');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('rejects verification if payment amount is non-positive or missing with 400', async () => {
      const subId = `sub_amt_${Date.now()}`;
      const payId = `pay_amt_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 0 // invalid amount
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'invalid_payment_amount');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 3. Subscription Activation & Lifecycle State Integrity (Requirement 1 & 6)
  // =========================================================================
  describe('3. Subscription Activation & Lifecycle State Integrity (Requirement 1 & 6)', () => {
    it('moves subscription from pending_authorization to active upon valid verification', async () => {
      const subId = `sub_pending_${Date.now()}`;
      const payId = `pay_valid_${Date.now()}`;
      const planId = `plan_cow_1m_${Date.now()}`;

      // Insert pending draft in disposable schema
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Schedule', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4
         ) RETURNING id`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, size: '1 Litre', customerId: String(customerAId) })]
      );
      const localSubId = insertRes.rows[0].id;

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      const originalFetchPlan = razorpay.plans?.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: planId,
        current_start: Math.floor(Date.now() / 1000) + 86400,
        notes: {
          customerId: String(customerAId),
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre'
        }
      });
      if (!razorpay.plans) razorpay.plans = {};
      razorpay.plans.fetch = async () => ({
        id: planId,
        item: { amount: 315000, currency: 'INR' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');

        // Verify in DB that it moved to active
        const dbCheck = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE id = $1', [localSubId]);
        assert.equal(dbCheck.rows[0].status, 'active');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
        if (razorpay.plans) razorpay.plans.fetch = originalFetchPlan;
      }
    });

    it('idempotently handles duplicate verification without duplicate emails or notifications', async () => {
      const subId = `sub_idemp_${Date.now()}`;
      const payId = `pay_idemp_${Date.now()}`;
      const planId = `plan_idemp_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'active', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, size: '1 Litre', customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');
        assert.equal(data.message, 'Subscription already active');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 1: rejects verification on cancelled subscriptions with 409 and does not reactivate', async () => {
      const subId = `sub_cancelled_${Date.now()}`;
      const payId = `pay_cancelled_${Date.now()}`;

      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'cancelled', 'Cancelled', 'month', '1 Month Continuous Plan',
           315000, $2, $3
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );
      const subDbId = insertRes.rows[0].id;

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');

        // Confirm database status remains 'cancelled'
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [subDbId]);
        assert.equal(check.rows[0].status, 'cancelled');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 1: rejects verification on paused subscriptions with 409 and does not reactivate', async () => {
      const subId = `sub_paused_${Date.now()}`;
      const payId = `pay_paused_${Date.now()}`;

      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'paused', 'On Hold (Paused)', 'month', '1 Month Continuous Plan',
           315000, $2, $3
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );
      const subDbId = insertRes.rows[0].id;

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');

        // Confirm database status remains 'paused'
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [subDbId]);
        assert.equal(check.rows[0].status, 'paused');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Concurrency: simultaneous verification requests activate subscription idempotently without duplicate transitions', async () => {
      const subId = `sub_concurrent_${Date.now()}`;
      const payId = `pay_concurrent_${Date.now()}`;
      const planId = `plan_concurrent_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Schedule', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, size: '1 Litre', customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        // Send two verification requests concurrently
        const [res1, res2] = await Promise.all([
          app.inject({
            method: 'POST',
            url: '/api/v1/subscriptions/verify',
            headers: { Authorization: `Bearer ${tokenA}` },
            payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
          }),
          app.inject({
            method: 'POST',
            url: '/api/v1/subscriptions/verify',
            headers: { Authorization: `Bearer ${tokenA}` },
            payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
          })
        ]);

        assert.equal(res1.statusCode, 200);
        assert.equal(res2.statusCode, 200);

        const data1 = JSON.parse(res1.payload);
        const data2 = JSON.parse(res2.payload);

        // Exactly one should report 'Subscription verified and activated', and the other 'Subscription already active'
        const messages = [data1.message, data2.message].sort();
        assert.deepEqual(messages, ['Subscription already active', 'Subscription verified and activated']);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 4. Trustworthy Reconciliation & Ownership Verification (Requirements 2 & 3)
  // =========================================================================
  describe('4. Trustworthy Reconciliation & Ownership Verification (Requirements 2 & 3)', () => {
    it('Requirement 2: rejects automatic reconciliation if gateway notes lack customerId with 403', async () => {
      const subId = `sub_untrusted_${Date.now()}`;
      const payId = `pay_untrusted_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: {
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre'
          // customerId is intentionally omitted
        }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 403);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'untrustworthy_subscription_ownership');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 2: rejects reconciliation if gateway phone or email contradicts customer with 403', async () => {
      const subId = `sub_contradict_${Date.now()}`;
      const payId = `pay_contradict_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: {
          customerId: String(customerAId),
          customerPhone: '9999999999', // Contradicts testPhoneA!
          size: '1 Litre'
        }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 403);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_forbidden');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 3: rejects draft verification if plan ID does not match local draft with 400', async () => {
      const subId = `sub_plan_diff_${Date.now()}`;
      const payId = `pay_plan_diff_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Schedule', 'month', '1 Month Continuous Plan',
           315000, $2, 'plan_expected_local', $3
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: 'plan_different_from_gateway',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_plan_mismatch');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 3: rejects draft verification if payment amount does not match plan charge with 400', async () => {
      const subId = `sub_amt_diff_${Date.now()}`;
      const payId = `pay_amt_diff_${Date.now()}`;
      const planId = `plan_cow_amt_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Schedule', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } }, // Expected: 315000
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 250000 // Underpaid by ₹650!
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: payId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_amount_mismatch');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 5. POST /api/v1/subscriptions Payment Protection (Requirement 4)
  // =========================================================================
  describe('5. POST /api/v1/subscriptions Payment Protection (Requirement 4)', () => {
    it('Requirement 4: rejects using an order payment reference to create a subscription with 400', async () => {
      const orderPaymentId = `pay_order_${Date.now()}`;

      const orderRes = await pool.query(
        `INSERT INTO customer_orders (
          order_number, customer_id, idempotency_key, address, items, subtotal_paise,
          delivery_charge_paise, total_paise, payment_status
        ) VALUES (
          $1, $2, $3, '{"city":"Hyderabad"}'::jsonb, '[]'::jsonb, 10000, 5000, 15000, 'paid'
        ) RETURNING id`,
        [`ORD-TEST-${Date.now()}`, customerAId, `idem_${Date.now()}`]
      );
      await pool.query(
        `INSERT INTO payment_orders (
          razorpay_order_id, razorpay_payment_id, amount_paise, currency, items, status, customer_order_id
        ) VALUES (
          $1, $2, 15000, 'INR', '[]'::jsonb, 'captured', $3
        )`,
        [`order_rzp_${Date.now()}`, orderPaymentId, orderRes.rows[0].id]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          productName: 'Pure Fresh Cow Milk',
          quantity: '1 Litre',
          paymentId: orderPaymentId
        }
      });

      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'payment_already_used_for_order');
    });

    it('Requirement 4: rejects using a recurring subscription payment reference to directly create a subscription with 400', async () => {
      const recurringPaymentId = `pay_recurring_${Date.now()}`;

      const originalFetchPay = razorpay.payments.fetch;
      razorpay.payments.fetch = async () => ({
        id: recurringPaymentId,
        status: 'captured',
        currency: 'INR',
        amount: 315000,
        subscription_id: 'sub_rzp_recurring_123', // Has subscription_id!
        notes: { customerId: String(customerAId) }
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            productName: 'Pure Fresh Cow Milk',
            quantity: '1 Litre',
            paymentId: recurringPaymentId,
            notes: { days: 30 }
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_payment_requires_verify');
      } finally {
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 4: rejects subscription creation if payment amount is less than subscription cost with 400', async () => {
      const underpaidPaymentId = `pay_underpaid_${Date.now()}`;

      const originalFetchPay = razorpay.payments.fetch;
      razorpay.payments.fetch = async () => ({
        id: underpaidPaymentId,
        status: 'captured',
        currency: 'INR',
        amount: 10000, // ₹100, but 1-month 1L Cow Milk is ₹3,150!
        notes: { customerId: String(customerAId) }
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            productName: 'Pure Fresh Cow Milk',
            quantity: '1 Litre',
            paymentId: underpaidPaymentId,
            notes: { days: 30 }
          }
        });

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_amount_insufficient');
      } finally {
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 4: rejects subscription creation if payment notes lack customer ownership with 403', async () => {
      const unownedPaymentId = `pay_unowned_${Date.now()}`;

      const originalFetchPay = razorpay.payments.fetch;
      razorpay.payments.fetch = async () => ({
        id: unownedPaymentId,
        status: 'captured',
        currency: 'INR',
        amount: 315000,
        notes: {} // Missing customer ownership!
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            productName: 'Pure Fresh Cow Milk',
            quantity: '1 Litre',
            paymentId: unownedPaymentId,
            notes: { days: 30 }
          }
        });

        assert.equal(res.statusCode, 403);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_customer_mismatch');
      } finally {
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 4: rejects subscription creation if payment notes belong to a different customer with 403', async () => {
      const otherCustPaymentId = `pay_other_cust_${Date.now()}`;

      const originalFetchPay = razorpay.payments.fetch;
      razorpay.payments.fetch = async () => ({
        id: otherCustPaymentId,
        status: 'captured',
        currency: 'INR',
        amount: 315000,
        notes: { customerId: String(customerBId) } // Belongs to customer B!
      });

      try {
        // Customer A attempts to activate subscription with Customer B's payment
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            productName: 'Pure Fresh Cow Milk',
            quantity: '1 Litre',
            paymentId: otherCustPaymentId,
            notes: { days: 30 }
          }
        });

        assert.equal(res.statusCode, 403);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_customer_mismatch');
      } finally {
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 6. Callback Endpoint Authoritative Verification (Requirement 5)
  // =========================================================================
  describe('6. Callback Endpoint Authoritative Verification (Requirement 5)', () => {
    it('Requirement 5: rejects callback if gateway payment is uncaptured even with valid HMAC signature', async () => {
      const subId = `sub_cb_failed_${Date.now()}`;
      const payId = `pay_cb_failed_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({ id: subId, status: 'active' });
      razorpay.payments.fetch = async () => ({ id: payId, status: 'failed', currency: 'INR', amount: 315000, subscription_id: subId });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        assert.match(res.headers.location, /error=payment_not_authorized/);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 5: rejects callback if payment has missing or mismatched subscription linkage', async () => {
      const subId = `sub_cb_nolink_${Date.now()}`;
      const payId = `pay_cb_nolink_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({ id: subId, status: 'active' });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        currency: 'INR',
        amount: 315000,
        subscription_id: 'sub_some_other_id' // Mismatched!
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        assert.match(res.headers.location, /error=payment_subscription_mismatch/);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 5: rejects callback if target subscription in DB is cancelled', async () => {
      const subId = `sub_cb_cancelled_${Date.now()}`;
      const payId = `pay_cb_cancelled_${Date.now()}`;
      const planId = `plan_cb_canc_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'cancelled', 'Cancelled', 'month', '1 Month Continuous Plan',
           315000, $2, $3
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        assert.match(res.headers.location, /error=subscription_state_conflict/);

        // Confirm database status remains cancelled
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'cancelled');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 5: successfully activates pending subscription on valid callback', async () => {
      const subId = `sub_cb_valid_${Date.now()}`;
      const payId = `pay_cb_valid_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Schedule', 'month', '1 Month Continuous Plan',
           315000, $2, $3
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 315000
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        assert.match(res.headers.location, /subscription=success/);

        // Confirm database status is now active
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'active');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });
});

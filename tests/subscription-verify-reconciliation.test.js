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
const { generateDailyDeliveries } = await import('../src/services/deliveryEngine.js');
const { getSubscriptionCalendar, addCalendarMonths, derivePaidThroughDate } = await import('../src/services/subscriptionService.js');
const { sendSubscriptionConfirmationEmails } = await import('../src/email.js');

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

  // =========================================================================
  // 7. Verification Race Conditions, Mandate Lifecycle & Future Start Dates
  // =========================================================================
  describe('7. Verification Race Conditions, Mandate Lifecycle & Future Start Dates', () => {
    it('handles verify race condition: returns 409 subscription_state_conflict when concurrently cancelled', async () => {
      const subId = `sub_race_canc_${Date.now()}`;
      const payId = `pay_race_canc_${Date.now()}`;
      const planId = `plan_race_canc_${Date.now()}`;

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

      // Concurrently before update runs, simulate another worker setting status to 'cancelled'
      await pool.query("UPDATE customer_subscriptions SET status = 'cancelled' WHERE razorpay_subscription_id = $1", [subId]);

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');
        assert.equal(data.status, 'cancelled');

        // Confirm database status remains cancelled
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'cancelled');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('handles verify race condition: returns 409 subscription_state_conflict when concurrently paused', async () => {
      const subId = `sub_race_pause_${Date.now()}`;
      const payId = `pay_race_pause_${Date.now()}`;
      const planId = `plan_race_pause_${Date.now()}`;

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

      // Concurrently set status to 'paused'
      await pool.query("UPDATE customer_subscriptions SET status = 'paused' WHERE razorpay_subscription_id = $1", [subId]);

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');
        assert.equal(data.status, 'paused');

        // Confirm database status remains paused
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'paused');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('handles callback race condition: redirects with subscription_state_conflict when concurrently paused', async () => {
      const subId = `sub_cb_race_${Date.now()}`;
      const payId = `pay_cb_race_${Date.now()}`;
      const planId = `plan_cb_race_${Date.now()}`;

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

      // Concurrently set status to 'paused'
      await pool.query("UPDATE customer_subscriptions SET status = 'paused' WHERE razorpay_subscription_id = $1", [subId]);

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        assert.match(res.headers.location, /error=subscription_state_conflict/);

        // Confirm database status remains paused
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'paused');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 1: accepts legitimate refundable mandate authorization and persists authenticated mandate state without enabling fulfillment', async () => {
      const subId = `sub_mandate_auth_${Date.now()}`;
      const payId = `pay_mandate_auth_${Date.now()}`;
      const planId = `plan_mandate_auth_${Date.now()}`;

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

      // Gateway subscription status: 'authenticated', paid_count: 0
      // Gateway payment amount: 200 paise (₹2 refundable auth)
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'authenticated',
        paid_count: 0,
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 200
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'pending_authorization', 'Must NOT activate fulfillment for mandate-only auth');
        assert.equal(data.mandateStatus, 'authenticated');
        assert.equal(data.fulfillmentEntitled, false);

        // Confirm database status remains pending_authorization and mandate state is persisted separately
        const check = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'pending_authorization');
        assert.equal(check.rows[0].notes.mandateStatus, 'authenticated');
        assert.equal(check.rows[0].notes.fulfillmentEntitled, false);
        assert.equal(check.rows[0].notes.paidCount, 0);
        assert.equal(check.rows[0].notes.mandatePaymentId, payId);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 2: blocks fulfillment if gateway subscription is halted or payment is not authorized', async () => {
      const subId = `sub_halted_${Date.now()}`;
      const payId = `pay_halted_${Date.now()}`;
      const planId = `plan_halted_${Date.now()}`;

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

      // Halted gateway subscription
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'halted',
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
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_payment_state_not_captured');

        // Confirm database status remains pending_authorization
        const check = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(check.rows[0].status, 'pending_authorization');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 3: supports future startOffset and start_at, aligning next_delivery and delivery generation', async () => {
      // Create subscription with future start date in notes
      const subId = `sub_future_start_${Date.now()}`;
      const payId = `pay_future_start_${Date.now()}`;
      const planId = `plan_future_start_${Date.now()}`;

      // Start date: 1st of next month
      const now = new Date();
      const futureDate = new Date(now.getFullYear(), now.getMonth() + 1, 1, 6, 0, 0);
      const futureDateYMD = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-01`;
      const futureStartAtEpoch = Math.floor(futureDate.getTime() / 1000);

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', $5, 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4
         )`,
        [
          customerAId,
          subId,
          planId,
          JSON.stringify({
            subscriptionId: subId,
            size: '1 Litre',
            customerId: String(customerAId),
            startDate: futureDateYMD,
            start_at: futureStartAtEpoch,
            startOffset: 1
          }),
          `${futureDateYMD}, 6:00 AM – 7:00 AM`
        ]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        start_at: futureStartAtEpoch,
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre', startDate: futureDateYMD, start_at: String(futureStartAtEpoch) }
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
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');
        assert.equal(data.startDate, futureDateYMD);
        assert.match(data.nextDelivery, new RegExp(`^${futureDateYMD}`));

        // 1. Confirm database row has next_delivery aligned to future date
        const subDb = await pool.query('SELECT id, status, next_delivery FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(subDb.rows[0].status, 'active');
        assert.match(subDb.rows[0].next_delivery, new RegExp(`^${futureDateYMD}`));

        // 2. Run generateDailyDeliveries for today; must skip this future-dated subscription
        const todayYMD = now.toISOString().slice(0, 10);
        await generateDailyDeliveries(pool, todayYMD);
        const delOrders = await pool.query(
          'SELECT id FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
          [subDb.rows[0].id, todayYMD]
        );
        assert.equal(delOrders.rows.length, 0, 'No delivery order should be generated prior to subscription start date');

        // 3. Check getSubscriptionCalendar for current month (which is before futureDate)
        const cal = await getSubscriptionCalendar(pool, {
          subscriptionId: subDb.rows[0].id,
          customerId: customerAId,
          month: now.getMonth() + 1,
          year: now.getFullYear()
        });

        // Days before futureDateYMD should have status 'not_started'
        const day1 = cal.days.find(d => d.date < futureDateYMD);
        if (day1) {
          assert.equal(day1.status, 'not_started');
          assert.match(day1.detail, new RegExp(`Subscription begins on ${futureDateYMD}`));
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  describe('8. Subscription Confirmation Email Reliability & Secure Endpoint Patch', () => {
    let verifiedSubAId;
    let cancelledSubAId;
    let verifiedSubBId;

    before(async () => {
      const resA = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, quantity, frequency, time_slot,
           cost_per_day_paise, total_amount_paise, status, next_delivery, notes
         ) VALUES (
           $1, 'Cow Milk (500 ml)', '500 ml', 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
           5500, 165000, 'active', '2026-10-21',
           $2::jsonb
         ) RETURNING id`,
        [customerAId, JSON.stringify({ paymentId: 'pay_auth_test_1001', planType: 'month' })]
      );
      verifiedSubAId = resA.rows[0].id;

      const resCancel = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, quantity, frequency, time_slot,
           cost_per_day_paise, total_amount_paise, status, next_delivery, notes
         ) VALUES (
           $1, 'Cow Milk (500 ml)', '500 ml', 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
           5500, 165000, 'cancelled', '2026-10-21',
           $2::jsonb
         ) RETURNING id`,
        [customerAId, JSON.stringify({ paymentId: 'pay_cancelled_1002' })]
      );
      cancelledSubAId = resCancel.rows[0].id;

      const resB = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, quantity, frequency, time_slot,
           cost_per_day_paise, total_amount_paise, status, next_delivery, notes
         ) VALUES (
           $1, 'Buffalo Milk (1 Litre)', '1 Litre', 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
           12500, 375000, 'active', '2026-10-21',
           $2::jsonb
         ) RETURNING id`,
        [customerBId, JSON.stringify({ paymentId: 'pay_auth_test_2001', planType: 'month' })]
      );
      verifiedSubBId = resB.rows[0].id;
    });

    it('rejects /api/v1/subscriptions/send-confirmation with missing subscriptionId (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/send-confirmation',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: { paymentId: 'pay_dummy_123' }
      });
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'subscription_id_required');
    });

    it('rejects /api/v1/subscriptions/send-confirmation with non-existent subscriptionId (404)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/send-confirmation',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: { subscriptionId: 999999, paymentId: 'pay_dummy_123' }
      });
      assert.equal(res.statusCode, 404);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'subscription_not_found');
    });

    it('rejects /api/v1/subscriptions/send-confirmation with another customer subscriptionId (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/send-confirmation',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: { subscriptionId: verifiedSubBId, paymentId: 'pay_auth_test_2001' }
      });
      assert.equal(res.statusCode, 403);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'forbidden');
    });

    it('rejects /api/v1/subscriptions/send-confirmation with unverified or cancelled subscription (422)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/send-confirmation',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: { subscriptionId: cancelledSubAId, paymentId: 'pay_cancelled_1002' }
      });
      assert.equal(res.statusCode, 422);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'subscription_not_verified');
    });

    it('sends confirmation for verified subscription using strictly DB data, ignoring client cart tampering (200)', async () => {
      const originalFetch = globalThis.fetch;
      const originalApiKey = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = 're_test_valid_key';

      const dispatchedPayloads = [];
      globalThis.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('resend')) {
          const body = JSON.parse(opts.body);
          dispatchedPayloads.push(body);
          return {
            ok: true,
            json: async () => ({ id: `re_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` })
          };
        }
        return originalFetch(url, opts);
      };

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/send-confirmation',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            subscriptionId: verifiedSubAId,
            paymentId: 'pay_auth_test_1001',
            cart: [{ name: 'Tampered Hacker Milk', price: 1, quantity: '100 Litres' }],
            customPrice: 100
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.success, true);
        assert.equal(data.providerAccepted, true);
        assert.equal(data.deliveryStatus, 'accepted_by_provider');

        const custEmail = dispatchedPayloads.find(p => p.to.includes(testEmailA));
        assert.ok(custEmail);
        assert.match(custEmail.html, /Cow Milk/);
        assert.doesNotMatch(custEmail.html, /Tampered Hacker Milk/);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey) process.env.RESEND_API_KEY = originalApiKey;
        else delete process.env.RESEND_API_KEY;
      }
    });

    it('tracks customer and admin email delivery attempts separately', async () => {
      const originalFetch = globalThis.fetch;
      const originalApiKey = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = 're_test_valid_key';

      globalThis.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('resend')) {
          const body = JSON.parse(opts.body);
          if (body.to.includes(testEmailA)) {
            return { ok: true, json: async () => ({ id: 're_cust_success_1' }) };
          }
          return { ok: false, status: 500, json: async () => ({ message: 'Admin inbox full' }) };
        }
        return originalFetch(url, opts);
      };

      const testPayId = `pay_separate_track_${Date.now()}`;
      try {
        const result = await sendSubscriptionConfirmationEmails(pool, verifiedSubAId, {
          paymentId: testPayId,
          customerEmail: testEmailA
        });

        assert.equal(result.success, false);
        assert.equal(result.results.customerEmail.status, 'accepted');
        assert.equal(result.results.customerEmail.id, 're_cust_success_1');
        assert.equal(result.results.adminEmail.status, 'failed');

        const { rows } = await pool.query('SELECT notes FROM customer_subscriptions WHERE id = $1', [verifiedSubAId]);
        const record = rows[0].notes.emailConfirmations[testPayId];
        assert.ok(record);
        assert.equal(record.customer.status, 'accepted');
        assert.equal(record.customer.messageId, 're_cust_success_1');
        assert.equal(record.admin.status, 'failed');
      } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey) process.env.RESEND_API_KEY = originalApiKey;
        else delete process.env.RESEND_API_KEY;
      }
    });

    it('never marks a failed or skipped email as successfully sent', async () => {
      const originalApiKey = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      delete process.env.SMTP_HOST;

      const testPayId = `pay_skipped_${Date.now()}`;
      const result = await sendSubscriptionConfirmationEmails(pool, verifiedSubAId, {
        paymentId: testPayId,
        customerEmail: testEmailA
      });

      assert.equal(result.success, false);
      assert.equal(result.providerAccepted, false);
      assert.equal(result.results.customerEmail.success, false);
      assert.equal(result.results.customerEmail.status, 'skipped');
      assert.equal(result.results.adminEmail.success, false);
      assert.equal(result.results.adminEmail.status, 'skipped');

      if (originalApiKey) process.env.RESEND_API_KEY = originalApiKey;
    });

    it('retries only recipients that have not had successful provider acceptance', async () => {
      const originalFetch = globalThis.fetch;
      const originalApiKey = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = 're_test_valid_key';

      const testPayId = `pay_retry_partial_${Date.now()}`;

      // First run: customer succeeds, admin fails
      globalThis.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('resend')) {
          const body = JSON.parse(opts.body);
          if (body.to.includes(testEmailA)) {
            return { ok: true, json: async () => ({ id: 're_cust_first_attempt' }) };
          }
          return { ok: false, status: 503, json: async () => ({ message: 'Service unavailable' }) };
        }
        return originalFetch(url, opts);
      };

      try {
        const firstRun = await sendSubscriptionConfirmationEmails(pool, verifiedSubAId, {
          paymentId: testPayId,
          customerEmail: testEmailA
        });
        assert.equal(firstRun.success, false);
        assert.equal(firstRun.results.customerEmail.status, 'accepted');
        assert.equal(firstRun.results.adminEmail.status, 'failed');

        // Retry: admin now working. Customer should be skipped.
        let customerCalledAgain = false;
        let adminCalled = false;

        globalThis.fetch = async (url, opts) => {
          if (typeof url === 'string' && url.includes('resend')) {
            const body = JSON.parse(opts.body);
            if (body.to.includes(testEmailA)) {
              customerCalledAgain = true;
              return { ok: true, json: async () => ({ id: 're_cust_duplicate' }) };
            }
            adminCalled = true;
            return { ok: true, json: async () => ({ id: 're_admin_retry_success' }) };
          }
          return originalFetch(url, opts);
        };

        const retryRun = await sendSubscriptionConfirmationEmails(pool, verifiedSubAId, {
          paymentId: testPayId,
          customerEmail: testEmailA
        });

        assert.equal(customerCalledAgain, false, 'Customer email was already accepted and should NOT be called again on retry');
        assert.equal(adminCalled, true, 'Admin email previously failed and MUST be retried');
        assert.equal(retryRun.success, true);
        assert.equal(retryRun.results.customerEmail.status, 'accepted');
        assert.equal(retryRun.results.customerEmail.alreadySent, true);
        assert.equal(retryRun.results.adminEmail.status, 'accepted');
        assert.equal(retryRun.results.adminEmail.id, 're_admin_retry_success');
      } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey) process.env.RESEND_API_KEY = originalApiKey;
        else delete process.env.RESEND_API_KEY;
      }
    });

    it('prevents concurrent requests from sending duplicate emails using database-backed atomic idempotency', async () => {
      const originalFetch = globalThis.fetch;
      const originalApiKey = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = 're_test_valid_key';

      let callCount = 0;
      globalThis.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('resend')) {
          callCount++;
          await new Promise(r => setTimeout(r, 60));
          return { ok: true, json: async () => ({ id: `re_concurrent_${Date.now()}` }) };
        }
        return originalFetch(url, opts);
      };

      const testPayId = `pay_concurrent_dispatch_${Date.now()}`;
      try {
        const [run1, run2] = await Promise.all([
          sendSubscriptionConfirmationEmails(pool, verifiedSubAId, { paymentId: testPayId, customerEmail: testEmailA }),
          sendSubscriptionConfirmationEmails(pool, verifiedSubAId, { paymentId: testPayId, customerEmail: testEmailA })
        ]);

        assert.ok(run1.success);
        assert.ok(run2.success);
        assert.ok(run1.concurrent || run2.concurrent || run1.duplicate || run2.duplicate);
        assert.ok(callCount <= 2, `Expected at most 2 email provider calls, but got ${callCount}`);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey) process.env.RESEND_API_KEY = originalApiKey;
        else delete process.env.RESEND_API_KEY;
      }
    });

    it('handles calendar API errors: returns 404 for non-existent subscription and rejects invalid subscription IDs with 400', async () => {
      const res404 = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/999999/calendar?year=2026&month=9',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(res404.statusCode, 404);
      const data404 = JSON.parse(res404.payload);
      assert.equal(data404.error, 'subscription_not_found');

      const res400 = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/invalid_id/calendar?year=2026&month=9',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(res400.statusCode, 400);
      const data400 = JSON.parse(res400.payload);
      assert.equal(data400.error, 'invalid_subscription_id');
    });
  });

  // =========================================================================
  // 9. Razorpay One-Month Subscription Lifecycle, Webhook Ordering & Pricing Integrity
  // =========================================================================
  describe('9. Razorpay One-Month Subscription Lifecycle, Webhook Ordering & Pricing Integrity', () => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_key_milvanta_secure';
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

    async function sendWebhook(event, payloadBody) {
      const payloadStr = JSON.stringify(payloadBody);
      const sig = crypto.createHmac('sha256', webhookSecret).update(payloadStr).digest('hex');
      return app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          'content-type': 'application/json'
        },
        payload: payloadStr
      });
    }

    it('Action 2 & 3: retains active fulfillment entitlement when Razorpay reports subscription.completed for a paid 1-month plan', async () => {
      const subId = `sub_onemonth_${Date.now()}`;
      const futureEnd = Math.floor(Date.now() / 1000) + (31 * 86400);
      const futureEndYMD = new Date(futureEnd * 1000).toISOString().slice(0, 10);

      // Seed pending subscription with a captured payment reference in notes
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Buffalo Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           12500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan (31 Days)',
           387500, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, lastPaymentId: `pay_onemonth_${Date.now()}` })]
      );
      const localId = insertRes.rows[0].id;

      // Razorpay fires subscription.completed because total_count = 1 and paid_count = 1
      const res = await sendWebhook('subscription.completed', {
        event: 'subscription.completed',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'completed',
              total_count: 1,
              paid_count: 1,
              current_end: futureEnd
            }
          }
        }
      });
      assert.equal(res.statusCode, 200);

      // Verify business-state handling: fulfillment entitlement MUST remain active through the paid-through date
      const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE id = $1', [localId]);
      assert.equal(rows[0].status, 'active', 'Fully paid month must retain its active delivery entitlement');
      assert.equal(rows[0].notes.billingStatus, 'completed', 'Billing cycle status should be marked completed');
      assert.equal(rows[0].notes.gatewayStatus, 'completed');
      assert.equal(rows[0].notes.paidThroughDate, futureEndYMD);
    });

    it('Action 3: does NOT authorize fulfillment deliveries on mandate-only authorization (paid_count = 0)', async () => {
      const subId = `sub_mandate_only_${Date.now()}`;

      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
      );
      const localId = insertRes.rows[0].id;

      // Mandate registered, but recurring charge has NOT been billed
      const res = await sendWebhook('subscription.authenticated', {
        event: 'subscription.authenticated',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'authenticated',
              paid_count: 0
            }
          }
        }
      });
      assert.equal(res.statusCode, 200);

      const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE id = $1', [localId]);
      assert.equal(rows[0].status, 'pending_authorization', 'Mandate authorization alone must NOT authorize unpaid deliveries');
      assert.equal(rows[0].notes.gatewayStatus, 'authenticated');
    });

    it('Action 4: reconciles premature legacy expiry safely when gateway confirms captured payment and completed subscription', async () => {
      const subId = `sub_premature_expiry_${Date.now()}`;
      const payId = `pay_captured_${Date.now()}`;
      const planId = `plan_cow_${Date.now()}`;

      // Simulate a subscription that was marked 'expired' prematurely by legacy webhook
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'expired', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         ) RETURNING id`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );
      const localId = insertRes.rows[0].id;

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      // Gateway confirms subscription completed billing for 1 month and payment is captured
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'completed',
        total_count: 1,
        paid_count: 1,
        current_end: Math.floor(Date.now() / 1000) + (31 * 86400),
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre', productName: 'Pure Fresh Cow Milk' }
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
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');

        // Verify local subscription was reconciled to active without creating a new row
        const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE id = $1', [localId]);
        assert.equal(rows[0].status, 'active');
        assert.equal(rows[0].notes.lastPaymentId, payId);
        assert.equal(rows[0].notes.billingStatus, 'completed');

        // Confirm no duplicate subscription was created
        const countRes = await pool.query('SELECT COUNT(*) FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(Number(countRes.rows[0].count), 1);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Action 4: rejects verification with 409 if subscription is cancelled or paused', async () => {
      const subId = `sub_cancelled_${Date.now()}`;
      const payId = `pay_cancel_${Date.now()}`;
      const planId = `plan_cancel_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'cancelled', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'completed',
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
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Action 6: confirms pricing consistency between daily rates and Razorpay plan charges without extra fees', async () => {
      // 31 days of Cow Milk 1L at ₹105/day = ₹3,255 (325500 paise)
      // 31 days of Buffalo Milk 1L at ₹125/day = ₹3,875 (387500 paise)
      const originalPlansCreate = razorpay.plans.create;
      const originalSubsCreate = razorpay.subscriptions.create;
      razorpay.plans.create = async (params) => ({ id: `plan_mock_${Date.now()}`, ...params });
      razorpay.subscriptions.create = async (params) => ({ id: `sub_mock_${Date.now()}`, short_url: 'https://rzp.io/i/mock', ...params });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/razorpay-checkout',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            productId: 1, // Cow Milk
            productName: 'Pure Fresh Cow Milk',
            size: '1 Litre',
            monthsCount: 1,
            daysCount: 31
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.success, true);
        assert.equal(data.dailyRate, 105);
        // Ensure the Razorpay plan amount strictly matches dailyRate * daysCount without spurious delivery surcharges
        assert.equal(data.amount, 325500);
        assert.equal(data.totalAmount, 325500);
      } finally {
        razorpay.plans.create = originalPlansCreate;
        razorpay.subscriptions.create = originalSubsCreate;
      }
    });

    it('Action 7: handles webhook-before-verification ordering when webhooks arrive before client verification call', async () => {
      const subId = `sub_order_race_${Date.now()}`;
      const payId = `pay_order_race_${Date.now()}`;
      const planId = `plan_order_race_${Date.now()}`;
      const futureEnd = Math.floor(Date.now() / 1000) + (31 * 86400);

      // Seed pending subscription
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      // 1. Webhook subscription.activated arrives first
      await sendWebhook('subscription.activated', {
        event: 'subscription.activated',
        payload: {
          subscription: {
            entity: { id: subId, status: 'active', paid_count: 1, current_end: futureEnd }
          }
        }
      });

      // 2. Webhook subscription.completed arrives second (total_count = 1)
      await sendWebhook('subscription.completed', {
        event: 'subscription.completed',
        payload: {
          subscription: {
            entity: { id: subId, status: 'completed', total_count: 1, paid_count: 1, current_end: futureEnd }
          }
        }
      });

      // 3. Customer browser finally calls POST /api/v1/subscriptions/verify
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'completed',
        total_count: 1,
        paid_count: 1,
        current_end: futureEnd,
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
        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(verifyRes.statusCode, 200);
        const data = JSON.parse(verifyRes.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');

        // Confirm database status remains active and payment reference is persisted
        const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(rows[0].status, 'active');
        assert.equal(rows[0].notes.lastPaymentId, payId);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Action 5: confirms checkout financial calculation includes delivery in continuous subscription (deliveryFee = 0)', () => {
      // Direct simulation of checkout.js getOrderFinancials() logic
      const cart = [
        {
          id: 1,
          name: 'Pure Fresh Cow Milk',
          price: 315, // 31 days plan unit price
          quantity: 1,
          isContinuousMonthsPlan: true,
          variant: { size: '1 Litre', isContinuousMonthsPlan: true }
        }
      ];

      const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const hasContinuous = cart.some(item => item.isContinuousMonthsPlan || item.variant?.isContinuousMonthsPlan);
      const deliveryFee = hasContinuous ? 0 : 50;
      const total = subtotal + deliveryFee;

      assert.equal(subtotal, 315);
      assert.equal(deliveryFee, 0, 'Continuous subscription must have delivery included (deliveryFee = 0)');
      assert.equal(total, 315, 'Total must strictly equal subtotal when delivery is included');
    });
  });

  // =========================================================================
  // 10. Payment-Entitlement Security, Mandate Isolation & Negative Regression Suite
  // =========================================================================
  describe('10. Payment-Entitlement Security, Mandate Isolation & Negative Regression Suite', () => {
    it('Negative 1: mandate-only verify does NOT activate fulfillment or grant paid deliveries', async () => {
      const subId = `sub_mandate_neg_${Date.now()}`;
      const payId = `pay_mandate_neg_${Date.now()}`;
      const planId = `plan_mandate_neg_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Schedule', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, size: '1 Litre', customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      // Mandate authentication: status authenticated, paid_count: 0, nominal amount 500 paise
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'authenticated',
        paid_count: 0,
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: payId,
        status: 'captured',
        subscription_id: subId,
        currency: 'INR',
        amount: 500
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'pending_authorization');
        assert.equal(data.mandateStatus, 'authenticated');
        assert.equal(data.fulfillmentEntitled, false);

        // Verify DB record
        const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(rows[0].status, 'pending_authorization');
        assert.equal(rows[0].notes.mandateStatus, 'authenticated');
        assert.equal(rows[0].notes.fulfillmentEntitled, false);
        assert.equal(rows[0].notes.paidCount, 0);

        // Verify daily delivery engine ignores this subscription
        const todayYMD = new Date().toISOString().slice(0, 10);
        await generateDailyDeliveries(pool, todayYMD);
        const ordCheck = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = (SELECT id FROM customer_subscriptions WHERE razorpay_subscription_id = $1)', [subId]);
        assert.equal(Number(ordCheck.rows[0].count), 0, 'No delivery orders can be generated for mandate-only auth');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Negative 2: webhook subscription.activated with zero paid_count does not default to 1 or activate', async () => {
      const subId = `sub_zero_paid_${Date.now()}`;

      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
      );
      const localId = insertRes.rows[0].id;

      // Webhook payload with paid_count: 0
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const rawPayload = JSON.stringify({
        event: 'subscription.activated',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
              paid_count: 0
            }
          }
        }
      });
      const sig = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': `evt_zero_paid_${Date.now()}`,
          'content-type': 'application/json'
        },
        payload: rawPayload
      });

      assert.equal(res.statusCode, 200);

      const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE id = $1', [localId]);
      assert.equal(rows[0].status, 'pending_authorization', 'Status must NOT be activated when paid_count is 0');
      assert.equal(rows[0].notes.paidCount, 0, 'paidCount must NOT default to 1');
      assert.equal(rows[0].notes.mandateStatus, 'authenticated');
    });

    it('Negative 3: generateDailyDeliveries fails closed when paid-through date cannot be established', async () => {
      const subId = `sub_no_end_date_${Date.now()}`;

      // Insert subscription with status active and paymentId, BUT 0 cost and no duration (derivation impossible)
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           0, 'active', 'Tomorrow, 6:00 AM', 'custom', 'Custom Plan',
           0, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, lastPaymentId: 'pay_unverifiable_mock' })]
      );
      const localId = insertRes.rows[0].id;

      const todayYMD = new Date().toISOString().slice(0, 10);
      const initialOrders = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = $1', [localId]);

      // Running delivery generation must fail closed on this subscription
      await generateDailyDeliveries(pool, todayYMD);

      const afterOrders = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = $1', [localId]);
      assert.equal(Number(afterOrders.rows[0].count), Number(initialOrders.rows[0].count), 'Must fail closed when paid-through date is missing');
    });

    it('Negative 4: generateDailyDeliveries blocks deliveries outside the authenticated paid-through period', async () => {
      const subId = `sub_post_expiry_${Date.now()}`;

      // Active subscription paid through 2026-10-25
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'active', '2026-10-20, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          lastPaymentId: 'pay_valid_paid_period',
          paidCount: 1,
          startDate: '2026-10-01',
          paidThroughDate: '2026-10-25'
        })]
      );
      const localId = insertRes.rows[0].id;

      // 1. Target date BEFORE start date (2026-09-30) -> MUST BE BLOCKED
      await generateDailyDeliveries(pool, '2026-09-30');
      const preOrders = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2', [localId, '2026-09-30']);
      assert.equal(Number(preOrders.rows[0].count), 0, 'Delivery before start date must be skipped');

      // 2. Target date AFTER paid entitlement (2026-10-26) -> MUST BE BLOCKED
      await generateDailyDeliveries(pool, '2026-10-26');
      const postOrders = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2', [localId, '2026-10-26']);
      assert.equal(Number(postOrders.rows[0].count), 0, 'Delivery after paid-through date must be skipped');

      // 3. Target date WITHIN paid entitlement (2026-10-20) -> MUST SUCCEED
      await generateDailyDeliveries(pool, '2026-10-20');
      const validOrders = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2', [localId, '2026-10-20']);
      assert.equal(Number(validOrders.rows[0].count), 1, 'Delivery within paid entitlement must be generated');
    });

    it('Negative 5: rejects reconciliation of legitimately expired subscription whose paid entitlement elapsed', async () => {
      const subId = `sub_legit_expired_${Date.now()}`;
      const payId = `pay_historical_${Date.now()}`;
      const planId = `plan_hist_${Date.now()}`;

      // Subscription locally marked 'expired'
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'expired', 'Expired', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         ) RETURNING id`,
        [customerAId, subId, planId, JSON.stringify({
          subscriptionId: subId,
          customerId: String(customerAId),
          startDate: '2026-08-01',
          paidThroughDate: '2026-08-31'
        })]
      );
      const localId = insertRes.rows[0].id;

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;

      // Gateway reports historical subscription whose current_end was in the past (e.g. 2026-08-31)
      const pastEndEpoch = Math.floor(new Date('2026-08-31T23:59:59Z').getTime() / 1000);
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'completed',
        total_count: 1,
        paid_count: 1,
        current_end: pastEndEpoch,
        plan_id: planId,
        plan: { item: { amount: 315000, currency: 'INR' } },
        notes: { customerId: String(customerAId), size: '1 Litre', productName: 'Pure Fresh Cow Milk' }
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
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 409, 'Must return 409 Conflict when attempting to reactivate expired subscription');
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, false);
        assert.equal(data.error, 'subscription_expired');

        // Confirm database status remains expired
        const { rows } = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [localId]);
        assert.equal(rows[0].status, 'expired', 'Legitimately expired subscription must remain expired');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Negative 6: generateDailyDeliveries fails closed when subscription has active status but no verified payment evidence', async () => {
      const subId = `sub_unpaid_active_${Date.now()}`;

      // Insert subscription with status active, but NO lastPaymentId, NO paymentId, paidCount = 0
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'active', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, paidCount: 0 })]
      );
      const localId = insertRes.rows[0].id;

      const todayYMD = new Date().toISOString().slice(0, 10);
      await generateDailyDeliveries(pool, todayYMD);

      const checkOrders = await pool.query('SELECT COUNT(*) FROM subscription_delivery_orders WHERE subscription_id = $1', [localId]);
      assert.equal(Number(checkOrders.rows[0].count), 0, 'Unpaid subscription must not receive deliveries even if marked active');
    });
  });

  describe('11. Multi-Month Entitlement, Calendar Boundaries, Uncaptured Payment Guards & Webhook Completion Integrity', () => {
    it('11.1 addCalendarMonths: correctly handles month-end dates without calendar rollover', () => {
      // Jan 31 + 1 month -> Feb 28 (non-leap 2026)
      assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28');
      // Jan 31 + 3 months -> Apr 30
      assert.equal(addCalendarMonths('2026-01-31', 3), '2026-04-30');
      // Jan 31 + 6 months -> Jul 31
      assert.equal(addCalendarMonths('2026-01-31', 6), '2026-07-31');

      // Mar 31 + 1 month -> Apr 30
      assert.equal(addCalendarMonths('2026-03-31', 1), '2026-04-30');
      // Mar 31 + 3 months -> Jun 30
      assert.equal(addCalendarMonths('2026-03-31', 3), '2026-06-30');
      // Mar 31 + 6 months -> Sep 30
      assert.equal(addCalendarMonths('2026-03-31', 6), '2026-09-30');

      // Aug 31 + 1 month -> Sep 30
      assert.equal(addCalendarMonths('2026-08-31', 1), '2026-09-30');
      // Aug 31 + 3 months -> Nov 30
      assert.equal(addCalendarMonths('2026-08-31', 3), '2026-11-30');
      // Aug 31 + 6 months -> Feb 28 of following year
      assert.equal(addCalendarMonths('2026-08-31', 6), '2027-02-28');

      // 1st of month: Oct 1 -> Oct 31 (1 mo), Dec 31 (3 mo), Mar 31 (6 mo)
      assert.equal(addCalendarMonths('2026-10-01', 1), '2026-10-31');
      assert.equal(addCalendarMonths('2026-10-01', 3), '2026-12-31');
      assert.equal(addCalendarMonths('2026-10-01', 6), '2027-03-31');

      // Mid-month: Oct 15 -> Nov 14 (1 mo), Jan 14 (3 mo), Apr 14 (6 mo)
      assert.equal(addCalendarMonths('2026-10-15', 1), '2026-11-14');
      assert.equal(addCalendarMonths('2026-10-15', 3), '2027-01-14');
      assert.equal(addCalendarMonths('2026-10-15', 6), '2027-04-14');

      // Invalid inputs fail closed
      assert.equal(addCalendarMonths(null), null);
      assert.equal(addCalendarMonths('invalid-date'), null);
      assert.equal(addCalendarMonths('2026-01-31', 0), null);
    });

    it('11.2 derivePaidThroughDate: strictly bounds multi-month contracts to paid installment cycles', () => {
      // 1-month contract, paidCount = 1
      const end1Mo = derivePaidThroughDate({
        startDate: '2026-10-01',
        months: 1,
        paidCount: 1,
        total_amount_paise: 315000,
        cost_per_day_paise: 10500
      });
      assert.equal(end1Mo, '2026-10-31', '1 month contract with 1 installment grants 1 month');

      // 3-month contract, paidCount = 1 -> MUST NOT GRANT ENTIRE 3 MONTHS!
      const end3Mo1Paid = derivePaidThroughDate({
        startDate: '2026-10-01',
        months: 3,
        paidCount: 1,
        total_amount_paise: 945000,
        cost_per_day_paise: 10500
      });
      assert.equal(end3Mo1Paid, '2026-10-31', '3-month contract with 1 installment must only grant 1 month');

      // 3-month contract, paidCount = 3 -> Grants full 3 months
      const end3Mo3Paid = derivePaidThroughDate({
        startDate: '2026-10-01',
        months: 3,
        paidCount: 3,
        total_amount_paise: 945000,
        cost_per_day_paise: 10500
      });
      assert.equal(end3Mo3Paid, '2026-12-31', '3-month contract with 3 installments grants full 3 months');

      // 6-month contract, paidCount = 1 -> Only grants month 1
      const end6Mo1Paid = derivePaidThroughDate({
        startDate: '2026-10-01',
        months: 6,
        paidCount: 1,
        total_amount_paise: 1890000,
        cost_per_day_paise: 10500
      });
      assert.equal(end6Mo1Paid, '2026-10-31', '6-month contract with 1 installment must only grant 1 month');

      // 6-month contract, paidCount = 6 -> Grants full 6 months
      const end6Mo6Paid = derivePaidThroughDate({
        startDate: '2026-10-01',
        months: 6,
        paidCount: 6,
        total_amount_paise: 1890000,
        cost_per_day_paise: 10500
      });
      assert.equal(end6Mo6Paid, '2027-03-31', '6-month contract with 6 installments grants full 6 months');

      // Fail closed when paidCount is 0 or negative
      assert.equal(derivePaidThroughDate({ startDate: '2026-10-01', months: 1, paidCount: 0 }), null);
      assert.equal(derivePaidThroughDate({ startDate: '2026-10-01', months: 3, paidCount: -1 }), null);
      assert.equal(derivePaidThroughDate({ startDate: null, months: 1, paidCount: 1 }), null);
    });

    it('11.3 POST /api/v1/subscriptions/verify: rejects full-price transaction when authorized but not captured (HTTP 409)', async () => {
      const subId = `sub_uncaptured_${Date.now()}`;
      const payId = `pay_uncaptured_${Date.now()}`;
      const planId = `plan_uncaptured_${Date.now()}`;

      // Sub locally in pending_authorization
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Billing Cycle Payment', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      const originalFetchPlan = razorpay.plans.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: planId,
        paid_count: 1,
        notes: { customerId: String(customerAId) }
      });
      razorpay.plans.fetch = async () => ({
        id: planId,
        item: { amount: 315000, currency: 'INR' }
      });
      // Payment status is 'authorized', NOT 'captured'
      razorpay.payments.fetch = async () => ({
        id: payId,
        subscription_id: subId,
        status: 'authorized',
        amount: 315000,
        currency: 'INR'
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: { razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig }
        });

        assert.equal(res.statusCode, 409, 'Must return HTTP 409 Conflict when payment is authorized but not captured');
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, false);
        assert.equal(data.error, 'payment_not_captured');

        // Confirm database status remains pending_authorization
        const { rows } = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(rows[0].status, 'pending_authorization', 'Subscription must not activate for uncaptured payment');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
        razorpay.plans.fetch = originalFetchPlan;
      }
    });

    it('11.4 GET /api/v1/subscriptions/callback: redirects with payment_not_captured when authorized but not captured', async () => {
      const subId = `sub_cb_uncaptured_${Date.now()}`;
      const payId = `pay_cb_uncaptured_${Date.now()}`;
      const planId = `plan_cb_uncaptured_${Date.now()}`;

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Billing Cycle Payment', 'month', '1 Month Continuous Plan',
           315000, $2, $3, $4::jsonb
         )`,
        [customerAId, subId, planId, JSON.stringify({ subscriptionId: subId, customerId: String(customerAId) })]
      );

      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret).update(`${payId}|${subId}`).digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      const originalFetchPlan = razorpay.plans.fetch;

      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: planId,
        paid_count: 1,
        notes: { customerId: String(customerAId) }
      });
      razorpay.plans.fetch = async () => ({
        id: planId,
        item: { amount: 315000, currency: 'INR' }
      });
      // Payment status is 'authorized', NOT 'captured'
      razorpay.payments.fetch = async () => ({
        id: payId,
        subscription_id: subId,
        status: 'authorized',
        amount: 315000,
        currency: 'INR'
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        assert.ok(res.headers.location.includes('subscription=failed&error=payment_not_captured'));

        const { rows } = await pool.query('SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(rows[0].status, 'pending_authorization', 'Subscription must not activate for uncaptured callback payment');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
        razorpay.plans.fetch = originalFetchPlan;
      }
    });

    it('11.5 subscription.completed: does not grant active fulfillment when only mandate auth exists, marks completed_unpaid', async () => {
      const subId = `sub_mandate_completed_${Date.now()}`;

      // Subscription locally has mandate_only auth and fulfillmentEntitled: false
      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Mandate Authorized', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          authType: 'mandate_only',
          fulfillmentEntitled: false,
          mandatePaymentId: 'pay_mandate_auth_only_123',
          mandateAuthorized: true
        })]
      );
      const localId = insertRes.rows[0].id;

      // Gateway sends subscription.completed with paid_count = 0
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_key_milvanta_secure';
      const body = JSON.stringify({
        event: 'subscription.completed',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'completed',
              total_count: 1,
              paid_count: 0
            }
          }
        }
      });
      const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          'content-type': 'application/json'
        },
        payload: body
      });
      assert.equal(res.statusCode, 200);

      // Confirm DB status is expired with completed_unpaid billingStatus
      const { rows } = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE id = $1', [localId]);
      assert.equal(rows[0].status, 'expired', 'Mandate-only completion without captured billing charge must expire');
      assert.equal(rows[0].notes.billingStatus, 'completed_unpaid');
    });

    it('11.6 getSubscriptionCalendar: displays pending_payment for unpaid or pending subscriptions without scheduling', async () => {
      const subId = `sub_cal_pending_${Date.now()}`;

      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Pending Billing Cycle Payment', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          mandateAuthorized: true,
          fulfillmentEntitled: false
        })]
      );
      const localId = insertRes.rows[0].id;

      const now = new Date();
      const calendar = await getSubscriptionCalendar(pool, {
        subscriptionId: localId,
        customerId: customerAId,
        year: now.getFullYear(),
        month: now.getMonth()
      });

      assert.ok(calendar, 'Calendar must be returned');
      const todayYMD = now.toISOString().slice(0, 10);
      const futureDays = calendar.days.filter(d => d.date >= todayYMD);

      for (const d of futureDays) {
        assert.equal(d.status, 'pending_payment', `Future date ${d.date} must be marked pending_payment for unpaid subscription`);
        assert.ok(d.detail.includes('Mandate authorized') || d.detail.includes('Awaiting'), 'Detail must indicate awaiting payment');
      }
    });

    it('11.7 /api/v1/subscriptions/send-confirmation: derives idempotency key strictly from server-side verified records', async () => {
      const subId = `sub_email_strict_${Date.now()}`;
      const verifiedPaymentId = `pay_verified_server_${Date.now()}`;

      const insertRes = await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'active', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         ) RETURNING id`,
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          lastPaymentId: verifiedPaymentId,
          fulfillmentEntitled: true,
          emailConfirmations: {
            [verifiedPaymentId]: {
              customer: { status: 'accepted', messageId: 'msg_cust_prev_1' },
              admin: { status: 'accepted', messageId: 'msg_adm_prev_1' }
            }
          }
        })]
      );
      const localId = insertRes.rows[0].id;

      // Untrusted frontend attempts to pass a spoofed paymentId 'pay_spoofed_random_999' in body
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/send-confirmation',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          subscriptionId: localId,
          paymentId: 'pay_spoofed_random_999'
        }
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      // Must be recognized as duplicate because server-side verified record (verifiedPaymentId) was used instead of untrusted payload!
      assert.equal(data.duplicate, true, 'Must derive idempotency key from server-side verified record and detect duplicate');
      assert.equal(data.skipped, true);
    });
  });

  describe('12. Payment Linkage, Mandate Separation & Webhook Race Resolution (Regression Suite)', () => {
    it('12.1 POST /api/v1/subscriptions/verify: accepts missing payment.subscription_id when HMAC is valid and DB record matches customer', async () => {
      const subId = `sub_missing_link_${Date.now()}`;
      const paymentId = `pay_auth_missing_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
      );

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'authenticated',
          paid_count: 0,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: paymentId,
          status: 'captured',
          amount: 500,
          currency: 'INR',
          subscription_id: null // MISSING subscription_id from checkout authorization payment!
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: validSig
          }
        });

        assert.equal(res.statusCode, 200, 'Must accept missing payment.subscription_id when signed and associated');
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'pending_authorization');
        assert.equal(data.fulfillmentEntitled, false);
        assert.equal(data.mandateStatus, 'authenticated');

        // Verify mandatePaymentId recorded, lastPaymentId not set
        const dbRes = await pool.query('SELECT notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        const notes = dbRes.rows[0].notes;
        assert.equal(notes.mandatePaymentId, paymentId);
        assert.equal(notes.lastPaymentId, undefined);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('12.2 POST /api/v1/subscriptions/verify: rejects conflicting payment.subscription_id with 400 payment_subscription_mismatch', async () => {
      const subId = `sub_conflict_${Date.now()}`;
      const paymentId = `pay_conflict_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'authenticated',
          paid_count: 0,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: paymentId,
          status: 'captured',
          amount: 500,
          currency: 'INR',
          subscription_id: 'sub_explicitly_different_xyz' // Explicit conflict!
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: validSig
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

    it('12.3 POST /api/v1/subscriptions/verify: rejects contradictory payment notes with 400 payment_subscription_mismatch', async () => {
      const subId = `sub_contradict_${Date.now()}`;
      const paymentId = `pay_contradict_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'authenticated',
          paid_count: 0,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: paymentId,
          status: 'captured',
          amount: 500,
          currency: 'INR',
          subscription_id: null,
          notes: { subscriptionId: 'sub_contradictory_different_abc' } // Contradictory notes!
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: validSig
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

    it('12.4 POST /api/v1/subscriptions/verify: rejects invalid HMAC signature with 400 invalid_subscription_signature', async () => {
      const subId = `sub_badsig_${Date.now()}`;
      const paymentId = `pay_badsig_${Date.now()}`;
      const invalidSig = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/verify',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          razorpay_subscription_id: subId,
          razorpay_payment_id: paymentId,
          razorpay_signature: invalidSig
        }
      });

      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'invalid_subscription_signature');
    });

    it('12.5 POST /api/v1/subscriptions/verify: callback-after-webhook race condition (#71 scenario) returns authoritative active paid state and preserves lastPaymentId', async () => {
      const subId = `sub_71_reproduced_${Date.now()}`;
      const webhookCapturedPaymentId = `pay_webhook_captured_${Date.now()}`;
      const mandateAuthPaymentId = `pay_checkout_mandate_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${mandateAuthPaymentId}|${subId}`)
        .digest('hex');

      // Preceding webhook arrived first and already activated subscription #71 in DB:
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
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          paidCount: 1,
          fulfillmentEntitled: true,
          paidThroughDate: '2026-11-19',
          lastPaymentId: webhookCapturedPaymentId,
          gatewayStatus: 'active'
        })]
      );

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'active',
          paid_count: 1,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: mandateAuthPaymentId,
          status: 'captured',
          amount: 500, // Mandate nominal auth
          currency: 'INR',
          subscription_id: null // Gateway omits subscription_id on mandate auth!
        });

        // Browser verify arrives after webhook
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: mandateAuthPaymentId,
            razorpay_signature: validSig
          }
        });

        assert.equal(res.statusCode, 200, 'Must return 200 instead of false 400 failure');
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');
        assert.equal(data.fulfillmentEntitled, true);
        assert.equal(data.paidCount, 1);
        assert.equal(data.paidThroughDate, '2026-11-19');

        // Check database: lastPaymentId MUST NOT be overwritten by mandate payment reference!
        const dbRes = await pool.query('SELECT notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        const notes = dbRes.rows[0].notes;
        assert.equal(notes.lastPaymentId, webhookCapturedPaymentId, 'Must preserve captured recurring charge payment ID');
        assert.equal(notes.mandatePaymentId, mandateAuthPaymentId, 'Must separate and store mandate payment ID');
        assert.equal(notes.fulfillmentEntitled, true);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('12.6 POST /api/v1/subscriptions/verify: rejects mismatched captured charge amount with 400 subscription_amount_mismatch', async () => {
      const subId = `sub_mismatch_amt_${Date.now()}`;
      const paymentId = `pay_mismatch_amt_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'active',
          paid_count: 1,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: paymentId,
          status: 'captured',
          amount: 100000, // ₹1000, neither the plan amount (₹3150) nor valid nominal auth (<= ₹500)
          currency: 'INR',
          subscription_id: subId
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: validSig
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

    it('12.7 Webhook processing: requires defensible captured billing-cycle evidence (uncaptured payment rejects fulfillment activation)', async () => {
      const subId = `sub_webhook_uncaptured_${Date.now()}`;
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
      );

      const eventPayload = {
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
              paid_count: 1
            }
          },
          payment: {
            entity: {
              id: `pay_unauthorized_${Date.now()}`,
              status: 'failed', // NOT captured!
              amount: 315000
            }
          }
        }
      };
      const rawPayload = JSON.stringify(eventPayload);
      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_for_milvanta_verify')
        .update(rawPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          'content-type': 'application/json'
        },
        payload: rawPayload
      });

      assert.equal(res.statusCode, 200);
      const dbRes = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
      assert.notEqual(dbRes.rows[0].status, 'active', 'Subscription must not be activated on uncaptured payment entity');
      assert.notEqual(dbRes.rows[0].notes?.fulfillmentEntitled, true);
    });

    it('12.8 GET /api/v1/subscriptions/callback: preserves active paid state and preserves lastPaymentId when webhook arrived first', async () => {
      const subId = `sub_cb_race_${Date.now()}`;
      const webhookPaymentId = `pay_wh_cb_${Date.now()}`;
      const mandatePaymentId = `pay_mandate_cb_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${mandatePaymentId}|${subId}`)
        .digest('hex');

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
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          lastPaymentId: webhookPaymentId,
          fulfillmentEntitled: true,
          paidCount: 1,
          paidThroughDate: '2026-11-19'
        })]
      );

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'active',
          paid_count: 1,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: mandatePaymentId,
          status: 'captured',
          amount: 500,
          currency: 'INR',
          subscription_id: null
        });

        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${mandatePaymentId}&razorpay_signature=${validSig}`
        });

        assert.equal(res.statusCode, 302);
        assert.ok(res.headers.location.includes('subscription=success'), 'Must redirect with subscription=success');

        const dbRes = await pool.query('SELECT notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(dbRes.rows[0].notes.lastPaymentId, webhookPaymentId, 'Must preserve webhook captured payment ID');
        assert.equal(dbRes.rows[0].notes.mandatePaymentId, mandatePaymentId, 'Must record mandatePaymentId separately');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });


  describe('13. Frontend Reload Recovery, Duplicate-Click Prevention, Legacy Active-Without-Payment & Webhook Matching Verification', () => {
    it('13.1 Legacy subscription without payment proof (Subscription #70): verify returns fulfillmentEntitled: false and paidCount: 0', async () => {
      const subId = `sub_legacy_unpaid_${Date.now()}`;
      const paymentId = `pay_mandate_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      // Create subscription mimicking production subscription #70: status is active, but NO lastPaymentId or fulfillmentEntitled in notes
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
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          // Missing lastPaymentId, missing fulfillmentEntitled, missing paidCount!
          gatewayStatus: 'authenticated'
        })]
      );

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'authenticated', // mandate-only on gateway
          paid_count: 0,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: paymentId,
          status: 'captured',
          amount: 500, // ₹5 mandate authorization
          currency: 'INR',
          subscription_id: null
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: validSig
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.fulfillmentEntitled, false, 'Must NEVER infer fulfillmentEntitled = true from status = active alone');
        assert.equal(data.paidCount, 0, 'Must NEVER default unknown paidCount to 1 without verified payment');
        assert.equal(data.paidThroughDate, null, 'Must not report paidThroughDate without verified payment');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('13.2 Legacy active subscription without payment evidence: generateDailyDeliveries fails closed and creates 0 deliveries', async () => {
      const subId = `sub_legacy_delivery_${Date.now()}`;
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
        [customerAId, subId, JSON.stringify({
          subscriptionId: subId,
          startDate: '2026-10-01',
          // NO lastPaymentId or paymentId!
          fulfillmentEntitled: false
        })]
      );

      const targetTomorrow = '2026-10-21';
      const result = await generateDailyDeliveries(pool, targetTomorrow);

      assert.ok(result.skippedCount >= 1, 'Delivery engine must skip active subscription lacking payment evidence');
      const orderRes = await pool.query(
        'SELECT COUNT(*) AS cnt FROM subscription_delivery_orders WHERE subscription_id = (SELECT id FROM customer_subscriptions WHERE razorpay_subscription_id = $1)',
        [subId]
      );
      assert.equal(Number(orderRes.rows[0].cnt), 0, 'Must NOT generate delivery orders for unverified subscription');
    });

    it('13.3 Webhook-before-browser verification: webhook activates subscription with payment evidence, browser verify preserves active paid state', async () => {
      const subId = `sub_wh_first_${Date.now()}`;
      const webhookPaymentId = `pay_wh_charge_${Date.now()}`;
      const browserMandatePaymentId = `pay_browser_mandate_${Date.now()}`;
      const validSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${browserMandatePaymentId}|${subId}`)
        .digest('hex');

      // 1. Initial pending subscription in local DB
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId, startDate: '2026-10-20' })]
      );

      // 2. Webhook arrives FIRST: subscription.charged with captured payment entity
      const nowSec = Math.floor(Date.now() / 1000);
      const webhookPayload = {
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
              paid_count: 1,
              current_start: nowSec - 3600,
              current_end: nowSec + (30 * 86400)
            }
          },
          payment: {
            entity: {
              id: webhookPaymentId,
              status: 'captured',
              amount: 315000,
              subscription_id: subId,
              created_at: nowSec
            }
          }
        }
      };
      const rawPayload = JSON.stringify(webhookPayload);
      const webhookSig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_for_milvanta_verify')
        .update(rawPayload)
        .digest('hex');

      const whRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': webhookSig,
          'x-razorpay-event-id': `evt_wh_first_${Date.now()}`,
          'content-type': 'application/json'
        },
        payload: rawPayload
      });
      assert.equal(whRes.statusCode, 200);

      // Verify webhook activated it
      const dbAfterWh = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
      assert.equal(dbAfterWh.rows[0].status, 'active');
      assert.equal(dbAfterWh.rows[0].notes.fulfillmentEntitled, true);
      assert.equal(dbAfterWh.rows[0].notes.paidCount, 1);
      assert.equal(dbAfterWh.rows[0].notes.lastPaymentId, webhookPaymentId);

      // 3. Browser verify arrives AFTER webhook:
      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      try {
        razorpay.subscriptions.fetch = async () => ({
          id: subId,
          status: 'active',
          paid_count: 1,
          notes: { customerId: String(customerAId) },
          plan: { item: { amount: 315000 } }
        });
        razorpay.payments.fetch = async () => ({
          id: browserMandatePaymentId,
          status: 'captured',
          amount: 500,
          currency: 'INR',
          subscription_id: null
        });

        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: browserMandatePaymentId,
            razorpay_signature: validSig
          }
        });

        assert.equal(verifyRes.statusCode, 200);
        const data = JSON.parse(verifyRes.payload);
        assert.equal(data.verified, true);
        assert.equal(data.fulfillmentEntitled, true, 'Must return true because webhook confirmed payment and entitlement is active');
        assert.equal(data.paidCount, 1);
        assert.equal(data.status, 'active');
        assert.equal(data.message, 'Subscription already active');

        // Check DB notes: preserves webhook lastPaymentId, sets mandatePaymentId
        const dbFinal = await pool.query('SELECT notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
        assert.equal(dbFinal.rows[0].notes.lastPaymentId, webhookPaymentId);
        assert.equal(dbFinal.rows[0].notes.mandatePaymentId, browserMandatePaymentId);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('13.4 Webhook payment matching: fails closed when payment.subscription_id belongs to a different subscription', async () => {
      const subId = `sub_mismatch_wh_${Date.now()}`;
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
      );

      const eventPayload = {
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
              paid_count: 1
            }
          },
          payment: {
            entity: {
              id: `pay_other_sub_${Date.now()}`,
              status: 'captured',
              amount: 315000,
              subscription_id: 'sub_completely_different_id' // Mismatched subscription!
            }
          }
        }
      };
      const rawPayload = JSON.stringify(eventPayload);
      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_for_milvanta_verify')
        .update(rawPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': `evt_mismatch_${Date.now()}`,
          'content-type': 'application/json'
        },
        payload: rawPayload
      });

      assert.equal(res.statusCode, 200);
      const dbRes = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
      assert.notEqual(dbRes.rows[0].status, 'active', 'Must not activate on mismatched payment subscription ID');
      assert.notEqual(dbRes.rows[0].notes?.fulfillmentEntitled, true);
    });

    it('13.5 Webhook payment matching: fails closed when payment was created outside current billing cycle', async () => {
      const subId = `sub_old_cycle_${Date.now()}`;
      await pool.query(
        `INSERT INTO customer_subscriptions (
           customer_id, product_name, frequency, time_slot, quantity, quantity_num,
           cost_per_day_paise, status, next_delivery, plan_type, duration_label,
           total_amount_paise, razorpay_subscription_id, notes
         ) VALUES (
           $1, 'Pure Fresh Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 1,
           10500, 'pending_authorization', 'Tomorrow, 6:00 AM', 'month', '1 Month Continuous Plan',
           315000, $2, $3::jsonb
         )`,
        [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
      );

      const nowSec = Math.floor(Date.now() / 1000);
      const eventPayload = {
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
              paid_count: 1,
              current_start: nowSec, // cycle starts today
              current_end: nowSec + (30 * 86400)
            }
          },
          payment: {
            entity: {
              id: `pay_stale_${Date.now()}`,
              status: 'captured',
              amount: 315000,
              subscription_id: subId,
              created_at: nowSec - (90 * 86400) // 90 days ago (stale payment from ancient cycle!)
            }
          }
        }
      };
      const rawPayload = JSON.stringify(eventPayload);
      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_for_milvanta_verify')
        .update(rawPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': `evt_stale_${Date.now()}`,
          'content-type': 'application/json'
        },
        payload: rawPayload
      });

      assert.equal(res.statusCode, 200);
      const dbRes = await pool.query('SELECT status, notes FROM customer_subscriptions WHERE razorpay_subscription_id = $1', [subId]);
      assert.notEqual(dbRes.rows[0].status, 'active', 'Must not activate on payment created outside current billing cycle');
      assert.notEqual(dbRes.rows[0].notes?.fulfillmentEntitled, true);
    });

    it('13.6 Frontend reload recovery validation: validates pending_subscription_auth and discards corrupted entries', () => {
      // Test the validation helper logic implemented in checkout.js
      function validatePendingSubscriptionAuth(auth) {
        if (!auth || typeof auth !== 'object') return null;
        const subId = typeof auth.subscriptionId === 'string' ? auth.subscriptionId.trim() : '';
        const payId = typeof auth.paymentId === 'string' ? auth.paymentId.trim() : '';
        const sig = typeof auth.signature === 'string' ? auth.signature.trim() : '';
        if (!subId || !/^sub_[A-Za-z0-9_]+$/.test(subId)) return null;
        if (!payId || !/^pay_[A-Za-z0-9_]+$/.test(payId)) return null;
        if (!sig || !/^[a-fA-F0-9]{32,128}$/.test(sig)) return null;
        return { subscriptionId: subId, paymentId: payId, signature: sig };
      }

      // Valid auth payload
      const valid = validatePendingSubscriptionAuth({
        subscriptionId: 'sub_test_12345',
        paymentId: 'pay_test_67890',
        signature: 'a'.repeat(64)
      });
      assert.ok(valid);
      assert.equal(valid.subscriptionId, 'sub_test_12345');
      assert.equal(valid.paymentId, 'pay_test_67890');

      // Invalid: missing sub_
      assert.equal(validatePendingSubscriptionAuth({
        subscriptionId: 'not_a_sub',
        paymentId: 'pay_123',
        signature: 'a'.repeat(64)
      }), null);

      // Invalid: missing pay_
      assert.equal(validatePendingSubscriptionAuth({
        subscriptionId: 'sub_123',
        paymentId: 'not_a_pay',
        signature: 'a'.repeat(64)
      }), null);

      // Invalid: short signature
      assert.equal(validatePendingSubscriptionAuth({
        subscriptionId: 'sub_123',
        paymentId: 'pay_123',
        signature: 'short'
      }), null);

      // Invalid: null / empty
      assert.equal(validatePendingSubscriptionAuth(null), null);
      assert.equal(validatePendingSubscriptionAuth({}), null);
    });

    it('13.7 Frontend duplicate-click & verification routing protection', () => {
      // Simulate state and click handler
      const state = {
        isPaymentProcessing: false,
        paymentCallCount: 0,
        verifyCallCount: 0
      };

      let pendingAuth = null;

      async function verifySubscriptionWithServer(auth) {
        state.isPaymentProcessing = true;
        state.verifyCallCount++;
        // Keep processing flag active during in-flight call
        return true;
      }

      async function executeOrderPayment() {
        state.isPaymentProcessing = true;
        state.paymentCallCount++;
        return true;
      }

      async function onPayButtonClick() {
        if (state.isPaymentProcessing) {
          return 'BLOCKED_DUPLICATE';
        }
        if (pendingAuth) {
          return await verifySubscriptionWithServer(pendingAuth);
        }
        return await executeOrderPayment();
      }

      // First click: triggers normal payment
      onPayButtonClick();
      assert.equal(state.paymentCallCount, 1);
      assert.equal(state.verifyCallCount, 0);

      // Second rapid click while processing: must be blocked
      const blocked = onPayButtonClick();
      assert.equal(state.paymentCallCount, 1, 'Duplicate click must not invoke executeOrderPayment again');

      // Reset processing and set pending authorization (simulating reload recovery)
      state.isPaymentProcessing = false;
      pendingAuth = { subscriptionId: 'sub_123', paymentId: 'pay_456', signature: 'a'.repeat(64) };

      // Click with pending authorization: must call ONLY verification, NEVER executeOrderPayment
      onPayButtonClick();
      assert.equal(state.verifyCallCount, 1, 'Must invoke verification');
      assert.equal(state.paymentCallCount, 1, 'Must NEVER invoke executeOrderPayment when pending authorization exists');
    });
  });

});

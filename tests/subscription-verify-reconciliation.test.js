import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_verify_reconciliation_jwt_secret_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_verify';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_milvanta_verify_hmac';

const { app, pool, razorpay } = await import('../src/server.js');

describe('Milvanta Subscription Verification & Schema Reconciliation Suite', () => {
  let customerAId;
  let customerBId;
  let tokenA;
  let tokenB;

  const testEmailA = `test_alpha_${Date.now()}_${Math.floor(Math.random() * 10000)}@milvanta.in`;
  const testPhoneA = '9' + Math.floor(100000000 + Math.random() * 900000000);
  const testEmailB = `test_beta_${Date.now()}_${Math.floor(Math.random() * 10000)}@milvanta.in`;
  const testPhoneB = '9' + Math.floor(100000000 + Math.random() * 900000000);

  before(async () => {
    if (pool) {
      try {
        // Create Customer A
        const resA = await pool.query(
          `INSERT INTO customers (full_name, email, phone, password_salt, password_hash)
           VALUES ('Customer Alpha', $1, $2, 'salt', 'hash')
           RETURNING id`,
          [testEmailA, testPhoneA]
        );
        customerAId = resA.rows[0].id;

        // Create Customer B
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

        // Create valid sessions in customer_sessions
        const tokenHashA = crypto.createHash('sha256').update(tokenA).digest('hex');
        const tokenHashB = crypto.createHash('sha256').update(tokenB).digest('hex');

        await pool.query(
          `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
           VALUES 
             ($1, $2, 'csrf_a', NOW() + INTERVAL '1 day'),
             ($3, $4, 'csrf_b', NOW() + INTERVAL '1 day')`,
          [tokenHashA, customerAId, tokenHashB, customerBId]
        );
      } catch (err) {
        console.warn('[Test Setup Warning] Could not seed test customers in pool:', err.message);
      }
    }

    if (!customerAId) {
      customerAId = 101;
      tokenA = app.jwt.sign({ sub: String(customerAId), email: testEmailA });
    }
    if (!customerBId) {
      customerBId = 102;
      tokenB = app.jwt.sign({ sub: String(customerBId), email: testEmailB });
    }
  });

  after(async () => {
    if (pool && customerAId && customerBId) {
      try {
        await pool.query('DELETE FROM customer_subscriptions WHERE customer_id IN ($1, $2)', [customerAId, customerBId]);
        await pool.query('DELETE FROM customer_sessions WHERE customer_id IN ($1, $2)', [customerAId, customerBId]);
        await pool.query('DELETE FROM customers WHERE id IN ($1, $2)', [customerAId, customerBId]);
      } catch (e) {
        // cleanup ignore
      }
    }
  });

  // =========================================================================
  // 1. PostgreSQL Schema Reproductions
  // =========================================================================
  describe('1. PostgreSQL Schema Error Reproductions & Verifications', () => {
    it('reproduces error 42703 if querying non-existent cs.start_date on customer_subscriptions', async () => {
      if (!pool) return;
      let errorThrown = null;
      try {
        await pool.query(`
          SELECT cs.id, cs.customer_id, cs.status, cs.product_name, cs.start_date
          FROM customer_subscriptions cs
        `);
      } catch (err) {
        errorThrown = err;
      }
      assert.ok(errorThrown, 'Querying cs.start_date must throw undefined_column error');
      assert.equal(errorThrown.code, '42703', 'Error code must be 42703 (undefined_column)');
      assert.match(errorThrown.message, /column cs\.start_date does not exist/i);
    });

    it('succeeds cleanly when querying actual schema columns on customer_subscriptions', async () => {
      if (!pool) return;
      const res = await pool.query(`
        SELECT cs.id, cs.customer_id, cs.status, cs.product_name, cs.quantity,
               cs.frequency, cs.time_slot, cs.cost_per_day_paise, cs.plan_type, cs.duration_label,
               cs.total_amount_paise, cs.notes, cs.next_delivery, cs.razorpay_subscription_id, cs.created_at
        FROM customer_subscriptions cs
      `);
      assert.ok(Array.isArray(res.rows));
    });

    it('reproduces error 42703 if querying non-existent co.total_amount_paise or co.delivery_address on customer_orders', async () => {
      if (!pool) return;
      let errorThrown = null;
      try {
        await pool.query(`
          SELECT co.id, co.order_number, co.total_amount_paise, co.delivery_address
          FROM customer_orders co
        `);
      } catch (err) {
        errorThrown = err;
      }
      assert.ok(errorThrown, 'Querying non-existent order columns must throw');
      assert.equal(errorThrown.code, '42703', 'Error code must be 42703 (undefined_column)');
      assert.match(errorThrown.message, /column co\.total_amount_paise does not exist/i);
    });

    it('succeeds cleanly when querying actual schema columns (total_paise, address) on customer_orders', async () => {
      if (!pool) return;
      const res = await pool.query(`
        SELECT co.id, co.order_number, co.total_paise, co.address, co.customer_id,
               c.phone, c.sms_notifications_enabled
        FROM customer_orders co
        LEFT JOIN customers c ON c.id = co.customer_id
      `);
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
          razorpay_signature: 'dummy_sig'
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
          // Missing payment_id and signature
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
          razorpay_subscription_id: 'sub_test_forged',
          razorpay_payment_id: 'pay_test_forged',
          razorpay_signature: 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        }
      });
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'invalid_subscription_signature');
      assert.equal(data.verified, false);
    });

    it('rejects verification if gateway status is not active/captured with 409', async () => {
      const subId = `sub_uncaptured_${Date.now()}`;
      const paymentId = `pay_uncaptured_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const signature = crypto.createHmac('sha256', secret)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      // Mock gateway returning pending/failed payment
      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({ id: subId, status: 'pending', notes: {} });
      razorpay.payments.fetch = async () => ({ id: paymentId, status: 'failed' });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, false);
        assert.equal(data.error, 'subscription_payment_state_not_captured');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 3. Subscription Activation & Authoritative Start Date Derivation
  // =========================================================================
  describe('3. Subscription Activation & Authoritative Start Date Derivation', () => {
    const subId = `sub_active_test_${Date.now()}`;
    const paymentId = `pay_active_test_${Date.now()}`;
    let signature;

    before(() => {
      const secret = process.env.RAZORPAY_KEY_SECRET;
      signature = crypto.createHmac('sha256', secret)
        .update(`${paymentId}|${subId}`)
        .digest('hex');
    });

    it('moves subscription from pending_authorization to active upon valid verification', async () => {
      let createdSubId;
      if (pool && customerAId) {
        const insertRes = await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'pending_authorization', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)', $2,
            $3::jsonb
          ) RETURNING id`,
          [
            customerAId,
            subId,
            JSON.stringify({ subscriptionId: subId, razorpay_subscription_id: subId })
          ]
        );
        createdSubId = insertRes.rows[0].id;
      }

      // Mock gateway returning authenticated subscription and captured payment
      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        start_at: 1776556800,
        notes: { customerId: String(customerAId), productName: 'Pure Fresh Cow Milk', size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: paymentId,
        status: 'captured'
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.subscriptionId, subId);
        assert.equal(data.paymentId, paymentId);
        assert.equal(data.status, 'active');
        assert.ok(data.startDate, 'startDate must be provided authoritatively');

        if (pool && createdSubId) {
          const check = await pool.query(
            'SELECT status, razorpay_subscription_id, notes FROM customer_subscriptions WHERE id = $1',
            [createdSubId]
          );
          assert.equal(check.rows[0].status, 'active');
          assert.equal(check.rows[0].razorpay_subscription_id, subId);
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('idempotently reconciles already-active subscription without creating duplicate rows', async () => {
      let initialCount = 0;
      if (pool && customerAId) {
        const countRes = await pool.query(
          'SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id = $1',
          [customerAId]
        );
        initialCount = Number(countRes.rows[0].count);
      }

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        start_at: 1776556800,
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: paymentId,
        status: 'captured'
      });

      try {
        // Call verify second time
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: subId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');

        if (pool && customerAId) {
          const finalCountRes = await pool.query(
            'SELECT COUNT(*) FROM customer_subscriptions WHERE customer_id = $1',
            [customerAId]
          );
          const finalCount = Number(finalCountRes.rows[0].count);
          assert.equal(finalCount, initialCount, 'Subscription count must NOT increase on duplicate verify');
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 4. Reconciliation of Missing Local Record & Customer Boundary Check
  // =========================================================================
  describe('4. External Gateway Reconciliation & Customer Ownership Security', () => {
    it('safely reconciles authorized gateway subscription not yet in local DB', async () => {
      const freshSubId = `sub_external_${Date.now()}`;
      const freshPaymentId = `pay_external_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const signature = crypto.createHmac('sha256', secret)
        .update(`${freshPaymentId}|${freshSubId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: freshSubId,
        status: 'active',
        plan_id: 'plan_ext_123',
        notes: {
          customerId: String(customerAId),
          productName: 'Pure Buffalo Milk',
          size: '1 Litre',
          dailyRate: '125',
          totalAmountPaise: '375000'
        }
      });
      razorpay.payments.fetch = async () => ({
        id: freshPaymentId,
        status: 'captured'
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: freshSubId,
            razorpay_payment_id: freshPaymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, true);
        assert.equal(data.status, 'active');
        assert.equal(data.subscriptionId, freshSubId);

        if (pool && customerAId) {
          const check = await pool.query(
            'SELECT * FROM customer_subscriptions WHERE razorpay_subscription_id = $1',
            [freshSubId]
          );
          assert.equal(check.rows.length, 1);
          assert.equal(Number(check.rows[0].customer_id), Number(customerAId));
          assert.equal(check.rows[0].status, 'active');
          assert.equal(check.rows[0].product_name, 'Pure Buffalo Milk');
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('rejects verification if gateway subscription belongs to a different customer with 403', async () => {
      const crossSubId = `sub_cross_${Date.now()}`;
      const crossPaymentId = `pay_cross_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const signature = crypto.createHmac('sha256', secret)
        .update(`${crossPaymentId}|${crossSubId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      // Gateway metadata has customerId for Customer A
      razorpay.subscriptions.fetch = async () => ({
        id: crossSubId,
        status: 'active',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: crossPaymentId,
        status: 'captured'
      });

      try {
        // Customer B attempts to verify Customer A's subscription
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenB}` },
          payload: {
            razorpay_subscription_id: crossSubId,
            razorpay_payment_id: crossPaymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(res.statusCode, 403);
        const data = JSON.parse(res.payload);
        assert.equal(data.verified, false);
        assert.equal(data.error, 'subscription_forbidden');
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 5. POST /api/v1/subscriptions Idempotent Payment Activation
  // =========================================================================
  describe('5. POST /api/v1/subscriptions Idempotency & Payment Protection', () => {
    it('returns 200 with active subscription when called repeatedly with same paymentId', async () => {
      const paymentId = `pay_idempotent_${Date.now()}`;

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'active', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)',
            $2::jsonb
          )`,
          [
            customerAId,
            JSON.stringify({ paymentId, payment_id: paymentId, subscriptionId: 'sub_test_dup' })
          ]
        );
      }

      // Customer A calls POST /api/v1/subscriptions with same paymentId
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          productName: 'Pure Fresh Cow Milk',
          quantity: '1 Litre',
          paymentId: paymentId
        }
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.ok(data.subscription);
      assert.match(data.message, /already active/i);
    });

    it('rejects if a different customer attempts to use an already-used paymentId with 409', async () => {
      const paymentId = `pay_cross_reuse_${Date.now()}`;

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'active', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)',
            $2::jsonb
          )`,
          [
            customerAId,
            JSON.stringify({ paymentId })
          ]
        );
      }

      // Customer B attempts to use Customer A's paymentId
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${tokenB}` },
        payload: {
          productName: 'Pure Fresh Cow Milk',
          quantity: '1 Litre',
          paymentId: paymentId
        }
      });

      assert.equal(res.statusCode, 409);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'payment_already_used');
    });
  });
});


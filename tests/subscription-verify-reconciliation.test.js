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
    // Requirement 8: Ensure integration tests use only disposable or staging PostgreSQL, never production
    const rawDbUrl = (
      process.env.DATABASE_URL ||
      process.env.INTERNAL_DATABASE_URL ||
      process.env.EXTERNAL_DATABASE_URL ||
      process.env.POSTGRES_URL || ''
    ).trim();

    if (rawDbUrl) {
      const isProductionDb = /milvanta-db\.internal|production-db|prod-postgres/i.test(rawDbUrl) &&
        !/staging|test|dev/i.test(rawDbUrl);
      if (isProductionDb || process.env.NODE_ENV === 'production') {
        throw new Error('SAFETY BLOCK: Integration tests must not run against production database.');
      }
    }

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
        await pool.query('DELETE FROM payment_orders WHERE customer_order_id IN (SELECT id FROM customer_orders WHERE customer_id IN ($1, $2))', [customerAId, customerBId]);
        await pool.query('DELETE FROM customer_orders WHERE customer_id IN ($1, $2)', [customerAId, customerBId]);
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

    // Requirement 3: Linkage mismatch test
    it('rejects verification if payment is linked to a different subscription ID with 400', async () => {
      const subId = `sub_target_${Date.now()}`;
      const paymentId = `pay_mismatch_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const signature = crypto.createHmac('sha256', secret)
        .update(`${paymentId}|${subId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({ id: subId, status: 'active', notes: { customerId: String(customerAId) } });
      razorpay.payments.fetch = async () => ({
        id: paymentId,
        status: 'captured',
        currency: 'INR',
        subscription_id: 'sub_completely_different_id' // Mismatched!
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

        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_subscription_mismatch');
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
            plan_type, duration_label, razorpay_subscription_id, razorpay_plan_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'pending_authorization', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)', $2, 'plan_valid_123',
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

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: 'plan_valid_123',
        plan: { item: { amount: 315000 } },
        start_at: 1776556800,
        notes: { customerId: String(customerAId), productName: 'Pure Fresh Cow Milk', size: '1 Litre' }
      });
      razorpay.payments.fetch = async () => ({
        id: paymentId,
        status: 'captured',
        currency: 'INR',
        amount: 315000,
        subscription_id: subId
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

    // Requirement 6: Duplicate verification idempotent without duplicate emails/notifications
    it('idempotently handles duplicate verification without duplicate emails or notifications', async () => {
      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: subId,
        status: 'active',
        plan_id: 'plan_valid_123',
        plan: { item: { amount: 315000 } },
        start_at: 1776556800,
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: paymentId,
        status: 'captured',
        currency: 'INR',
        amount: 315000,
        subscription_id: subId
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
        assert.equal(data.status, 'active');
        assert.match(data.message, /already active/i);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    // Requirement 1: Prevent changing cancelled, paused or expired subscriptions back to active
    it('Requirement 1: rejects verification on cancelled subscriptions with 409 and does not reactivate', async () => {
      const cancelledSubId = `sub_cancelled_${Date.now()}`;
      const cancelledPayId = `pay_cancelled_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${cancelledPayId}|${cancelledSubId}`)
        .digest('hex');

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'cancelled', 'Cancelled',
            'month', '1 Month (30 Days)', $2,
            $3::jsonb
          )`,
          [
            customerAId,
            cancelledSubId,
            JSON.stringify({ subscriptionId: cancelledSubId })
          ]
        );
      }

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: cancelledSubId,
        status: 'active',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: cancelledPayId,
        status: 'captured',
        currency: 'INR',
        subscription_id: cancelledSubId
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: cancelledSubId,
            razorpay_payment_id: cancelledPayId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');
        assert.equal(data.status, 'cancelled');

        if (pool && customerAId) {
          const check = await pool.query(
            'SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1',
            [cancelledSubId]
          );
          assert.equal(check.rows[0].status, 'cancelled', 'Status must remain cancelled and not be reactivated');
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 1: rejects verification on paused subscriptions with 409 and does not reactivate', async () => {
      const pausedSubId = `sub_paused_${Date.now()}`;
      const pausedPayId = `pay_paused_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${pausedPayId}|${pausedSubId}`)
        .digest('hex');

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'paused', 'On Hold (Paused)',
            'month', '1 Month (30 Days)', $2,
            $3::jsonb
          )`,
          [
            customerAId,
            pausedSubId,
            JSON.stringify({ subscriptionId: pausedSubId })
          ]
        );
      }

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: pausedSubId,
        status: 'active',
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: pausedPayId,
        status: 'captured',
        currency: 'INR',
        subscription_id: pausedSubId
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: pausedSubId,
            razorpay_payment_id: pausedPayId,
            razorpay_signature: sig
          }
        });

        assert.equal(res.statusCode, 409);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'subscription_state_conflict');
        assert.equal(data.status, 'paused');

        if (pool && customerAId) {
          const check = await pool.query(
            'SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1',
            [pausedSubId]
          );
          assert.equal(check.rows[0].status, 'paused', 'Status must remain paused');
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });

  // =========================================================================
  // 4. Trustworthy Reconciliation & Customer Boundary (Requirement 2 & 3)
  // =========================================================================
  describe('4. Trustworthy Reconciliation & Ownership Verification (Requirements 2 & 3)', () => {
    it('Requirement 2: rejects automatic reconciliation if gateway notes lack customerId with 403', async () => {
      const unlinkedSubId = `sub_unlinked_${Date.now()}`;
      const unlinkedPayId = `pay_unlinked_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${unlinkedPayId}|${unlinkedSubId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      // Gateway metadata has NO customerId
      razorpay.subscriptions.fetch = async () => ({
        id: unlinkedSubId,
        status: 'active',
        plan_id: 'plan_123',
        notes: {
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre'
          // No customerId!
        }
      });
      razorpay.payments.fetch = async () => ({
        id: unlinkedPayId,
        status: 'captured',
        currency: 'INR',
        subscription_id: unlinkedSubId
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: unlinkedSubId,
            razorpay_payment_id: unlinkedPayId,
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
      const contraSubId = `sub_contra_${Date.now()}`;
      const contraPayId = `pay_contra_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${contraPayId}|${contraSubId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: contraSubId,
        status: 'active',
        plan_id: 'plan_123',
        notes: {
          customerId: String(customerAId),
          customerPhone: '9999999999' // Contradicts customer A phone!
        }
      });
      razorpay.payments.fetch = async () => ({
        id: contraPayId,
        status: 'captured',
        currency: 'INR',
        subscription_id: contraSubId
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: contraSubId,
            razorpay_payment_id: contraPayId,
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
      const draftSubId = `sub_draft_plan_${Date.now()}`;
      const draftPayId = `pay_draft_plan_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${draftPayId}|${draftSubId}`)
        .digest('hex');

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, razorpay_plan_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'pending_authorization', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)', $2, 'plan_expected_xyz',
            $3::jsonb
          )`,
          [customerAId, draftSubId, JSON.stringify({ subscriptionId: draftSubId })]
        );
      }

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: draftSubId,
        status: 'active',
        plan_id: 'plan_tampered_different', // Does not match plan_expected_xyz!
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: draftPayId,
        status: 'captured',
        currency: 'INR',
        subscription_id: draftSubId
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: draftSubId,
            razorpay_payment_id: draftPayId,
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
      const draftAmtSubId = `sub_draft_amt_${Date.now()}`;
      const draftAmtPayId = `pay_draft_amt_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${draftAmtPayId}|${draftAmtSubId}`)
        .digest('hex');

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, razorpay_plan_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'pending_authorization', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)', $2, 'plan_match_123',
            $3::jsonb
          )`,
          [customerAId, draftAmtSubId, JSON.stringify({ subscriptionId: draftAmtSubId })]
        );
      }

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({
        id: draftAmtSubId,
        status: 'active',
        plan_id: 'plan_match_123',
        plan: { item: { amount: 315000 } }, // Expects ₹3150
        notes: { customerId: String(customerAId) }
      });
      razorpay.payments.fetch = async () => ({
        id: draftAmtPayId,
        status: 'captured',
        currency: 'INR',
        amount: 500, // Tampered: only paid ₹5!
        subscription_id: draftAmtSubId
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/subscriptions/verify',
          headers: { Authorization: `Bearer ${tokenA}` },
          payload: {
            razorpay_subscription_id: draftAmtSubId,
            razorpay_payment_id: draftAmtPayId,
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
  // 5. POST /api/v1/subscriptions Payment Reuse Protection (Requirement 4)
  // =========================================================================
  describe('5. POST /api/v1/subscriptions Payment Protection (Requirement 4)', () => {
    it('Requirement 4: rejects using an order payment reference to create a subscription with 400', async () => {
      const orderPaymentId = `pay_order_${Date.now()}`;

      if (pool && customerAId) {
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
      }

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
      const sig = crypto.createHmac('sha256', secret)
        .update(`${payId}|${subId}`)
        .digest('hex');

      const originalFetchSub = razorpay.subscriptions.fetch;
      const originalFetchPay = razorpay.payments.fetch;
      razorpay.subscriptions.fetch = async () => ({ id: subId, status: 'active' });
      razorpay.payments.fetch = async () => ({ id: payId, status: 'failed' }); // Failed payment!

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        const location = res.headers.location;
        assert.match(location, /subscription=failed/);
        assert.match(location, /error=payment_not_authorized/);
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 5: rejects callback if target subscription in DB is cancelled', async () => {
      const subId = `sub_cb_cancelled_${Date.now()}`;
      const payId = `pay_cb_cancelled_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${payId}|${subId}`)
        .digest('hex');

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'cancelled', 'Cancelled',
            'month', '1 Month (30 Days)', $2,
            $3::jsonb
          )`,
          [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
        );
      }

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
        currency: 'INR',
        subscription_id: subId
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        const location = res.headers.location;
        assert.match(location, /subscription=failed/);
        assert.match(location, /error=subscription_state_conflict/);

        if (pool && customerAId) {
          const check = await pool.query(
            'SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1',
            [subId]
          );
          assert.equal(check.rows[0].status, 'cancelled');
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });

    it('Requirement 5: successfully activates pending subscription on valid callback', async () => {
      const subId = `sub_cb_valid_${Date.now()}`;
      const payId = `pay_cb_valid_${Date.now()}`;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const sig = crypto.createHmac('sha256', secret)
        .update(`${payId}|${subId}`)
        .digest('hex');

      if (pool && customerAId) {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, next_delivery,
            plan_type, duration_label, razorpay_subscription_id, notes
          ) VALUES (
            $1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily (Every Morning)',
            10500, 315000, 'pending_authorization', 'Tomorrow, 6:00 AM',
            'month', '1 Month (30 Days)', $2,
            $3::jsonb
          )`,
          [customerAId, subId, JSON.stringify({ subscriptionId: subId })]
        );
      }

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
        currency: 'INR',
        subscription_id: subId
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/subscriptions/callback?razorpay_subscription_id=${subId}&razorpay_payment_id=${payId}&razorpay_signature=${sig}`
        });

        assert.equal(res.statusCode, 302);
        const location = res.headers.location;
        assert.match(location, /subscription=success/);

        if (pool && customerAId) {
          const check = await pool.query(
            'SELECT status FROM customer_subscriptions WHERE razorpay_subscription_id = $1',
            [subId]
          );
          assert.equal(check.rows[0].status, 'active');
        }
      } finally {
        razorpay.subscriptions.fetch = originalFetchSub;
        razorpay.payments.fetch = originalFetchPay;
      }
    });
  });
});

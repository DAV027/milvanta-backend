import {
  testDbConfig,
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import 'dotenv/config';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_test_plan_reuse_jwt_secret_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_plan_reuse_key';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_plan_reuse_hmac';

// Fail closed immediately if test database is not configured
assertTestDatabaseConfigured();

// Initialize isolated disposable test schema BEFORE application pool is created
const setup = await setupDisposableTestSchema();
const pool = setup.pool;
const schemaName = setup.schemaName;

const { app, razorpay, getOrCreateRazorpayPlan } = await import('../src/server.js');
const {
  classifySubscriptionGatewayError,
  standardizeSubscriptionGatewayError
} = await import('../src/razorpaySubscriptionErrors.js');
const { calculateContinuousMonthsDays } = await import('../src/pricing.js');

describe('Razorpay Subscription Creation & Plan Reuse Suite', () => {
  let customerId;
  let customerToken;
  let productId;
  const customerEmail = `sub_plan_test_${Date.now()}@milvanta.in`;
  const customerPhone = '9876543210';

  let capturedPlanParams = [];
  let capturedSubParams = [];
  let fetchedPlanIds = [];

  const originalPlansCreate = razorpay.plans.create;
  const originalPlansFetch = razorpay.plans.fetch;
  const originalSubsCreate = razorpay.subscriptions.create;

  before(async () => {
    // 1. Seed test customer
    const custRes = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at)
       VALUES ('Plan Reuse Customer', $1, $2, 'salt', 'hash', NOW())
       RETURNING id`,
      [customerEmail, customerPhone]
    );
    customerId = custRes.rows[0].id;

    // 2. Generate auth token and session
    customerToken = app.jwt.sign({ sub: String(customerId), email: customerEmail });
    const tokenHash = crypto.createHash('sha256').update(customerToken).digest('hex');
    await pool.query(
      `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
       VALUES ($1, $2, 'csrf_plan_test', NOW() + INTERVAL '1 day')`,
      [tokenHash, customerId]
    );

    // 3. Ensure Pure Fresh Cow Milk exists in products
    let prodRes = await pool.query(
      `SELECT id, name FROM products WHERE active = TRUE AND name ILIKE '%Cow Milk%' LIMIT 1`
    );
    if (prodRes.rows.length === 0) {
      prodRes = await pool.query(
        `INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active)
         VALUES ('Pure Fresh Cow Milk', 'Farm fresh cow milk', 'Milk', 10500, '1 Litre', 'assets/cow-milk.jpg', 100, TRUE)
         RETURNING id, name`
      );
    }
    productId = prodRes.rows[0].id;
  });

  after(async () => {
    razorpay.plans.create = originalPlansCreate;
    razorpay.plans.fetch = originalPlansFetch;
    razorpay.subscriptions.create = originalSubsCreate;
    await cleanupDisposableTestSchema(pool, schemaName);
  });

  beforeEach(async () => {
    capturedPlanParams = [];
    capturedSubParams = [];
    fetchedPlanIds = [];

    // Clear subscriptions between tests to prevent idempotency cache interference
    await pool.query('DELETE FROM customer_subscriptions');

    // Default mock implementations
    razorpay.plans.create = async (params) => {
      capturedPlanParams.push(params);
      return {
        id: `plan_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        ...params
      };
    };

    razorpay.plans.fetch = async (id) => {
      fetchedPlanIds.push(id);
      return {
        id,
        period: 'monthly',
        interval: 1,
        item: {
          currency: 'INR',
          amount: 325500
        }
      };
    };

    razorpay.subscriptions.create = async (params) => {
      capturedSubParams.push(params);
      return {
        id: `sub_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        status: 'created',
        short_url: 'https://rzp.io/i/mockSub',
        ...params
      };
    };
  });

  // =========================================================================
  // 1. Immediate-Start Subscription Payload Correctness
  // =========================================================================
  describe('1. Immediate-Start Subscription Payload Correctness', () => {
    it('passes customer_notify as boolean true and omits empty strings and start_at', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.success, true);
      assert.ok(data.subscriptionId.startsWith('sub_mock_'));
      assert.equal(data.keyId, 'rzp_test_plan_reuse_key');

      // Verify captured subscription parameters sent to Razorpay
      assert.equal(capturedSubParams.length, 1);
      const sub = capturedSubParams[0];

      // CRITICAL: customer_notify must be boolean true, NOT 1
      assert.strictEqual(sub.customer_notify, true, 'customer_notify must strictly be boolean true');

      // total_count must be 1 for 1-month continuous plan
      assert.strictEqual(sub.total_count, 1, 'total_count must be 1');

      // quantity must be 1
      assert.strictEqual(sub.quantity, 1, 'quantity must be 1');

      // start_at must be omitted (undefined) for immediate-start
      assert.strictEqual(sub.start_at, undefined, 'start_at must be omitted for immediate-start subscriptions');

      // notes must contain expected non-empty strings and NEVER empty strings
      assert.ok(sub.notes, 'notes object must be present');
      assert.strictEqual(sub.notes.customerId, String(customerId));
      assert.strictEqual(sub.notes.customerPhone, customerPhone);
      assert.strictEqual(sub.notes.productId, String(productId));
      assert.strictEqual(sub.notes.months, '1');
      assert.strictEqual(sub.notes.days, String(calculateContinuousMonthsDays(0, 1)));
      assert.strictEqual(sub.notes.startOffset, '0');

      // Verify NO empty string values exist in notes
      for (const [key, val] of Object.entries(sub.notes)) {
        assert.notStrictEqual(val, '', `Field notes.${key} must not be an empty string`);
      }
      assert.strictEqual(sub.notes.startDate, undefined, 'startDate should be omitted when startOffset is 0');
    });

    it('omits customerPhone from notes when customer phone is absent without sending empty string', async () => {
      // Create customer with null phone
      const custNoPhone = await pool.query(
        `INSERT INTO customers (full_name, email, password_salt, password_hash, phone_verified_at)
         VALUES ('No Phone Customer', 'nophone_${Date.now()}@milvanta.in', 'salt', 'hash', NOW())
         RETURNING id, email`
      );
      const noPhoneToken = app.jwt.sign({ sub: String(custNoPhone.rows[0].id), email: custNoPhone.rows[0].email });
      const tokenHash = crypto.createHash('sha256').update(noPhoneToken).digest('hex');
      await pool.query(
        `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
         VALUES ($1, $2, 'csrf_no_phone', NOW() + INTERVAL '1 day')`,
        [tokenHash, custNoPhone.rows[0].id]
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${noPhoneToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(capturedSubParams.length, 1);
      const sub = capturedSubParams[0];
      assert.strictEqual(sub.notes.customerPhone, undefined, 'customerPhone must be omitted when not provided');
      assert.strictEqual(sub.customer_notify, true);
    });
  });

  // =========================================================================
  // 2. Future-Start Subscription Payload Correctness
  // =========================================================================
  describe('2. Future-Start Subscription Payload Correctness', () => {
    it('sets valid future unix timestamp for start_at and populated startDate in notes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 1 // Next month
        }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(capturedSubParams.length, 1);
      const sub = capturedSubParams[0];

      // start_at must be populated as an integer future timestamp in seconds
      assert.ok(typeof sub.start_at === 'number', 'start_at must be a number');
      assert.ok(sub.start_at > Math.floor(Date.now() / 1000), 'start_at must be in the future');

      // notes.startDate must be populated with non-empty YYYY-MM-01 format
      assert.ok(sub.notes.startDate, 'startDate must be defined in notes');
      assert.match(sub.notes.startDate, /^\d{4}-\d{2}-01$/, 'startDate must match YYYY-MM-01 format');
      assert.strictEqual(sub.customer_notify, true);
      assert.strictEqual(sub.notes.startOffset, '1');
    });
  });

  // =========================================================================
  // 3. Multi-Month Continuous Plan Subscription (total_count = 2)
  // =========================================================================
  describe('3. Multi-Month Continuous Plan Subscription', () => {
    it('correctly sets total_count: 2 for a 2-month subscription', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 2,
          startOffset: 0
        }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(capturedSubParams.length, 1);
      const sub = capturedSubParams[0];

      assert.strictEqual(sub.total_count, 2, 'total_count must be 2 for 2 months');
      assert.strictEqual(sub.customer_notify, true);
      assert.strictEqual(sub.notes.months, '2');
    });
  });

  // =========================================================================
  // 4. Plan Reuse from Registry & Database
  // =========================================================================
  describe('4. Plan Reuse from Registry & Database', () => {
    it('reuses existing verified active plan from subscription_plan_registry without creating new plan', async () => {
      const existingPlanId = `plan_reused_${Date.now()}`;
      const amountPaise = 325500;

      // Register plan in subscription_plan_registry
      await pool.query(
        `INSERT INTO subscription_plan_registry (
          product_id, product_name, size, amount_per_month_paise, daily_rate_paise,
          currency, period, interval, razorpay_plan_id, key_mode, is_active
        ) VALUES ($1, 'Pure Fresh Cow Milk', '1 Litre', $2, 10500, 'INR', 'monthly', 1, $3, 'test', TRUE)`,
        [productId, amountPaise, existingPlanId]
      );

      // Call getOrCreateRazorpayPlan directly
      const result = await getOrCreateRazorpayPlan({
        razorpayClient: razorpay,
        dbPool: pool,
        product: { id: productId, name: 'Pure Fresh Cow Milk' },
        normalizedSize: '1 Litre',
        amountPerMonthPaise: amountPaise,
        dailyRatePaise: 10500,
        keyMode: 'test'
      });

      assert.strictEqual(result.reused, true, 'Plan must be marked as reused');
      assert.strictEqual(result.plan.id, existingPlanId, 'Must return the existing plan id');
      assert.ok(fetchedPlanIds.includes(existingPlanId), 'Must verify plan with razorpay.plans.fetch');
      assert.strictEqual(capturedPlanParams.length, 0, 'Must NOT call razorpay.plans.create');
    });

    it('falls back to creating a new plan if existing candidate in registry fails gateway fetch verification', async () => {
      const stalePlanId = `plan_stale_${Date.now()}`;
      const amountPaise = 325500;

      // Register stale plan
      await pool.query(
        `INSERT INTO subscription_plan_registry (
          product_id, product_name, size, amount_per_month_paise, daily_rate_paise,
          currency, period, interval, razorpay_plan_id, key_mode, is_active
        ) VALUES ($1, 'Pure Fresh Cow Milk', '1 Litre', $2, 10500, 'INR', 'monthly', 1, $3, 'test', TRUE)`,
        [productId, amountPaise, stalePlanId]
      );

      // Make gateway fetch throw error for stale plan
      razorpay.plans.fetch = async (id) => {
        if (id === stalePlanId) {
          const err = new Error('Plan does not exist on gateway');
          err.statusCode = 404;
          throw err;
        }
        return { id, period: 'monthly', interval: 1, item: { currency: 'INR', amount: amountPaise } };
      };

      const result = await getOrCreateRazorpayPlan({
        razorpayClient: razorpay,
        dbPool: pool,
        product: { id: productId, name: 'Pure Fresh Cow Milk' },
        normalizedSize: '1 Litre',
        amountPerMonthPaise: amountPaise,
        dailyRatePaise: 10500,
        keyMode: 'test'
      });

      assert.strictEqual(result.reused, false, 'Must create a fresh plan when fetch fails');
      assert.ok(result.plan.id.startsWith('plan_mock_'), 'Must return newly created plan');
      assert.strictEqual(capturedPlanParams.length, 1, 'Must invoke razorpay.plans.create');

      // Verify the stale plan was deactivated in the database
      const checkRes = await pool.query(
        `SELECT is_active FROM subscription_plan_registry WHERE razorpay_plan_id = $1`,
        [stalePlanId]
      );
      assert.strictEqual(checkRes.rows[0].is_active, false, 'Stale plan must be deactivated');

      // Verify the new plan was registered
      const newPlanCheck = await pool.query(
        `SELECT razorpay_plan_id, is_active FROM subscription_plan_registry WHERE razorpay_plan_id = $1`,
        [result.plan.id]
      );
      assert.strictEqual(newPlanCheck.rows[0]?.is_active, true, 'New plan must be recorded in registry');
    });

    it('falls back to creating a new plan if plan attributes (amount) do not match', async () => {
      const mismatchPlanId = `plan_mismatch_${Date.now()}`;
      const amountPaise = 325500;

      await pool.query(
        `INSERT INTO subscription_plan_registry (
          product_id, product_name, size, amount_per_month_paise, daily_rate_paise,
          currency, period, interval, razorpay_plan_id, key_mode, is_active
        ) VALUES ($1, 'Pure Fresh Cow Milk', '1 Litre', $2, 10500, 'INR', 'monthly', 1, $3, 'test', TRUE)`,
        [productId, amountPaise, mismatchPlanId]
      );

      // Gateway fetch returns plan with DIFFERENT amount
      razorpay.plans.fetch = async (id) => ({
        id,
        period: 'monthly',
        interval: 1,
        item: { currency: 'INR', amount: 999999 } // Mismatch
      });

      const result = await getOrCreateRazorpayPlan({
        razorpayClient: razorpay,
        dbPool: pool,
        product: { id: productId, name: 'Pure Fresh Cow Milk' },
        normalizedSize: '1 Litre',
        amountPerMonthPaise: amountPaise,
        dailyRatePaise: 10500,
        keyMode: 'test'
      });

      assert.strictEqual(result.reused, false, 'Should not reuse plan when amount does not match');
      assert.strictEqual(capturedPlanParams.length, 1, 'Must call plans.create for mismatched plan');
    });
  });

  // =========================================================================
  // 5. Error Classification & Diagnostic Responses
  // =========================================================================
  describe('5. Error Classification & Gateway Diagnostic Responses', () => {
    it('classifies customer_notify boolean error with underscores or field attribute', () => {
      const errWithUnderscore = {
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'The customer_notify field must be true or false.'
        }
      };
      assert.strictEqual(classifySubscriptionGatewayError(errWithUnderscore), 'invalid_customer_notify');

      const errWithField = {
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          field: 'customer_notify',
          description: 'Validation failed for field.'
        }
      };
      assert.strictEqual(classifySubscriptionGatewayError(errWithField), 'invalid_customer_notify');
    });

    it('classifies total_count error with underscores or field attribute', () => {
      const err = {
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'The total_count must be at least 1.'
        }
      };
      assert.strictEqual(classifySubscriptionGatewayError(err), 'invalid_billing_cycle_count');
      assert.strictEqual(standardizeSubscriptionGatewayError('invalid_billing_cycle_count'), 'invalid_total_count');

      const errField = {
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          field: 'total_count',
          description: 'Invalid cycle count'
        }
      };
      assert.strictEqual(classifySubscriptionGatewayError(errField), 'invalid_billing_cycle_count');
    });

    it('classifies blank notes field error as invalid_subscription_payload', () => {
      const err = {
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'The notes.startDate field cannot be blank or empty'
        }
      };
      assert.strictEqual(classifySubscriptionGatewayError(err), 'invalid_subscription_payload');
    });

    it('returns sanitized 503 response on gateway 400 rejection and avoids credential leaks', async () => {
      // Mock gateway 400 failure on subscriptions.create
      razorpay.subscriptions.create = async () => {
        const err = new Error('The customer_notify field must be true or false.');
        err.statusCode = 400;
        err.error = {
          code: 'BAD_REQUEST_ERROR',
          description: 'The customer_notify field must be true or false.',
          field: 'customer_notify'
        };
        throw err;
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.strictEqual(res.statusCode, 503);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.error, 'razorpay_subscription_setup_rejected');
      assert.ok(data.message.includes('contact Milvanta support'));
      assert.strictEqual(data.keyId, undefined);
      assert.strictEqual(data.secret, undefined);
      assert.strictEqual(res.payload.includes('rzp_test_'), false, 'Response must never leak Razorpay key credentials');
    });

    it('returns sanitized 503 response on gateway 401/403 unauthorized error', async () => {
      razorpay.subscriptions.create = async () => {
        const err = new Error('Unauthorized');
        err.statusCode = 401;
        err.error = {
          code: 'BAD_REQUEST_ERROR',
          description: 'Merchant account is not authorized for recurring subscriptions'
        };
        throw err;
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.strictEqual(res.statusCode, 503);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.error, 'razorpay_subscription_access_denied');
      assert.strictEqual(res.payload.includes('rzp_test_'), false, 'Response must never leak keys');
    });

    it('returns sanitized 502 response on gateway 500 or network timeout', async () => {
      razorpay.subscriptions.create = async () => {
        const err = new Error('Gateway timeout');
        err.statusCode = 504;
        throw err;
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.strictEqual(res.statusCode, 502);
      const data = JSON.parse(res.payload);
      assert.strictEqual(data.error, 'subscription_creation_failed');
    });
  });

  // =========================================================================
  // 6. Idempotency & Duplicate Protection
  // =========================================================================
  describe('6. Idempotency & Duplicate Protection', () => {
    it('returns existing pending subscription when called repeatedly within 15 minutes', async () => {
      // First checkout call creates a pending subscription
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.equal(res1.statusCode, 200);
      const data1 = JSON.parse(res1.payload);
      const initialSubId = data1.subscriptionId;
      assert.ok(initialSubId);
      assert.equal(capturedSubParams.length, 1);

      // Immediate repeated checkout call for the same product, size, customer (WITHOUT clearing customer_subscriptions)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          productId,
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1,
          startOffset: 0
        }
      });

      assert.equal(res2.statusCode, 200);
      const data2 = JSON.parse(res2.payload);
      assert.strictEqual(data2.subscriptionId, initialSubId, 'Must return the same subscriptionId');
      assert.strictEqual(capturedSubParams.length, 1, 'Must NOT call Razorpay API a second time');
    });
  });
});

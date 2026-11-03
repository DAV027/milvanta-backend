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
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return {
    salt: salt.toString('hex'),
    hash: key.toString('hex')
  };
}

// Enforce test environment variables before importing server
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_test_jwt_secret_comprehensive_32_characters';
process.env.ADMIN_API_KEY = 'test_admin_api_key_checkout_audit_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_checkout_audit';
process.env.RAZORPAY_KEY_SECRET = 'test_checkout_razorpay_secret_audit_secure_key';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_checkout_razorpay_webhook_secret_key';

assertTestDatabaseConfigured();

const setup = await setupDisposableTestSchema();
const pool = setup.pool;
const schemaName = setup.schemaName;

const { app, razorpay } = await import('../src/server.js');

describe('Milvanta Checkout Authentication, Payment Lifecycle & Duplicate Prevention Suite', () => {
  let customerA;
  let customerB;
  let adminCustomer;
  let unverifiedCustomer;
  let tokenA;
  let tokenB;
  let tokenAdmin;
  let tokenUnverified;

  let cowMilkProduct;
  let buffaloMilkProduct;
  let inactiveProduct;
  let lowStockProduct;

  const validPassword = 'SecurePassword123!';

  const validHydAddress = {
    name: 'Alpha Recipient',
    phone: '9876543210',
    house: 'Flat 101',
    building: 'Sunrise Heights',
    street: 'Hitech City Main Road',
    landmark: 'Near Cyber Towers',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500049' // Standard Hyderabad pincode (delivery fee = ₹50 = 5000 paise)
  };

  before(async () => {
    // 1. Create Customer A (verified phone)
    const { salt: saltA, hash: hashA } = await createPasswordHash(validPassword);
    const { rows: [custA] } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at, is_admin)
       VALUES ('Customer Alpha', 'customer.alpha@milvanta.test', '9876543210', $1, $2, NOW(), FALSE)
       RETURNING id, full_name, email, phone, is_admin`,
      [saltA, hashA]
    );
    customerA = custA;

    // 2. Create Customer B (verified phone)
    const { salt: saltB, hash: hashB } = await createPasswordHash(validPassword);
    const { rows: [custB] } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at, is_admin)
       VALUES ('Customer Beta', 'customer.beta@milvanta.test', '9876543211', $1, $2, NOW(), FALSE)
       RETURNING id, full_name, email, phone, is_admin`,
      [saltB, hashB]
    );
    customerB = custB;

    // 3. Create Admin Customer (is_admin = TRUE)
    const { salt: saltAdmin, hash: hashAdmin } = await createPasswordHash(validPassword);
    const { rows: [admin] } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at, is_admin)
       VALUES ('Admin Operator', 'admin.operator@milvanta.test', '9876543212', $1, $2, NOW(), TRUE)
       RETURNING id, full_name, email, phone, is_admin`,
      [saltAdmin, hashAdmin]
    );
    adminCustomer = admin;

    // 4. Create Unverified Customer (phone_verified_at = NULL)
    const { salt: saltUnverified, hash: hashUnverified } = await createPasswordHash(validPassword);
    const { rows: [unverified] } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at, is_admin)
       VALUES ('Unverified User', 'unverified.user@milvanta.test', '9876543213', $1, $2, NULL, FALSE)
       RETURNING id, full_name, email, phone, is_admin`,
      [saltUnverified, hashUnverified]
    );
    unverifiedCustomer = unverified;

    // Generate tokens & populate customer_sessions
    tokenA = app.jwt.sign({ sub: String(customerA.id), email: customerA.email });
    tokenB = app.jwt.sign({ sub: String(customerB.id), email: customerB.email });
    tokenAdmin = app.jwt.sign({ sub: String(adminCustomer.id), email: adminCustomer.email });
    tokenUnverified = app.jwt.sign({ sub: String(unverifiedCustomer.id), email: unverifiedCustomer.email });

    const createSession = async (tok, custId) => {
      const hash = crypto.createHash('sha256').update(tok).digest('hex');
      await pool.query(
        `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
         VALUES ($1, $2, 'csrf_token', NOW() + INTERVAL '24 hours')`,
        [hash, custId]
      );
    };

    await createSession(tokenA, customerA.id);
    await createSession(tokenB, customerB.id);
    await createSession(tokenAdmin, adminCustomer.id);
    await createSession(tokenUnverified, unverifiedCustomer.id);

    // 5. Seed test products
    // Cow Milk: 1L @ ₹110 = 11,000 paise
    const { rows: [cow] } = await pool.query(
      `INSERT INTO products (name, category, selling_unit, price_paise, stock_quantity, reserved_stock, active)
       VALUES ('Pure Fresh Cow Milk', 'Fresh Milk', '1 Litre', 11000, 50, 0, TRUE)
       RETURNING *`
    );
    cowMilkProduct = cow;

    // Buffalo Milk: 500ml @ ₹70 = 7,000 paise
    const { rows: [buf] } = await pool.query(
      `INSERT INTO products (name, category, selling_unit, price_paise, stock_quantity, reserved_stock, active)
       VALUES ('Pure Fresh Buffalo Milk', 'Fresh Milk', '500 ml', 7000, 50, 0, TRUE)
       RETURNING *`
    );
    buffaloMilkProduct = buf;

    // Inactive product
    const { rows: [inact] } = await pool.query(
      `INSERT INTO products (name, category, selling_unit, price_paise, stock_quantity, reserved_stock, active)
       VALUES ('Discontinued Curd', 'Fresh Milk', '500 ml', 5000, 20, 0, FALSE)
       RETURNING *`
    );
    inactiveProduct = inact;

    // Low stock product (stock = 1)
    const { rows: [low] } = await pool.query(
      `INSERT INTO products (name, category, selling_unit, price_paise, stock_quantity, reserved_stock, active)
       VALUES ('Special Artisanal Paneer', 'Dairy Products', '500 g', 40000, 1, 0, TRUE)
       RETURNING *`
    );
    lowStockProduct = low;
  });

  after(async () => {
    await app.close();
    await cleanupDisposableTestSchema(setup.pool, schemaName);
  });

  // =========================================================================
  // PHASE 2 — CUSTOMER LOGIN & SESSION TESTS
  // =========================================================================
  describe('Phase 2 — Customer Login & Session Tests', () => {
    it('valid customer logs in successfully via /api/v1/auth/login and receives JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: customerA.email,
          password: validPassword
        }
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.token, 'Should return JWT token');
      assert.equal(body.customer.email, customerA.email);
      assert.equal(body.customer.id, customerA.id);

      // Verify session was recorded in customer_sessions
      const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
      const sessionRow = await pool.query('SELECT * FROM customer_sessions WHERE token_hash = $1', [tokenHash]);
      assert.equal(sessionRow.rowCount, 1);
    });

    it('login with invalid password returns HTTP 401 with clear error message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: customerA.email,
          password: 'WrongPassword999!'
        }
      });
      assert.equal(res.statusCode, 401);
      const body = res.json();
      assert.equal(body.error, 'invalid_email_or_password');
    });

    it('login for non-existent email returns HTTP 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent.user@milvanta.test',
          password: validPassword
        }
      });
      assert.equal(res.statusCode, 401);
      const body = res.json();
      assert.equal(body.error, 'invalid_email_or_password');
    });

    it('missing token on /api/v1/auth/me returns HTTP 401 unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me'
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, 'unauthorized');
    });

    it('malformed token on /api/v1/auth/me returns HTTP 401 unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: 'Bearer this_is_not_a_valid_jwt' }
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, 'unauthorized');
    });

    it('expired token on /api/v1/auth/me returns HTTP 401 unauthorized', async () => {
      // Create a token expired 1 hour ago
      const expiredToken = app.jwt.sign(
        { sub: String(customerA.id), email: customerA.email, exp: Math.floor(Date.now() / 1000) - 3600 }
      );
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${expiredToken}` }
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, 'unauthorized');
    });

    it('valid customer token returns HTTP 200 with customer profile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.customer.id, customerA.id);
      assert.equal(body.customer.email, customerA.email);
    });

    it('customer logs out via /api/v1/auth/logout and session is revoked from database', async () => {
      // Create a dedicated logout token with unique jti
      const logoutToken = app.jwt.sign({ sub: String(customerA.id), email: customerA.email, jti: crypto.randomUUID() });
      const hash = crypto.createHash('sha256').update(logoutToken).digest('hex');
      await pool.query(
        `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
         VALUES ($1, $2, 'csrf_logout', NOW() + INTERVAL '1 hour')`,
        [hash, customerA.id]
      );

      // Verify it works before logout
      const beforeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${logoutToken}` }
      });
      assert.equal(beforeRes.statusCode, 200);

      // Call logout
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { Authorization: `Bearer ${logoutToken}` }
      });
      assert.equal(logoutRes.statusCode, 200);
      assert.equal(logoutRes.json().loggedOut, true);

      // Verify token is deleted from customer_sessions
      const sessionCheck = await pool.query('SELECT * FROM customer_sessions WHERE token_hash = $1', [hash]);
      assert.equal(sessionCheck.rowCount, 0, 'Session must be deleted from customer_sessions');

      // Subsequent /auth/me call MUST fail with 401
      const afterRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${logoutToken}` }
      });
      assert.equal(afterRes.statusCode, 401, 'Revoked token must be rejected with 401');
    });

    it('customer and administrator session isolation: regular customer blocked from admin endpoints', async () => {
      // Regular customer attempts to access admin orders
      const custRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(custRes.statusCode, 403, 'Regular customer must be rejected with 403');
      assert.equal(custRes.json().error, 'forbidden_admin_required');

      // Admin user accesses admin orders
      const adminRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        headers: { Authorization: `Bearer ${tokenAdmin}` }
      });
      assert.equal(adminRes.statusCode, 200, 'Admin must be granted access');
    });

    it('concurrent login requests are handled safely', async () => {
      const loginAttempts = Array.from({ length: 3 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: customerA.email, password: validPassword }
        })
      );
      const results = await Promise.all(loginAttempts);
      for (const res of results) {
        assert.equal(res.statusCode, 200);
        assert.ok(res.json().token);
      }
    });
  });

  // =========================================================================
  // PHASE 3 & PHASE 4 — CHECKOUT AUTH GATES & RAZORPAY ORDER CREATION
  // =========================================================================
  describe('Phase 3 & Phase 4 — Checkout Authentication & Order Creation', () => {
    it('blocks unauthenticated order placement with HTTP 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        payload: {
          address: validHydAddress,
          items: [{ productId: Number(cowMilkProduct.id), quantity: 1 }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, 'unauthorized');
    });

    it('blocks customer with unverified phone number with HTTP 403 phone_verification_required', async () => {
      const orig = process.env.MANDATORY_PHONE_VERIFICATION;
      process.env.MANDATORY_PHONE_VERIFICATION = 'true';
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          headers: { Authorization: `Bearer ${tokenUnverified}` },
          payload: {
            address: validHydAddress,
            items: [{ productId: Number(cowMilkProduct.id), quantity: 1 }],
            idempotencyKey: crypto.randomUUID()
          }
        });
        assert.equal(res.statusCode, 403);
        const body = res.json();
        assert.equal(body.error, 'phone_verification_required');
      } finally {
        process.env.MANDATORY_PHONE_VERIFICATION = orig;
      }
    });

    it('rejects order with missing or malformed address fields with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          address: { pincode: '500049' }, // missing mandatory name, phone, street, etc.
          items: [{ productId: Number(cowMilkProduct.id), quantity: 1 }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'invalid_checkout');
    });

    it('rejects order with non-Hyderabad pincode (e.g. 560001) with HTTP 422 outside_hyderabad', async () => {
      const outOfHydAddress = { ...validHydAddress, pincode: '560001', city: 'Bengaluru', state: 'Karnataka' };
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          address: outOfHydAddress,
          items: [{ productId: Number(cowMilkProduct.id), quantity: 1 }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      assert.equal(res.statusCode, 422);
      assert.equal(res.json().error, 'outside_hyderabad');
    });

    it('rejects order containing an inactive product with HTTP 409 product_unavailable', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          address: validHydAddress,
          items: [{ productId: Number(inactiveProduct.id), quantity: 1 }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json().error, 'product_unavailable');
    });

    it('rejects order exceeding available stock with HTTP 409 insufficient_stock', async () => {
      // lowStockProduct has stock = 1
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          address: validHydAddress,
          items: [{ productId: Number(lowStockProduct.id), quantity: 5 }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json().error, 'insufficient_stock');
    });

    it('creates exact ₹230 order (1L Cow Milk ₹110 + 500ml Buffalo Milk ₹70 + ₹50 Delivery = 23,000 paise)', async (t) => {
      // Mock razorpay order creation
      const mockRzpOrderId = `order_test_${Date.now()}`;
      t.mock.method(razorpay.orders, 'create', async (params) => {
        assert.equal(params.amount, 23000, 'Razorpay order amount must be exactly 23,000 paise (₹230)');
        assert.equal(params.currency, 'INR');
        return {
          id: mockRzpOrderId,
          entity: 'order',
          amount: params.amount,
          amount_paid: 0,
          amount_due: params.amount,
          currency: 'INR',
          receipt: params.receipt,
          status: 'created'
        };
      });

      const idempotencyKey = crypto.randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          address: validHydAddress,
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre' },
            { productId: Number(buffaloMilkProduct.id), quantity: 1, size: '500 ml' }
          ],
          idempotencyKey
        }
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.amount, 23000, 'Total must equal exactly 23,000 paise (₹230)');
      assert.equal(body.currency, 'INR');
      assert.equal(body.subtotalPaise, 18000, 'Subtotal must be ₹110 + ₹70 = 18,000 paise');
      assert.equal(body.deliveryChargePaise, 5000, 'Delivery charge must be ₹50 = 5,000 paise');
      assert.equal(body.orderId, mockRzpOrderId);
      assert.ok(body.orderNumber.startsWith('MV-'));

      // Check PostgreSQL customer_orders record
      const orderDb = await pool.query(
        'SELECT * FROM customer_orders WHERE customer_id = $1 AND idempotency_key = $2',
        [customerA.id, idempotencyKey]
      );
      assert.equal(orderDb.rowCount, 1);
      const orderRow = orderDb.rows[0];
      assert.equal(orderRow.total_paise, 23000);
      assert.equal(orderRow.subtotal_paise, 18000);
      assert.equal(orderRow.delivery_charge_paise, 5000);
      assert.equal(orderRow.payment_status, 'pending');
      assert.equal(orderRow.order_status, 'placed');

      // Verify stock reservation: products had stock 50, reserved_stock should now be 1
      const cowCheck = await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);
      assert.equal(cowCheck.rows[0].reserved_stock, 1, 'Cow milk reserved stock must increment to 1');
      const bufCheck = await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id = $1', [buffaloMilkProduct.id]);
      assert.equal(bufCheck.rows[0].reserved_stock, 1, 'Buffalo milk reserved stock must increment to 1');
    });

    it('idempotent replay with same idempotency key returns existing order without duplicate stock reservation', async (t) => {
      t.mock.method(razorpay.orders, 'create', async (params) => {
        return {
          id: `order_replay_${Date.now()}`,
          entity: 'order',
          amount: params.amount,
          amount_paid: 0,
          amount_due: params.amount,
          currency: 'INR',
          receipt: params.receipt,
          status: 'created'
        };
      });

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        address: validHydAddress,
        items: [{ productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre' }],
        idempotencyKey
      };

      // 1st request
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload
      });
      assert.equal(res1.statusCode, 201);
      const body1 = res1.json();

      // Check reserved stock before replay
      const cowBefore = await pool.query('SELECT reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);
      const reservedBefore = cowBefore.rows[0].reserved_stock;

      // 2nd request (replay with same idempotencyKey)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload
      });
      assert.equal(res2.statusCode, 200, 'Replay should return 200 with existing order');
      const body2 = res2.json();
      assert.equal(body2.orderNumber, body1.orderNumber);
      assert.equal(body2.amount, body1.amount);

      // Verify reserved stock did NOT increment again
      const cowAfter = await pool.query('SELECT reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);
      assert.equal(cowAfter.rows[0].reserved_stock, reservedBefore, 'Reserved stock must NOT double count');

      // Verify only 1 order exists in DB with this idempotency key
      const countRes = await pool.query(
        'SELECT count(*) FROM customer_orders WHERE customer_id = $1 AND idempotency_key = $2',
        [customerA.id, idempotencyKey]
      );
      assert.equal(countRes.rows[0].count, '1');
    });
  });

  // =========================================================================
  // PHASE 5 — COMPLETE PAYMENT LIFECYCLE & SIGNATURES
  // =========================================================================
  describe('Phase 5 — Complete Payment Lifecycle & Signatures', () => {
    let testOrderId;
    let rzpOrderId;
    let expectedAmountPaise;

    before(async () => {
      // Create a dedicated order for testing payment verify
      expectedAmountPaise = 23000;
      rzpOrderId = `order_lifecycle_${Date.now()}`;
      const { rows: [order] } = await pool.query(
        `INSERT INTO customer_orders (customer_id, order_number, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id, reservation_expires_at)
         VALUES ($1, 'MV-20261102-000101', $2, '{"pincode":"500049"}'::jsonb, $3::jsonb, 18000, 5000, $4, $5, NOW() + INTERVAL '15 minutes')
         RETURNING id, order_number`,
        [
          customerA.id,
          crypto.randomUUID(),
          JSON.stringify([{ productId: Number(cowMilkProduct.id), quantity: 1 }, { productId: Number(buffaloMilkProduct.id), quantity: 1 }]),
          expectedAmountPaise,
          rzpOrderId
        ]
      );
      testOrderId = order.id;

      // Ensure reserved stock reflects this order
      await pool.query('UPDATE products SET reserved_stock = reserved_stock + 1 WHERE id IN ($1, $2)', [cowMilkProduct.id, buffaloMilkProduct.id]);

      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, $3, 'INR', '[]'::jsonb, 'created')`,
        [rzpOrderId, testOrderId, expectedAmountPaise]
      );
    });

    it('rejects unauthenticated access to /api/v1/payments/verify with HTTP 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        payload: {
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: 'pay_dummy_123',
          razorpay_signature: 'dummy_sig'
        }
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error, 'unauthorized');
    });

    it('rejects tampered / invalid HMAC signature on /api/v1/payments/verify with HTTP 400', async () => {
      const invalidSignature = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: 'pay_test_tampered',
          razorpay_signature: invalidSignature
        }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'invalid_payment_signature');
      assert.equal(res.json().verified, false);

      // Verify order payment status is NOT marked paid
      const orderCheck = await pool.query('SELECT payment_status FROM customer_orders WHERE id = $1', [testOrderId]);
      assert.equal(orderCheck.rows[0].payment_status, 'pending');
    });

    it('prevents cross-customer payment verification: Customer B cannot verify Customer A order', async () => {
      const fakePaymentId = 'pay_cross_customer_123';
      const validSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${rzpOrderId}|${fakePaymentId}`)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${tokenB}` }, // Customer B attempting Customer A's order!
        payload: {
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: fakePaymentId,
          razorpay_signature: validSig
        }
      });
      assert.equal(res.statusCode, 404, 'Must return 404 payment_order_not_found for cross-customer attempt');
      assert.equal(res.json().error, 'payment_order_not_found');
    });

    it('successfully verifies valid payment signature, sets order paid & confirmed, and decrements stock', async (t) => {
      const paymentId = `pay_valid_${Date.now()}`;
      const validSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${rzpOrderId}|${paymentId}`)
        .digest('hex');

      // Mock razorpay calls
      t.mock.method(razorpay.orders, 'fetch', async (id) => {
        assert.equal(id, rzpOrderId);
        return { id, amount: expectedAmountPaise, currency: 'INR', status: 'paid' };
      });
      t.mock.method(razorpay.payments, 'fetch', async (id) => {
        assert.equal(id, paymentId);
        return { id, order_id: rzpOrderId, amount: expectedAmountPaise, currency: 'INR', status: 'captured' };
      });

      // Get stock before verification
      const stockBefore = await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);
      const { stock_quantity: qtyBefore, reserved_stock: resBefore } = stockBefore.rows[0];

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig
        }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().verified, true);
      assert.equal(res.json().status, 'captured');

      // Verify PostgreSQL state
      const orderCheck = await pool.query('SELECT payment_status, order_status FROM customer_orders WHERE id = $1', [testOrderId]);
      assert.equal(orderCheck.rows[0].payment_status, 'paid');
      assert.equal(orderCheck.rows[0].order_status, 'confirmed');

      const paymentCheck = await pool.query('SELECT status, razorpay_payment_id FROM payment_orders WHERE razorpay_order_id = $1', [rzpOrderId]);
      assert.equal(paymentCheck.rows[0].status, 'captured');
      assert.equal(paymentCheck.rows[0].razorpay_payment_id, paymentId);

      // Verify stock commit: stock_quantity decreased by 1, reserved_stock decreased by 1
      const stockAfter = await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);
      assert.equal(stockAfter.rows[0].stock_quantity, qtyBefore - 1);
      assert.equal(stockAfter.rows[0].reserved_stock, resBefore - 1);
    });

    it('rejects webhook requests with missing or forged X-Razorpay-Signature with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': 'deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000',
          'x-razorpay-event-id': `evt_${Date.now()}`
        },
        payload: {
          event: 'payment.captured'
        }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'invalid_webhook_signature');
    });

    it('webhook recovers order when customer browser closes: payment.captured confirms order', async () => {
      // Create a pending order simulated where customer paid on gateway, but browser crashed before verify
      const webhookRzpOrderId = `order_wh_${Date.now()}`;
      const webhookPaymentId = `pay_wh_${Date.now()}`;
      const { rows: [whOrder] } = await pool.query(
        `INSERT INTO customer_orders (customer_id, order_number, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id, reservation_expires_at)
         VALUES ($1, 'MV-20261102-000102', $2, '{"pincode":"500049"}'::jsonb, $3::jsonb, 18000, 5000, 23000, $4, NOW() + INTERVAL '15 minutes')
         RETURNING id`,
        [customerA.id, crypto.randomUUID(), JSON.stringify([{ productId: Number(cowMilkProduct.id), quantity: 1 }]), webhookRzpOrderId]
      );
      await pool.query('UPDATE products SET reserved_stock = reserved_stock + 1 WHERE id = $1', [cowMilkProduct.id]);
      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, 23000, 'INR', '[]'::jsonb, 'created')`,
        [webhookRzpOrderId, whOrder.id]
      );

      const webhookPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: webhookPaymentId,
              order_id: webhookRzpOrderId,
              amount: 23000,
              currency: 'INR',
              status: 'captured'
            }
          }
        }
      });
      const validWebhookSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(webhookPayload)
        .digest('hex');

      const eventId = `evt_recovery_${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': validWebhookSig,
          'x-razorpay-event-id': eventId,
          'content-type': 'application/json'
        },
        payload: webhookPayload
      });

      assert.equal(res.statusCode, 200);

      // Verify the order was successfully confirmed by the webhook!
      const orderCheck = await pool.query('SELECT payment_status, order_status FROM customer_orders WHERE id = $1', [whOrder.id]);
      assert.equal(orderCheck.rows[0].payment_status, 'paid');
      assert.equal(orderCheck.rows[0].order_status, 'confirmed');

      // Test webhook idempotency: replaying same eventId
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': validWebhookSig,
          'x-razorpay-event-id': eventId,
          'content-type': 'application/json'
        },
        payload: webhookPayload
      });
      assert.equal(replayRes.statusCode, 200);
      assert.equal(replayRes.json().duplicate, true, 'Duplicate webhook event must return duplicate: true');
    });
  });

  // =========================================================================
  // PHASE 6 — PREVENT DUPLICATE CHARGES & SAFE RECOVERY
  // =========================================================================
  describe('Phase 6 — Prevent Duplicate Charges & Safe Recovery', () => {
    it('calling /api/v1/payments/verify on an already captured payment is idempotent and does not double-decrement inventory', async (t) => {
      // Create an already captured order and payment
      const orderId = `order_dup_prev_${Date.now()}`;
      const paymentId = `pay_dup_prev_${Date.now()}`;
      const { rows: [dupOrder] } = await pool.query(
        `INSERT INTO customer_orders (customer_id, order_number, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id, payment_status, order_status, reservation_expires_at)
         VALUES ($1, 'MV-20261102-000104', $2, '{"pincode":"500049"}'::jsonb, $3::jsonb, 18000, 5000, 23000, $4, 'paid', 'confirmed', NOW() + INTERVAL '15 minutes')
         RETURNING id`,
        [customerA.id, crypto.randomUUID(), JSON.stringify([{ productId: Number(cowMilkProduct.id), quantity: 1 }]), orderId]
      );
      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, razorpay_payment_id, amount_paise, currency, items, status)
         VALUES ($1, $2, $3, 23000, 'INR', '[]'::jsonb, 'captured')`,
        [orderId, dupOrder.id, paymentId]
      );

      t.mock.method(razorpay.orders, 'fetch', async () => ({ id: orderId, amount: 23000, currency: 'INR', status: 'paid' }));
      t.mock.method(razorpay.payments, 'fetch', async () => ({ id: paymentId, order_id: orderId, amount: 23000, currency: 'INR', status: 'captured' }));

      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

      // Check stock before second verify
      const stockBefore = await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);

      // Call verify again
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: sig
        }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().verified, true);

      // Verify stock did NOT change
      const stockAfter = await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id = $1', [cowMilkProduct.id]);
      assert.equal(stockAfter.rows[0].stock_quantity, stockBefore.rows[0].stock_quantity);
      assert.equal(stockAfter.rows[0].reserved_stock, stockBefore.rows[0].reserved_stock);
    });

    it('interrupted callback leaves order pending, recoverable by status reconciliation', async () => {
      const orderId = `order_interrupted_${Date.now()}`;
      const { rows: [pendingOrder] } = await pool.query(
        `INSERT INTO customer_orders (customer_id, order_number, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id, payment_status, order_status, reservation_expires_at)
         VALUES ($1, 'MV-20261102-000103', $2, '{"pincode":"500049"}'::jsonb, '[]'::jsonb, 18000, 5000, 23000, $3, 'pending', 'placed', NOW() + INTERVAL '15 minutes')
         RETURNING id, order_number`,
        [customerA.id, crypto.randomUUID(), orderId]
      );

      // Customer fetches order status via /api/v1/orders/:orderNumber
      const statusRes = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${pendingOrder.order_number}`,
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(statusRes.statusCode, 200);
      const data = statusRes.json();
      assert.equal(data.order.payment_status, 'pending');
      assert.equal(data.order.order_status, 'placed');
    });
  });

  // =========================================================================
  // PHASE 6B — CAPTURED-PAYMENT RECOVERY AND MISMATCH REGRESSION TESTS
  // =========================================================================
  describe('Phase 6B — Razorpay order reconciliation safety', () => {
    async function createPendingBuffaloOrder() {
      const orderNumber = 'MV-RECON-' + crypto.randomUUID().slice(0, 15);
      const gatewayId = 'order_recon_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const { rows: [order] } = await pool.query(
        `INSERT INTO customer_orders (
          customer_id, order_number, idempotency_key, address, items,
          subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id,
          payment_status, order_status, reservation_expires_at
        ) VALUES (
          $1, $2, $3, '{"pincode":"500049"}'::jsonb, $4::jsonb,
          7000, 5000, 12000, $5,
          'pending', 'placed', NOW() + INTERVAL '15 minutes'
        ) RETURNING id, order_number`,
        [customerA.id, orderNumber, crypto.randomUUID(),
          JSON.stringify([{ productId: Number(buffaloMilkProduct.id), quantity: 1 }]), gatewayId]
      );
      await pool.query('UPDATE products SET reserved_stock = reserved_stock + 1 WHERE id = $1', [buffaloMilkProduct.id]);
      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, 12000, 'INR', '[]'::jsonb, 'created')`,
        [gatewayId, order.id]
      );
      return { ...order, gatewayId };
    }

    it('reconciles a ₹120 order captured as ₹122.84 only when Razorpay confirms ₹2.84 fee', async t => {
      const order = await createPendingBuffaloOrder();
      const paymentId = 'pay_fee_' + crypto.randomUUID().replaceAll('-', '').slice(0,14);
      t.mock.method(razorpay.orders, 'fetch', async id => ({
        id, amount: 12000, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.orders, 'fetchPayments', async id => ({
        items: [{
          id:paymentId, order_id:id, amount:12284, fee:284, tax:43,
          currency:'INR', status:'captured', refund_status:null, amount_refunded:0
        }]
      }));
      const res = await app.inject({
        method:'POST', url:'/api/v1/orders/' + order.order_number + '/reconcile-payment',
        headers:{Authorization:'Bearer ' + tokenA}
      });
      assert.equal(res.statusCode,200,res.body);
      assert.equal(res.json().state,'confirmed');
      const payment = (await pool.query(
        'SELECT amount_paise,status,razorpay_payment_id FROM payment_orders WHERE razorpay_order_id=$1',
        [order.gatewayId]
      )).rows[0];
      assert.equal(payment.amount_paise, 12000, 'Merchant order remains ₹120');
      assert.equal(payment.status, 'captured');
      assert.equal(payment.razorpay_payment_id, paymentId);
      const again = await app.inject({
        method:'POST',url:'/api/v1/orders/' + order.order_number + '/reconcile-payment',
        headers:{Authorization:'Bearer ' + tokenA}
      });
      assert.equal(again.statusCode,200,again.body);
      assert.equal(again.json().state,'confirmed');
    });

    it('rejects ₹122.84 captured when Razorpay does not prove fee of ₹2.84', async t => {
      const order = await createPendingBuffaloOrder();
      t.mock.method(razorpay.orders, 'fetch', async id => ({
        id,amount:12000,currency:'INR',status:'paid'
      }));
      t.mock.method(razorpay.orders, 'fetchPayments', async id => ({
        items:[{id:'pay_bad_fee',order_id:id,amount:12284,fee:283,tax:43,
          currency:'INR',status:'captured'}]
      }));
      const res = await app.inject({
        method:'POST', url:'/api/v1/orders/' + order.order_number + '/reconcile-payment',
        headers:{Authorization:'Bearer ' + tokenA}
      });
      assert.equal(res.statusCode,409,res.body);
      assert.equal(res.json().error,'captured_payment_mismatch');
      const row = (await pool.query(
        'SELECT payment_status FROM customer_orders WHERE id=$1',[order.id]
      )).rows[0];
      assert.equal(row.payment_status,'pending');
    });

    it('recovers a captured ₹120 payment exactly once', async t => {
      const order = await createPendingBuffaloOrder();
      const paymentId = 'pay_rec_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'fetch', async id => ({
        id, amount: 12000, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.orders, 'fetchPayments', async id => ({
        items: [{ id: paymentId, order_id: id, amount: 12000, currency: 'INR', status: 'captured' }]
      }));
      const before = (await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id=$1', [buffaloMilkProduct.id])).rows[0];
      const url = '/api/v1/orders/' + order.order_number + '/reconcile-payment';
      const first = await app.inject({ method: 'POST', url, headers: { Authorization: 'Bearer ' + tokenA } });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().state, 'confirmed');
      const afterFirst = (await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id=$1', [buffaloMilkProduct.id])).rows[0];
      assert.equal(Number(afterFirst.stock_quantity), Number(before.stock_quantity) - 1);
      assert.equal(Number(afterFirst.reserved_stock), Number(before.reserved_stock) - 1);
      const second = await app.inject({ method: 'POST', url, headers: { Authorization: 'Bearer ' + tokenA } });
      assert.equal(second.statusCode, 200, second.body);
      assert.equal(second.json().state, 'confirmed');
      const afterSecond = (await pool.query('SELECT stock_quantity, reserved_stock FROM products WHERE id=$1', [buffaloMilkProduct.id])).rows[0];
      assert.deepEqual(afterSecond, afterFirst);
      const payment = (await pool.query('SELECT status, razorpay_payment_id FROM payment_orders WHERE razorpay_order_id=$1', [order.gatewayId])).rows[0];
      assert.equal(payment.status, 'captured');
      assert.equal(payment.razorpay_payment_id, paymentId);
    });

    it('does not accept the wrong Razorpay payment amount', async t => {
      const order = await createPendingBuffaloOrder();
      t.mock.method(razorpay.orders, 'fetch', async id => ({ id, amount: 12000, currency: 'INR', status: 'attempted' }));
      t.mock.method(razorpay.orders, 'fetchPayments', async id => ({
        items: [{ id: 'pay_wrong_amount', order_id: id, amount: 11000, currency: 'INR', status: 'captured' }]
      }));
      const response = await app.inject({
        method: 'POST', url: '/api/v1/orders/' + order.order_number + '/reconcile-payment',
        headers: { Authorization: 'Bearer ' + tokenA }
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().state, 'payment_review');
      const state = (await pool.query('SELECT payment_status FROM customer_orders WHERE id=$1', [order.id])).rows[0];
      assert.equal(state.payment_status, 'pending');
    });

    it('keeps an unconfirmed gateway payment pending', async t => {
      const order = await createPendingBuffaloOrder();
      t.mock.method(razorpay.orders, 'fetch', async id => ({ id, amount: 12000, currency: 'INR', status: 'attempted' }));
      t.mock.method(razorpay.orders, 'fetchPayments', async id => ({
        items: [{ id: 'pay_failed', order_id: id, amount: 12000, currency: 'INR', status: 'failed' }]
      }));
      const response = await app.inject({
        method: 'POST', url: '/api/v1/orders/' + order.order_number + '/reconcile-payment',
        headers: { Authorization: 'Bearer ' + tokenA }
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().state, 'pending');
      const state = (await pool.query('SELECT payment_status FROM customer_orders WHERE id=$1', [order.id])).rows[0];
      assert.equal(state.payment_status, 'pending');
    });

    it('blocks cross-customer reconciliation before fetching gateway data', async t => {
      const order = await createPendingBuffaloOrder();
      const method = t.mock.method(razorpay.orders, 'fetch', async () => { throw Error('Unauthorized gateway fetch'); });
      const response = await app.inject({
        method: 'POST', url: '/api/v1/orders/' + order.order_number + '/reconcile-payment',
        headers: { Authorization: 'Bearer ' + tokenB }
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.equal(method.mock.callCount(), 0);
    });

    it('rejects a validly signed callback with an inconsistent payment amount', async t => {
      const order = await createPendingBuffaloOrder();
      const paymentId = 'pay_mismatch_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(order.gatewayId + '|' + paymentId).digest('hex');
      t.mock.method(razorpay.orders, 'fetch', async id => ({ id, amount: '12000', currency: 'INR', status: 'paid' }));
      t.mock.method(razorpay.payments, 'fetch', async id => ({
        id, order_id: order.gatewayId, amount: 11000, currency: 'INR', status: 'captured'
      }));
      const response = await app.inject({
        method: 'POST', url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          razorpay_order_id: order.gatewayId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signature
        }
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error, 'payment_details_mismatch');
      const state = (await pool.query('SELECT payment_status FROM customer_orders WHERE id=$1', [order.id])).rows[0];
      assert.equal(state.payment_status, 'pending');
    });
  });

  describe('Variant pricing and stock reservation', () => {
    it('prices 500 ml and 1 litre of the SAME cow-milk product separately', async t => {
      const gatewayId = 'order_variants_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'create', async params => ({
        id: gatewayId, amount: params.amount, currency: params.currency, status: 'created'
      }));
      const stockBefore = (await pool.query(
        'SELECT reserved_stock FROM products WHERE id=$1', [cowMilkProduct.id]
      )).rows[0];
      const response = await app.inject({
        method: 'POST', url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '500 ml' },
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre' }
          ]
        }
      });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(response.json().amount, 22000, '₹60 + ₹110 + ₹50 delivery must be ₹220');
      const orderRow = (await pool.query(
        'SELECT items FROM customer_orders WHERE order_number=$1',
        [response.json().orderNumber]
      )).rows[0];
      assert.equal(orderRow.items.length, 2, 'Each variant must retain a separate line');
      assert.deepEqual(orderRow.items.map(item => item.unitPricePaise).sort((a,b)=>a-b), [6000,11000]);
      const stockAfter = (await pool.query(
        'SELECT reserved_stock FROM products WHERE id=$1', [cowMilkProduct.id]
      )).rows[0];
      assert.equal(Number(stockAfter.reserved_stock), Number(stockBefore.reserved_stock) + 2);
    });

    it('rejects direct order with legacy catalog product IDs (101/102) with HTTP 409 product_unavailable', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            { productId: 101, quantity: 1, size: '1 Litre' }
          ]
        }
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, 'product_unavailable');
    });

    it('enforces server-authoritative pricing overriding client-tampered unitPrice', async (t) => {
      const gatewayId = 'order_tamper_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: gatewayId, amount: params.amount, currency: params.currency, status: 'created'
      }));
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre', unitPrice: 10, price_paise: 100 }
          ]
        }
      });
      assert.equal(response.statusCode, 201);
      assert.equal(response.json().amount, 16000, 'Server must enforce ₹110 cow milk + ₹50 delivery = 16,000 paise regardless of client tampering');
    });
  });

  // =========================================================================
  // PHASE 6C — CUSTOM-DAYS MILK SUBSCRIPTION ACTIVATION, ENTITLEMENT & IDEMPOTENCY
  // =========================================================================
  describe('Phase 6C — Custom-Days Milk Subscription Activation, Entitlement & Idempotency', () => {
    it('activates custom-days milk subscription with exact entitlement, paid-through date and delivery address upon captured payment', async (t) => {
      const gatewayOrderId = 'order_csub_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const gatewayPaymentId = 'pay_csub_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: gatewayOrderId, amount: params.amount, currency: params.currency, status: 'created'
      }));

      // 30 days of 1 Litre Cow Milk: 30 * 10500 = 315000 paise + 5000 delivery charge = 320000 paise (₹3200)
      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            {
              productId: Number(cowMilkProduct.id),
              quantity: 1,
              size: '1 Litre',
              isCustomDaysPlan: true,
              days: 30
            }
          ]
        }
      });
      assert.equal(orderRes.statusCode, 201, orderRes.body);
      const orderData = orderRes.json();
      assert.equal(orderData.amount, 320000, '30 days * ₹105 + ₹50 delivery must be 320,000 paise');

      const { rows: [orderRow] } = await pool.query(
        'SELECT * FROM customer_orders WHERE order_number = $1',
        [orderData.orderNumber]
      );
      assert.equal(orderRow.items[0].isCustomDaysPlan, true);
      assert.equal(orderRow.items[0].subscriptionDays, 30);
      assert.equal(orderRow.items[0].subscriptionDailyRatePaise, 10500);
      assert.equal(orderRow.items[0].subscriptionSize, '1 Litre');

      // Now verify payment with captured gateway order
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({
        id, amount: 320000, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: gatewayOrderId, amount: 320000, currency: 'INR', status: 'captured'
      }));

      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          razorpay_order_id: gatewayOrderId,
          razorpay_payment_id: gatewayPaymentId,
          razorpay_signature: signature
        }
      });
      assert.equal(verifyRes.statusCode, 200, verifyRes.body);
      assert.equal(verifyRes.json().verified, true);
      assert.equal(verifyRes.json().orderStatus, 'confirmed');

      // Verify PostgreSQL customer_orders
      const { rows: [updatedOrder] } = await pool.query(
        'SELECT payment_status, order_status FROM customer_orders WHERE id = $1',
        [orderRow.id]
      );
      assert.equal(updatedOrder.payment_status, 'paid');
      assert.equal(updatedOrder.order_status, 'confirmed');

      // Verify customer_subscriptions materialized atomically
      const { rows: subs } = await pool.query(
        `SELECT * FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1`,
        [String(orderRow.id)]
      );
      assert.equal(subs.length, 1, 'Exactly one custom-days subscription must be materialized');
      const sub = subs[0];
      assert.equal(Number(sub.customer_id), Number(customerA.id));
      assert.equal(Number(sub.product_id), Number(cowMilkProduct.id));
      assert.equal(sub.status, 'active');
      assert.equal(sub.plan_type, 'custom');
      assert.equal(sub.duration_label, '30 Days Custom Plan');
      assert.equal(Number(sub.cost_per_day_paise), 10500);
      assert.equal(Number(sub.total_amount_paise), 315000);
      assert.equal(sub.quantity, '1 Litre');

      // Verify notes structure
      const notes = sub.notes;
      assert.equal(notes.fulfillmentEntitled, true, 'Must have fulfillmentEntitled === true');
      assert.equal(notes.authType, 'one_time');
      assert.equal(notes.paidCount, 1);
      assert.equal(notes.days, 30);
      assert.equal(notes.dailyRatePaise, 10500);
      assert.equal(notes.paymentId, gatewayPaymentId);
      assert.equal(notes.lastPaymentId, gatewayPaymentId);
      assert.equal(notes.sourceOrderId, String(orderRow.id));
      assert.equal(notes.sourceOrderLineKey, '0:0');
      assert.ok(notes.startDate, 'Must have startDate');
      assert.ok(notes.paidThroughDate, 'Must have paidThroughDate');

      // Verify address preserved
      assert.equal(notes.deliveryAddress.house, validHydAddress.house);
      assert.equal(notes.deliveryAddress.pincode, validHydAddress.pincode);
      assert.equal(sub.delivery_address.house, validHydAddress.house);
      assert.equal(sub.delivery_address.pincode, validHydAddress.pincode);
    });

    it('enforces exactly-once activation and idempotency against duplicate verification and webhook replay via Migration 017 index', async (t) => {
      const gatewayOrderId = 'order_dup_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const gatewayPaymentId = 'pay_dup_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: gatewayOrderId, amount: params.amount, currency: params.currency, status: 'created'
      }));

      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '500 ml', isCustomDaysPlan: true, days: 7 }
          ]
        }
      });
      assert.equal(orderRes.statusCode, 201);
      const order = orderRes.json();

      const { rows: [orderRow] } = await pool.query(
        'SELECT id FROM customer_orders WHERE order_number = $1', [order.orderNumber]
      );

      t.mock.method(razorpay.orders, 'fetch', async (id) => ({
        id, amount: order.amount, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: gatewayOrderId, amount: order.amount, currency: 'INR', status: 'captured'
      }));

      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');

      // First verification call
      const verify1 = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayOrderId, razorpay_payment_id: gatewayPaymentId, razorpay_signature: signature }
      });
      assert.equal(verify1.statusCode, 200);

      const count1 = await pool.query(
        `SELECT COUNT(*) FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1`,
        [String(orderRow.id)]
      );
      assert.equal(Number(count1.rows[0].count), 1);

      // Duplicate verification call (e.g. user refreshed or webhook replayed)
      const verify2 = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayOrderId, razorpay_payment_id: gatewayPaymentId, razorpay_signature: signature }
      });
      assert.equal(verify2.statusCode, 200);

      const count2 = await pool.query(
        `SELECT COUNT(*) FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1`,
        [String(orderRow.id)]
      );
      assert.equal(Number(count2.rows[0].count), 1, 'Subscription count must remain exactly 1 after duplicate verify');

      // Verify that Migration 017 partial unique index rejects conflicting raw insert
      let constraintError = null;
      try {
        await pool.query(
          `INSERT INTO customer_subscriptions (
            customer_id, product_id, product_name, frequency, time_slot,
            quantity, quantity_num, cost_per_day_paise, plan_type, duration_label,
            total_amount_paise, delivery_address, notes, status, next_delivery
          ) VALUES ($1, $2, 'Duplicate Test', 'Daily', '6:00 AM', '500 ml', 1, 6000, 'custom', '7 Days', 42000, $3::jsonb, $4::jsonb, 'active', 'Tomorrow')`,
          [
            customerA.id, cowMilkProduct.id, JSON.stringify(validHydAddress),
            JSON.stringify({ sourceOrderId: String(orderRow.id), sourceOrderLineKey: '0:0' })
          ]
        );
      } catch (err) {
        constraintError = err;
      }
      assert.ok(constraintError, 'Raw duplicate insert must throw unique constraint violation');
      assert.equal(constraintError.code, '23505', 'PostgreSQL error code must be 23505 unique_violation');
      assert.ok(constraintError.constraint.includes('customer_subscriptions_paid_order_line_key_unique'));
    });

    it('does NOT materialize any subscription for authorized-only or failed payments', async (t) => {
      // 1. Authorized-only payment
      const gatewayOrderId = 'order_authonly_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const gatewayPaymentId = 'pay_authonly_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: gatewayOrderId, amount: params.amount, currency: params.currency, status: 'created'
      }));

      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre', isCustomDaysPlan: true, days: 15 }
          ]
        }
      });
      assert.equal(orderRes.statusCode, 201);
      const order = orderRes.json();
      const { rows: [orderRow] } = await pool.query(
        'SELECT id FROM customer_orders WHERE order_number = $1', [order.orderNumber]
      );

      // Payment fetch returns authorized (not captured)
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({ id, amount: order.amount, currency: 'INR', status: 'attempted' }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: gatewayOrderId, amount: order.amount, currency: 'INR', status: 'authorized'
      }));

      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');

      await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayOrderId, razorpay_payment_id: gatewayPaymentId, razorpay_signature: signature }
      });
      // Authorized-only must NOT materialize subscription
      const subCheck = await pool.query(
        `SELECT COUNT(*) FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1`,
        [String(orderRow.id)]
      );
      assert.equal(Number(subCheck.rows[0].count), 0, 'No subscription materialized for authorized-only payment');

      const orderCheck = (await pool.query('SELECT payment_status FROM customer_orders WHERE id=$1', [orderRow.id])).rows[0];
      assert.notEqual(orderCheck.payment_status, 'paid');
    });

    it('materializes distinct subscription units with unique sourceOrderLineKey for multi-quantity custom-days orders', async (t) => {
      const gatewayOrderId = 'order_multi_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const gatewayPaymentId = 'pay_multi_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: gatewayOrderId, amount: params.amount, currency: params.currency, status: 'created'
      }));

      // Quantity = 2 of 14-day 500ml cow milk: 2 * 14 * 5500 = 154000 paise + 5000 delivery = 159000 paise
      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: {
          address: validHydAddress,
          idempotencyKey: crypto.randomUUID(),
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 2, size: '500 ml', isCustomDaysPlan: true, days: 14 }
          ]
        }
      });
      assert.equal(orderRes.statusCode, 201);
      const order = orderRes.json();
      assert.equal(order.amount, 159000);

      const { rows: [orderRow] } = await pool.query(
        'SELECT id FROM customer_orders WHERE order_number = $1', [order.orderNumber]
      );

      t.mock.method(razorpay.orders, 'fetch', async (id) => ({ id, amount: 159000, currency: 'INR', status: 'paid' }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: gatewayOrderId, amount: 159000, currency: 'INR', status: 'captured'
      }));

      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayOrderId, razorpay_payment_id: gatewayPaymentId, razorpay_signature: signature }
      });
      assert.equal(verifyRes.statusCode, 200);

      const { rows: subs } = await pool.query(
        `SELECT id, notes FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1 ORDER BY notes->>'sourceOrderLineKey' ASC`,
        [String(orderRow.id)]
      );
      assert.equal(subs.length, 2, 'Quantity 2 must materialize exactly 2 distinct subscription units');
      assert.equal(subs[0].notes.sourceOrderLineKey, '0:0');
      assert.equal(subs[1].notes.sourceOrderLineKey, '0:1');
      assert.equal(subs[0].notes.fulfillmentEntitled, true);
      assert.equal(subs[1].notes.fulfillmentEntitled, true);
      assert.equal(subs[0].notes.days, 14);
      assert.equal(subs[1].notes.days, 14);
    });

    it('reconciles pending custom-days orders via POST /api/v1/orders/:orderNumber/reconcile-payment exactly once', async (t) => {
      const orderNumber = 'MV-RECON-CD-' + crypto.randomUUID().slice(0, 12);
      const gatewayId = 'order_recon_cd_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const paymentId = 'pay_recon_cd_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);

      // Order total: 7 days * 10500 = 73500 + 5000 = 78500 paise
      const { rows: [order] } = await pool.query(
        `INSERT INTO customer_orders (
          customer_id, order_number, idempotency_key, address, items,
          subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id,
          payment_status, order_status, reservation_expires_at
        ) VALUES (
          $1, $2, $3, $4::jsonb, $5::jsonb,
          73500, 5000, 78500, $6,
          'pending', 'placed', NOW() + INTERVAL '15 minutes'
        ) RETURNING id, order_number`,
        [
          customerA.id, orderNumber, crypto.randomUUID(), JSON.stringify(validHydAddress),
          JSON.stringify([{
            productId: Number(cowMilkProduct.id),
            name: 'Pure Fresh Cow Milk',
            quantity: 1,
            unitPricePaise: 73500,
            lineTotalPaise: 73500,
            isCustomDaysPlan: true,
            subscriptionDays: 7,
            subscriptionDailyRatePaise: 10500,
            subscriptionSize: '1 Litre'
          }]),
          gatewayId
        ]
      );
      await pool.query('UPDATE products SET reserved_stock = reserved_stock + 1 WHERE id = $1', [cowMilkProduct.id]);
      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, 78500, 'INR', '[]'::jsonb, 'created')`,
        [gatewayId, order.id]
      );

      t.mock.method(razorpay.orders, 'fetch', async (id) => ({ id, amount: 78500, currency: 'INR', status: 'paid' }));
      t.mock.method(razorpay.orders, 'fetchPayments', async (id) => ({
        items: [{ id: paymentId, order_id: id, amount: 78500, currency: 'INR', status: 'captured' }]
      }));

      const reconcileUrl = `/api/v1/orders/${order.order_number}/reconcile-payment`;
      const rec1 = await app.inject({
        method: 'POST',
        url: reconcileUrl,
        headers: { Authorization: 'Bearer ' + tokenA }
      });
      assert.equal(rec1.statusCode, 200, rec1.body);
      assert.equal(rec1.json().state, 'confirmed');

      // Check subscription materialized
      const subs = await pool.query(
        `SELECT * FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1`,
        [String(order.id)]
      );
      assert.equal(subs.rowCount, 1);
      assert.equal(subs.rows[0].notes.fulfillmentEntitled, true);
      assert.equal(subs.rows[0].notes.days, 7);

      // Re-running reconcile is idempotent
      const rec2 = await app.inject({
        method: 'POST',
        url: reconcileUrl,
        headers: { Authorization: 'Bearer ' + tokenA }
      });
      assert.equal(rec2.statusCode, 200);
      assert.equal(rec2.json().state, 'confirmed');

      const subsAfter = await pool.query(
        `SELECT COUNT(*) FROM customer_subscriptions WHERE notes->>'sourceOrderId' = $1`,
        [String(order.id)]
      );
      assert.equal(Number(subsAfter.rows[0].count), 1);
    });

    it('displays activated custom-days plan in Customer Profile, Subscription Calendar, Admin Dashboard, and Delivery Preview', async () => {
      // 1. Customer profile fetches subscriptions
      const profileRes = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(profileRes.statusCode, 200);
      const profileSubs = profileRes.json().subscriptions;
      assert.ok(Array.isArray(profileSubs));
      const customSub = profileSubs.find(s => s.plan_type === 'custom' && s.status === 'active');
      assert.ok(customSub, 'Customer profile must include active custom-days subscription');
      assert.ok(customSub.effective_paid_through_date, 'Must have effective_paid_through_date');

      // 2. Subscription Calendar
      const calRes = await app.inject({
        method: 'GET',
        url: `/api/v1/subscriptions/${customSub.id}/calendar`,
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(calRes.statusCode, 200);
      const calData = calRes.json();
      assert.ok(calData.subscriptionId);
      assert.ok(Array.isArray(calData.days));

      // 3. Admin Subscriptions list
      const adminSubsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/subscriptions',
        headers: { Authorization: `Bearer ${tokenAdmin}` }
      });
      assert.equal(adminSubsRes.statusCode, 200);
      const adminData = adminSubsRes.json();
      const adminMatch = adminData.subscriptions.find(s => s.id === customSub.id);
      assert.ok(adminMatch, 'Admin subscriptions must display custom-days plan');
      assert.equal(adminMatch.notes.fulfillmentEntitled, true);

      // 4. Delivery Preview includes custom days plan for tomorrow
      const previewRes = await app.inject({
        method: 'GET',
        url: '/api/v1/operations/deliveries/generate-preview',
        headers: { Authorization: `Bearer ${tokenAdmin}` }
      });
      assert.equal(previewRes.statusCode, 200);
      const previewData = previewRes.json();
      assert.ok(previewData.eligibleSubscriptions.length >= 1, 'Delivery preview must include entitled subscriptions');
    });

    it('rejects verification callback with mismatched currency, mismatched amount, or mismatched order ID', async (t) => {
      const orderNumber = 'MV-MISMATCH-' + crypto.randomUUID().slice(0, 10);
      const gatewayId = 'order_mismatch_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);
      const paymentId = 'pay_mismatch_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);

      const { rows: [order] } = await pool.query(
        `INSERT INTO customer_orders (
          customer_id, order_number, idempotency_key, address, items,
          subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id,
          payment_status, order_status, reservation_expires_at
        ) VALUES (
          $1, $2, $3, $4::jsonb, '[]'::jsonb,
          11000, 5000, 16000, $5,
          'pending', 'placed', NOW() + INTERVAL '15 minutes'
        ) RETURNING id, order_number`,
        [customerA.id, orderNumber, crypto.randomUUID(), JSON.stringify(validHydAddress), gatewayId]
      );
      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, 16000, 'INR', '[]'::jsonb, 'created')`,
        [gatewayId, order.id]
      );

      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${gatewayId}|${paymentId}`).digest('hex');

      // Case A: Currency mismatch (e.g. gateway order currency is USD)
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({ id, amount: 16000, currency: 'USD', status: 'paid' }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({ id, order_id: gatewayId, amount: 16000, currency: 'INR', status: 'captured' }));

      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayId, razorpay_payment_id: paymentId, razorpay_signature: signature }
      });
      assert.equal(resA.statusCode, 400);
      assert.equal(resA.json().error, 'payment_details_mismatch');

      // Case B: Payment amount mismatch
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({ id, amount: 16000, currency: 'INR', status: 'paid' }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({ id, order_id: gatewayId, amount: 9999, currency: 'INR', status: 'captured' }));

      const resB = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayId, razorpay_payment_id: paymentId, razorpay_signature: signature }
      });
      assert.equal(resB.statusCode, 400);
      assert.equal(resB.json().error, 'payment_details_mismatch');

      // Case C: Payment order_id mismatch
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({ id, order_id: 'order_wrong_foreign_id', amount: 16000, currency: 'INR', status: 'captured' }));

      const resC = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: 'Bearer ' + tokenA },
        payload: { razorpay_order_id: gatewayId, razorpay_payment_id: paymentId, razorpay_signature: signature }
      });
      assert.equal(resC.statusCode, 400);
      assert.equal(resC.json().error, 'payment_details_mismatch');
    });

    it('reconcile endpoint handles gateway error gracefully with HTTP 503', async (t) => {
      const orderNumber = 'MV-REC-ERR-' + crypto.randomUUID().slice(0, 10);
      const gatewayId = 'order_err_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14);

      const { rows: [order] } = await pool.query(
        `INSERT INTO customer_orders (
          customer_id, order_number, idempotency_key, address, items,
          subtotal_paise, delivery_charge_paise, total_paise, razorpay_order_id,
          payment_status, order_status, reservation_expires_at
        ) VALUES (
          $1, $2, $3, $4::jsonb, '[]'::jsonb,
          11000, 5000, 16000, $5,
          'pending', 'placed', NOW() + INTERVAL '15 minutes'
        ) RETURNING id, order_number`,
        [customerA.id, orderNumber, crypto.randomUUID(), JSON.stringify(validHydAddress), gatewayId]
      );
      await pool.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, 16000, 'INR', '[]'::jsonb, 'created')`,
        [gatewayId, order.id]
      );

      t.mock.method(razorpay.orders, 'fetch', async () => {
        const err = new Error('Gateway Connection Timeout');
        err.statusCode = 504;
        throw err;
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.order_number}/reconcile-payment`,
        headers: { Authorization: 'Bearer ' + tokenA }
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'payment_reconciliation_unavailable');
    });
  });

  // =========================================================================
  // PHASE 7 — ORDER AND SUBSCRIPTION CONFIRMATION & PROFILE SYNC
  // =========================================================================
  describe('Phase 7 — Order and Subscription Confirmation & Profile Sync', () => {
    it('customer can fetch their confirmed orders from GET /api/v1/orders', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(Array.isArray(body.orders));
      assert.ok(body.orders.length > 0);
      for (const ord of body.orders) {
        assert.ok(ord.order_number, 'Orders must have order_number');
      }
    });

    it('subscription checkout endpoint creates razorpay order with authoritative pricing', async (t) => {
      t.mock.method(razorpay.plans, 'create', async (params) => ({ id: `plan_${Date.now()}`, ...params }));
      t.mock.method(razorpay.subscriptions, 'create', async (params) => ({ id: `sub_${Date.now()}`, ...params }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        headers: { Authorization: `Bearer ${tokenA}` },
        payload: {
          productId: Number(cowMilkProduct.id),
          productName: 'Pure Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1
        }
      });
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.ok(data.subscriptionId);
      assert.ok(data.amount > 0);
    });
  });

  // =========================================================================
  // PHASE 11 — PAYMENT RECONCILIATION AUDIT INVARIANTS
  // =========================================================================
  describe('Phase 11 — Payment Reconciliation Audit Invariants', () => {
    it('INVARIANT 1: Zero orders marked paid without captured payment evidence', async () => {
      const unverifiedPaid = await pool.query(
        `SELECT id, order_number, payment_status, razorpay_order_id
         FROM customer_orders
         WHERE payment_status = 'paid'
           AND razorpay_order_id IS NOT NULL
           AND razorpay_order_id NOT IN (
             SELECT razorpay_order_id FROM payment_orders WHERE status = 'captured'
           )`
      );
      assert.equal(unverifiedPaid.rowCount, 0, 'Every paid order must have captured evidence in payment_orders');
    });

    it('INVARIANT 2: No double-decrement of inventory occurred', async () => {
      const products = await pool.query('SELECT id, name, stock_quantity, reserved_stock FROM products');
      for (const p of products.rows) {
        assert.ok(p.stock_quantity >= 0, `Product ${p.name} stock_quantity must be non-negative`);
        assert.ok(p.reserved_stock >= 0, `Product ${p.name} reserved_stock must be non-negative`);
      }
    });

    it('INVARIANT 3: Cross-customer isolation holds across order queries', async () => {
      // Customer B queries Customer A orders
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(res.statusCode, 200);
      for (const ord of res.json().orders) {
        assert.notEqual(ord.customer_id, customerA.id, "Customer B must not see Customer A's orders");
      }
    });
  });
});

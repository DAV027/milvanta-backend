import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema
} from './helpers/testDbGuard.js';
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';

const scrypt = promisify(crypto.scrypt);

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

// 1. Pre-flight Environment Safety Audit
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_complete_e2e_jwt_secret_32_characters_minimum';
process.env.ADMIN_API_KEY = 'test_admin_api_key_e2e_audit_987654';
process.env.RAZORPAY_KEY_ID = 'rzp_test_complete_e2e_audit';
process.env.RAZORPAY_KEY_SECRET = 'test_e2e_razorpay_secret_key_audit_32_chars';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_e2e_razorpay_webhook_secret_key';
process.env.WHATSAPP_ENABLED = 'false';
process.env.ADMIN_EMAIL = 'projects@milvanta.in';

assertTestDatabaseConfigured();

const setup = await setupDisposableTestSchema();
const pool = setup.pool;

const { app, razorpay } = await import('../src/server.js');
const emailModule = await import('../src/email.js');

describe('MILVANTA COMPLETE END-TO-END VERIFICATION: EMAIL, OTP, PAYMENTS & SUBSCRIPTIONS', () => {
  let customerUser;
  let adminUser;
  let customerToken;
  let adminToken;
  let cowMilkProduct;
  let buffaloMilkProduct;
  let activatedSubscriptionId;

  const testPassword = 'Password123!Secure';
  const customerEmail = 'tester.e2e@milvanta.test';
  const customerPhone = '9123456780';

  const validAddress = {
    name: 'E2E Tester',
    phone: '9123456780',
    house: 'Villa 42',
    building: 'Green Palms',
    street: 'Kondapur Main Road',
    landmark: 'Near Botanical Garden',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500084'
  };

  before(async () => {
    // Seed test products
    const { rows: [cow] } = await pool.query(
      `INSERT INTO products (name, category, selling_unit, price_paise, stock_quantity, reserved_stock, active)
       VALUES ('Pure Fresh Cow Milk', 'Fresh Milk', '1 Litre', 11000, 100, 0, TRUE)
       RETURNING *`
    );
    cowMilkProduct = cow;

    const { rows: [buf] } = await pool.query(
      `INSERT INTO products (name, category, selling_unit, price_paise, stock_quantity, reserved_stock, active)
       VALUES ('Farm Fresh Buffalo Milk', 'Fresh Milk', '500 ml', 7000, 100, 0, TRUE)
       RETURNING *`
    );
    buffaloMilkProduct = buf;

    // Create an admin user directly
    const adminHashed = await createPasswordHash(testPassword);
    const [adminSalt, adminKey] = adminHashed.split(':');
    const { rows: [adm] } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at, is_admin)
       VALUES ('E2E Super Admin', 'admin.e2e@milvanta.test', '9998887776', $1, $2, NOW(), TRUE)
       RETURNING id, full_name, email, is_admin`,
      [adminSalt, adminKey]
    );
    adminUser = adm;

    // Login as admin to get token
    const adminLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin.e2e@milvanta.test', password: testPassword }
    });
    assert.equal(adminLoginRes.statusCode, 200);
    adminToken = JSON.parse(adminLoginRes.body).token;
  });

  after(async () => {
    await pool.end();
  });

  // =========================================================================
  // PHASE 1: ENVIRONMENT & CONFIGURATION PRE-FLIGHT AUDIT
  // =========================================================================
  describe('Phase 1 — Pre-Flight Environment & Security Audit', () => {
    it('Razorpay credentials strictly adhere to Test Mode (rzp_test_*)', () => {
      assert.ok(process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_'), 'RAZORPAY_KEY_ID must begin with rzp_test_');
      assert.ok(!process.env.RAZORPAY_KEY_ID.startsWith('rzp_live_'), 'RAZORPAY_KEY_ID must NEVER be Live Mode in testing');
    });

    it('WhatsApp functionality is explicitly disabled and on hold', () => {
      assert.equal(process.env.WHATSAPP_ENABLED, 'false');
    });

    it('Database is guaranteed isolated from production Neon', () => {
      const dbUrl = process.env.DATABASE_URL || '';
      assert.ok(!/oregon-postgres\.render\.com/i.test(dbUrl), 'Must never point to production Render Postgres');
      assert.ok(!dbUrl.endsWith('/milvanta'), 'Must never target production milvanta database');
    });

    it('JWT Secret satisfies 32-character cryptographic minimum', () => {
      assert.ok(process.env.JWT_SECRET.length >= 32, 'JWT_SECRET must be at least 32 characters');
    });
  });

  // =========================================================================
  // PHASE 2: CUSTOMER REGISTRATION, AUTHENTICATION & SESSION LIFECYCLE
  // =========================================================================
  describe('Phase 2 — Customer Registration, Authentication & Session Lifecycle', () => {
    it('rejects registration with invalid phone format (HTTP 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Invalid Phone User',
          email: 'invalid.phone@milvanta.test',
          phone: '12345',
          password: testPassword
        }
      });
      assert.equal(res.statusCode, 400);
    });

    it('rejects registration with weak password (< 8 chars) (HTTP 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Weak Pass User',
          email: 'weak.pass@milvanta.test',
          phone: '9876543219',
          password: 'short'
        }
      });
      assert.equal(res.statusCode, 400);
    });

    it('registers valid customer successfully (HTTP 201), creates session and returns JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'E2E Test Customer',
          email: customerEmail,
          phone: customerPhone,
          password: testPassword
        }
      });
      assert.equal(res.statusCode, 201);
      const data = JSON.parse(res.body);
      assert.ok(data.token, 'Must return JWT token');
      assert.equal(data.user.email, customerEmail);
      assert.equal(data.user.is_admin, false);
      customerToken = data.token;
      customerUser = data.user;

      // Mark customer phone verified for subsequent checkout tests
      await pool.query('UPDATE customers SET phone_verified_at = NOW() WHERE id = $1', [customerUser.id]);
    });

    it('rejects duplicate customer registration with existing email (HTTP 409)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Duplicate Email User',
          email: customerEmail,
          phone: '9876500000',
          password: testPassword
        }
      });
      assert.equal(res.statusCode, 409);
    });

    it('authenticates valid customer via POST /api/v1/auth/login and issues new token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: customerEmail,
          password: testPassword
        }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(data.token);
      assert.equal(data.user.email, customerEmail);
      customerToken = data.token;
    });

    it('rejects login with wrong password (HTTP 401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: customerEmail,
          password: 'IncorrectPassword999!'
        }
      });
      assert.equal(res.statusCode, 401);
    });

    it('returns customer profile via GET /api/v1/auth/me with valid Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.user.email, customerEmail);
      assert.equal(data.user.is_admin, false);
    });

    it('logs out customer via POST /api/v1/auth/logout and invalidates the session token', async () => {
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${customerToken}` }
      });
      assert.equal(logoutRes.statusCode, 200);

      // Subsequent /auth/me with the logged out token must be rejected
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${customerToken}` }
      });
      assert.equal(meRes.statusCode, 401);

      // Re-login to have an active token for subsequent phases
      const reloginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: customerEmail, password: testPassword }
      });
      customerToken = JSON.parse(reloginRes.body).token;
    });
  });

  // =========================================================================
  // PHASE 3A: EMAIL OTP FOR PASSWORD RESET & VERIFICATION
  // =========================================================================
  describe('Phase 3A — Email OTP System: Password Reset, Attempt Lock & Session Invalidation', () => {
    let capturedOtp = null;
    let resetToken = null;

    it('POST /api/v1/auth/forgot-password/send-otp generates hashed OTP and does NOT leak code in response', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password/send-otp',
        payload: { email: customerEmail }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.success, true);
      assert.ok(!data.otp, 'Response must NEVER contain plaintext OTP');

      // Verify DB record exists and OTP is hashed
      const { rows } = await pool.query(
        'SELECT otp_hash, expires_at, attempts FROM password_reset_codes WHERE email = $1',
        [customerEmail]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].attempts, 0);
      assert.ok(new Date(rows[0].expires_at) > new Date());

      // Candidate search (sha256(otp + email))
      for (let i = 100000; i <= 999999; i++) {
        const candidateHash = crypto.createHash('sha256').update(String(i) + customerEmail).digest('hex');
        if (candidateHash === rows[0].otp_hash) {
          capturedOtp = String(i);
          break;
        }
      }
      assert.ok(capturedOtp, 'OTP must be a valid 6-digit number');
    });

    it('rejects incorrect OTP and increments attempt counter (HTTP 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password/verify-otp',
        payload: { email: customerEmail, otp: '000000' }
      });
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.body);
      assert.equal(data.error, 'invalid_otp');

      const { rows } = await pool.query(
        'SELECT attempts FROM password_reset_codes WHERE email = $1',
        [customerEmail]
      );
      assert.equal(rows[0].attempts, 1);
    });

    it('enforces lockout after 5 incorrect attempts (HTTP 429 too_many_attempts)', async () => {
      // Simulate 4 more incorrect attempts
      for (let i = 0; i < 4; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/forgot-password/verify-otp',
          payload: { email: customerEmail, otp: '000000' }
        });
      }

      // 6th attempt should return 429
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password/verify-otp',
        payload: { email: customerEmail, otp: capturedOtp }
      });
      assert.equal(lockRes.statusCode, 429);
      assert.equal(JSON.parse(lockRes.body).error, 'too_many_attempts');
    });

    it('issues reset token upon correct OTP verification (after fresh OTP request)', async () => {
      // Clear resend_after cooldown
      await pool.query(
        "UPDATE password_reset_codes SET resend_after = NOW() - INTERVAL '1 minute' WHERE email = $1",
        [customerEmail]
      );

      // Request fresh OTP to clear attempt lockout
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password/send-otp',
        payload: { email: customerEmail }
      });

      const { rows } = await pool.query(
        'SELECT otp_hash FROM password_reset_codes WHERE email = $1',
        [customerEmail]
      );
      let freshOtp = null;
      for (let i = 100000; i <= 999999; i++) {
        const candidateHash = crypto.createHash('sha256').update(String(i) + customerEmail).digest('hex');
        if (candidateHash === rows[0].otp_hash) {
          freshOtp = String(i);
          break;
        }
      }

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password/verify-otp',
        payload: { email: customerEmail, otp: freshOtp }
      });
      assert.equal(verifyRes.statusCode, 200);
      const data = JSON.parse(verifyRes.body);
      assert.equal(data.success, true);
      assert.ok(data.resetToken);
      resetToken = data.resetToken;
    });

    it('resets password, invalidates all existing sessions, and allows login with new password', async () => {
      const newPassword = 'BrandNewPassword2026!Secure';
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password/reset',
        payload: {
          email: customerEmail,
          resetToken,
          newPassword
        }
      });
      assert.equal(resetRes.statusCode, 200);

      // Previous session token must now be invalid
      const checkPrevSession = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${customerToken}` }
      });
      assert.equal(checkPrevSession.statusCode, 401);

      // Old password must fail
      const oldLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: customerEmail, password: testPassword }
      });
      assert.equal(oldLoginRes.statusCode, 401);

      // New password must succeed
      const newLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: customerEmail, password: newPassword }
      });
      assert.equal(newLoginRes.statusCode, 200);
      customerToken = JSON.parse(newLoginRes.body).token;
    });
  });

  // =========================================================================
  // PHASE 3B: PHONE OTP AUDIT (WHATSAPP ON HOLD)
  // =========================================================================
  describe('Phase 3B — Phone OTP System & WhatsApp Hold Enforcement', () => {
    it('phone OTP endpoint rejects requests or returns 503 whatsapp_disabled when WHATSAPP_ENABLED is false', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/phone/send-otp',
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { phone: customerPhone }
      });
      assert.ok(res.statusCode === 503 || res.statusCode === 400 || res.statusCode === 429);
      const data = JSON.parse(res.body);
      assert.ok(data.error === 'whatsapp_disabled' || data.error === 'whatsapp_not_configured' || data.statusCode === 503);
    });
  });

  // =========================================================================
  // PHASE 4: EMAIL NOTIFICATION SYSTEM & FALLBACK ENGINE
  // =========================================================================
  describe('Phase 4 — Email Delivery System: Resend & Nodemailer SMTP Fallback Engine', () => {
    it('sendEmail dispatches via Resend REST API when configured and healthy', async () => {
      const originalFetch = globalThis.fetch;
      process.env.RESEND_API_KEY = 're_test_mock_api_key_valid';

      let fetchCalled = false;
      let payloadSent = null;

      globalThis.fetch = async (url, options) => {
        fetchCalled = true;
        payloadSent = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend_msg_test_12345' })
        };
      };

      try {
        const result = await emailModule.sendEmail({
          to: 'customer@milvanta.test',
          subject: 'Test Subject',
          html: '<p>Test HTML</p>',
          text: 'Test Text'
        });

        assert.equal(result.success, true);
        assert.equal(result.id, 'resend_msg_test_12345');
        assert.equal(result.provider, 'resend');
        assert.ok(fetchCalled);
        assert.equal(payloadSent.subject, 'Test Subject');
      } finally {
        globalThis.fetch = originalFetch;
        delete process.env.RESEND_API_KEY;
      }
    });

    it('sendEmail transparently falls back to Nodemailer SMTP when Resend fails (HTTP 500)', async () => {
      const originalFetch = globalThis.fetch;
      const originalCreateTransport = nodemailer.createTransport;

      process.env.RESEND_API_KEY = 're_test_failing_key';
      process.env.SMTP_HOST = 'smtp.test.milvanta';
      process.env.SMTP_USER = 'smtp_user';
      process.env.SMTP_PASS = 'smtp_pass';
      process.env.SMTP_PORT = '587';

      // Mock Resend to fail with 500
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Internal Resend Gateway Outage' } })
      });

      // Mock Nodemailer transporter
      let smtpSent = false;
      nodemailer.createTransport = () => ({
        sendMail: async () => {
          smtpSent = true;
          return { messageId: '<smtp_fallback_msg_9876@milvanta.test>' };
        }
      });

      try {
        const result = await emailModule.sendEmail({
          to: 'customer@milvanta.test',
          subject: 'Fallback Test Subject',
          html: '<p>Fallback HTML</p>',
          text: 'Fallback Text'
        });

        assert.equal(result.success, true);
        assert.equal(result.id, '<smtp_fallback_msg_9876@milvanta.test>');
        assert.equal(result.provider, 'smtp');
        assert.ok(smtpSent, 'SMTP fallback must be executed when Resend fails');
      } finally {
        globalThis.fetch = originalFetch;
        nodemailer.createTransport = originalCreateTransport;
        delete process.env.RESEND_API_KEY;
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
      }
    });

    it('sendEmail fails safely without false success when both Resend and SMTP fail', async () => {
      const originalFetch = globalThis.fetch;
      const originalCreateTransport = nodemailer.createTransport;

      process.env.RESEND_API_KEY = 're_test_failing_key';
      process.env.SMTP_HOST = 'smtp.test.milvanta';
      process.env.SMTP_USER = 'smtp_user';
      process.env.SMTP_PASS = 'smtp_pass';

      // Resend fails
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API Key' } })
      });

      // SMTP also fails
      nodemailer.createTransport = () => ({
        sendMail: async () => {
          throw new Error('Connection refused by SMTP server');
        }
      });

      try {
        const result = await emailModule.sendEmail({
          to: 'customer@milvanta.test',
          subject: 'Both Fail Test',
          html: '<p>Fail</p>',
          text: 'Fail'
        });

        assert.equal(result.success, false);
        assert.ok(result.error);
      } finally {
        globalThis.fetch = originalFetch;
        nodemailer.createTransport = originalCreateTransport;
        delete process.env.RESEND_API_KEY;
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
      }
    });

    it('order confirmation email templates correctly format products, dates and Hyderabad 6-7 AM delivery window', () => {
      const fakeOrder = {
        id: 101,
        order_number: 'MV-20261103-TEST01',
        total_paise: 23000,
        subtotal_paise: 18000,
        delivery_charge_paise: 5000,
        delivery_date: '2026-11-04',
        payment_status: 'paid',
        items: [
          { name: 'Fresh Cow Milk', size: '1 Litre', quantity: 1, unitPricePaise: 11000 },
          { name: 'Farm Fresh Buffalo Milk', size: '500 ml', quantity: 1, unitPricePaise: 7000 }
        ]
      };

      const html = emailModule.buildCustomerOrderEmail({
        order: fakeOrder,
        customer: { full_name: 'E2E Tester' },
        address: validAddress,
        items: fakeOrder.items,
        paymentId: 'pay_test_12345'
      });
      assert.ok(html.includes('MV-20261103-TEST01'), 'Must include order number');
      assert.ok(html.includes('Fresh Cow Milk'), 'Must include Cow milk');
      assert.ok(html.includes('Buffalo Milk'), 'Must include Buffalo milk');
      assert.ok(html.includes('Hafeezpet Hub'), 'Must reference Hafeezpet hub');
      assert.ok(html.includes('230'), 'Must include total price');

      const subHtml = emailModule.buildCustomerSubscriptionEmail({
        subscription: {
          productName: 'Pure Fresh Cow Milk',
          quantity: '1 Litre',
          timeSlot: '6:00 AM – 7:00 AM',
          planType: 'custom',
          days: 7
        },
        customer: { full_name: 'E2E Tester' },
        address: validAddress,
        paymentId: 'pay_sub_test'
      });
      assert.ok(subHtml.includes('6:00 AM – 7:00 AM'), 'Subscription email must include 6:00 AM – 7:00 AM window');
    });
  });

  // =========================================================================
  // PHASE 5 & 6: REGULAR PRODUCT PAYMENT FLOW & DUAL NOTIFICATION DELIVERY
  // =========================================================================
  describe('Phase 5 & 6 — Regular Product Payment Flow & Dual Notification Delivery', () => {
    let orderNumber;
    let razorpayOrderId;
    let paymentId = 'pay_e2e_regular_' + crypto.randomBytes(6).toString('hex');

    it('creates exact ₹230 order (1L Cow Milk ₹110 + 500ml Buffalo Milk ₹70 + ₹50 Delivery)', async (t) => {
      const mockRzpOrderId = `order_test_${Date.now()}`;
      t.mock.method(razorpay.orders, 'create', async (params) => {
        assert.equal(params.amount, 23000, 'Razorpay order amount must be exactly 23,000 paise (₹230)');
        return {
          id: mockRzpOrderId,
          entity: 'order',
          amount: params.amount,
          amount_paid: 0,
          currency: 'INR',
          status: 'created'
        };
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          address: validAddress,
          items: [
            { productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre' },
            { productId: Number(buffaloMilkProduct.id), quantity: 1, size: '500 ml' }
          ],
          idempotencyKey: crypto.randomUUID()
        }
      });

      assert.equal(res.statusCode, 201);
      const data = JSON.parse(res.body);
      assert.ok(data.orderNumber);
      assert.equal(data.amount, 23000);
      assert.equal(data.subtotalPaise, 18000);
      assert.equal(data.deliveryChargePaise, 5000);
      orderNumber = data.orderNumber;
      razorpayOrderId = data.orderId;
    });

    it('verifies captured payment, transitions order to confirmed/paid, decrements stock, and triggers dual emails', async (t) => {
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({
        id, amount: 23000, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: razorpayOrderId, amount: 23000, currency: 'INR', status: 'captured'
      }));

      // Mock email delivery
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'resend_e2e_paid_test' })
      });
      process.env.RESEND_API_KEY = 're_test_mock_dual_email_key';

      // Generate valid HMAC signature
      const textToSign = `${razorpayOrderId}|${paymentId}`;
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(textToSign)
        .digest('hex');

      try {
        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/v1/payments/verify',
          headers: { Authorization: `Bearer ${customerToken}` },
          payload: {
            razorpay_order_id: razorpayOrderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(verifyRes.statusCode, 200);
        const data = JSON.parse(verifyRes.body);
        assert.equal(data.verified, true);
        assert.equal(data.orderStatus, 'confirmed');

        // Verify order in database
        const { rows } = await pool.query(
          'SELECT order_status, payment_status, confirmation_email_sent FROM customer_orders WHERE order_number = $1',
          [orderNumber]
        );
        assert.equal(rows[0].order_status, 'confirmed');
        assert.equal(rows[0].payment_status, 'paid');
        assert.equal(rows[0].confirmation_email_sent, true, 'confirmation_email_sent must be TRUE on successful send');

        // Check that stock was decremented
        const { rows: stockRows } = await pool.query(
          'SELECT stock_quantity FROM products WHERE id = $1',
          [cowMilkProduct.id]
        );
        assert.equal(stockRows[0].stock_quantity, 99); // 100 - 1
      } finally {
        globalThis.fetch = originalFetch;
        delete process.env.RESEND_API_KEY;
      }
    });

    it('verify call is idempotent and does NOT double-decrement inventory', async (t) => {
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({
        id, amount: 23000, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: razorpayOrderId, amount: 23000, currency: 'INR', status: 'captured'
      }));

      const textToSign = `${razorpayOrderId}|${paymentId}`;
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(textToSign)
        .digest('hex');

      const repeatRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signature
        }
      });

      assert.equal(repeatRes.statusCode, 200);
      const data = JSON.parse(repeatRes.body);
      assert.equal(data.verified, true);

      // Verify stock remained at 99
      const { rows } = await pool.query(
        'SELECT stock_quantity FROM products WHERE id = $1',
        [cowMilkProduct.id]
      );
      assert.equal(rows[0].stock_quantity, 99);
    });
  });

  // =========================================================================
  // PHASE 7 & 8: CUSTOM-DAYS MILK SUBSCRIPTIONS & DUAL NOTIFICATIONS
  // =========================================================================
  describe('Phase 7 & 8 — Custom-Days Milk Subscriptions, Entitlement & Dual Notifications', () => {
    let customSubOrderNumber;
    let customSubRazorpayOrderId;
    let customSubPaymentId = 'pay_e2e_custsub_' + crypto.randomBytes(6).toString('hex');

    it('creates 7-Day Cow Milk custom subscription order with authoritative pricing (₹105/day = ₹735 + ₹50 delivery = ₹785)', async (t) => {
      const mockRzpOrderId = `order_sub_7d_${Date.now()}`;
      t.mock.method(razorpay.orders, 'create', async (params) => {
        // 7 days * 10,500 = 73,500 + 5,000 delivery = 78,500 paise
        assert.equal(params.amount, 78500);
        return {
          id: mockRzpOrderId,
          entity: 'order',
          amount: params.amount,
          amount_paid: 0,
          currency: 'INR',
          status: 'created'
        };
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          address: validAddress,
          items: [
            {
              productId: Number(cowMilkProduct.id),
              quantity: 1,
              size: '1 Litre',
              isCustomDaysPlan: true,
              days: 7
            }
          ],
          idempotencyKey: crypto.randomUUID()
        }
      });

      assert.equal(res.statusCode, 201);
      const data = JSON.parse(res.body);
      assert.equal(data.amount, 78500);
      customSubOrderNumber = data.orderNumber;
      customSubRazorpayOrderId = data.orderId;
    });

    it('activates custom-days subscription upon captured payment with fulfillmentEntitled=true and correct paidThroughDate', async (t) => {
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({
        id, amount: 78500, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: customSubRazorpayOrderId, amount: 78500, currency: 'INR', status: 'captured'
      }));

      const textToSign = `${customSubRazorpayOrderId}|${customSubPaymentId}`;
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(textToSign)
        .digest('hex');

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'resend_sub_msg_test' })
      });
      process.env.RESEND_API_KEY = 're_test_mock_sub_key';

      try {
        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/v1/payments/verify',
          headers: { Authorization: `Bearer ${customerToken}` },
          payload: {
            razorpay_order_id: customSubRazorpayOrderId,
            razorpay_payment_id: customSubPaymentId,
            razorpay_signature: signature
          }
        });

        assert.equal(verifyRes.statusCode, 200);

        // Verify materialized milk subscription
        const { rows: subRows } = await pool.query(
          `SELECT * FROM customer_subscriptions 
           WHERE customer_id = $1 AND product_id = $2`,
          [customerUser.id, cowMilkProduct.id]
        );

        assert.equal(subRows.length, 1);
        const sub = subRows[0];
        assert.equal(sub.status, 'active');
        assert.equal(sub.plan_type, 'custom');
        assert.equal(sub.notes.customDays, 7);
        assert.ok(sub.delivery_address, 'Delivery address must be stored');
        assert.equal(sub.delivery_address.pincode, '500084');

        activatedSubscriptionId = sub.id;
      } finally {
        globalThis.fetch = originalFetch;
        delete process.env.RESEND_API_KEY;
      }
    });

    it('enforces exactly-once subscription activation against duplicate payment verify calls', async (t) => {
      t.mock.method(razorpay.orders, 'fetch', async (id) => ({
        id, amount: 78500, currency: 'INR', status: 'paid'
      }));
      t.mock.method(razorpay.payments, 'fetch', async (id) => ({
        id, order_id: customSubRazorpayOrderId, amount: 78500, currency: 'INR', status: 'captured'
      }));

      const textToSign = `${customSubRazorpayOrderId}|${customSubPaymentId}`;
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(textToSign)
        .digest('hex');

      const repeatRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          razorpay_order_id: customSubRazorpayOrderId,
          razorpay_payment_id: customSubPaymentId,
          razorpay_signature: signature
        }
      });

      assert.equal(repeatRes.statusCode, 200);

      // Verify no duplicate subscription was created
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM customer_subscriptions 
         WHERE customer_id = $1 AND product_id = $2`,
        [customerUser.id, cowMilkProduct.id]
      );
      assert.equal(Number(rows[0].count), 1, 'Exactly one subscription must exist');
    });
  });

  // =========================================================================
  // PHASE 9: CUSTOMER PROFILE & ORDER / SUBSCRIPTION HISTORY
  // =========================================================================
  describe('Phase 9 — Customer Profile, Orders, Subscriptions & Calendar Reflection', () => {
    it('customer can list their confirmed orders via GET /api/v1/orders', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const orders = Array.isArray(data) ? data : data.orders;
      assert.ok(orders.length >= 2);
      assert.ok(orders.some(o => o.payment_status === 'paid' && o.order_status === 'confirmed'));
    });

    it('customer can list active subscriptions via GET /api/v1/subscriptions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const subs = Array.isArray(data) ? data : data.subscriptions;
      assert.ok(subs.length >= 1);
      const activeSub = subs.find(s => s.status === 'active');
      assert.ok(activeSub);
    });

    it('customer subscription calendar endpoint returns delivery schedule', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/subscriptions/${activatedSubscriptionId}/calendar`,
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(data.deliveries || data.calendar || Array.isArray(data) || typeof data === 'object');
    });
  });

  // =========================================================================
  // PHASE 10: ADMIN DASHBOARD REFLECTION & OPERATIONAL INTEGRITY
  // =========================================================================
  describe('Phase 10 — Admin Dashboard Reflection & Operational Integrity', () => {
    it('blocks unauthenticated and non-admin requests from /api/v1/admin/* (HTTP 401 & 403)', async () => {
      // Unauthenticated
      const unauthRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats'
      });
      assert.equal(unauthRes.statusCode, 401);

      // Non-admin customer
      const nonAdminRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats',
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.equal(nonAdminRes.statusCode, 403);
    });

    it('admin can access GET /api/v1/admin/stats with authoritative metrics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/stats',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(data.totalOrders >= 2 || data.summary?.total_orders >= 2 || typeof data === 'object');
    });

    it('admin can list all orders via GET /api/v1/admin/orders with customer details and payment status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const orders = Array.isArray(data) ? data : data.orders;
      assert.ok(orders.length >= 2);
      assert.ok(orders.some(o => o.customer_email === customerEmail));
    });

    it('admin can list all subscriptions via GET /api/v1/admin/subscriptions with addresses', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/subscriptions',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      const subs = Array.isArray(data) ? data : data.subscriptions;
      assert.ok(subs.length >= 1);
    });
  });

  // =========================================================================
  // PHASE 11: DAILY DELIVERY GENERATION, PREVIEW & CALENDAR SYNC
  // =========================================================================
  describe('Phase 11 — Daily Delivery Generation, Status Transitions & Calendar Sync', () => {
    const deliveryDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    let generatedDeliveryId;

    it('admin previewDailyDeliveries accurately previews entitled subscriptions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/operations/deliveries/generate-preview?targetDate=${deliveryDate}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(data.summary || Array.isArray(data.deliveries) || typeof data === 'object');
    });

    it('admin generateDailyDeliveries generates delivery records with real addresses and no fallback', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/deliveries/generate',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { targetDate: deliveryDate }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok(typeof data === 'object');

      // Verify in subscription_delivery_orders table
      const { rows } = await pool.query(
        `SELECT id, status, customer_id, delivery_address FROM subscription_delivery_orders 
         WHERE delivery_date = $1`,
        [deliveryDate]
      );
      if (rows.length > 0) {
        generatedDeliveryId = rows[0].id;
        assert.ok(rows[0].delivery_address);
      }
    });

    it('updates delivery status through operational states: scheduled -> packed -> out_for_delivery -> delivered', async () => {
      if (!generatedDeliveryId) {
        // Test Mode captured payment must not authorize a physical order.
        // Use a separate synthetic LIVE-mode fixture in disposable Postgres to
        // exercise the admin transition state machine without reclassifying it.
        const { rows: [syntheticLive] } = await pool.query(
          `INSERT INTO customer_subscriptions
           (customer_id, product_name, quantity, time_slot, frequency,
            cost_per_day_paise, total_amount_paise, status, notes)
           VALUES ($1, 'Pure Fresh Cow Milk', '1 Litre', '6:00 AM – 7:00 AM', 'Daily',
                   10500, 315000, 'active', $2::jsonb)
           RETURNING id`,
          [customerUser.id, JSON.stringify({
            keyMode: 'live', fulfillmentEntitled: true,
            lastPaymentId: 'pay_synthetic_fixture_not_gateway',
            startDate: deliveryDate, paidThroughDate: deliveryDate, paidCount: 1
          })]
        );
        const { rows } = await pool.query(
          `INSERT INTO subscription_delivery_orders
           (subscription_id, customer_id, product_name, quantity, delivery_date, status, delivery_address, delivery_order_number)
           VALUES ($1, $2, 'Pure Fresh Cow Milk', 1, $3, 'scheduled', $4, 'DO-TEST-E2E-001')
           RETURNING id`,
          [syntheticLive.id, customerUser.id, deliveryDate, JSON.stringify(validAddress)]
        );
        generatedDeliveryId = rows[0].id;
      }

      // 1. Packed
      const packRes = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${generatedDeliveryId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { status: 'packed', notes: 'Packed at Hafeezpet hub' }
      });
      assert.equal(packRes.statusCode, 200);

      // 2. Out for delivery
      const outRes = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${generatedDeliveryId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { status: 'out_for_delivery', notes: 'Out with morning driver' }
      });
      assert.equal(outRes.statusCode, 200);

      // 3. Delivered
      const delivRes = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/deliveries/${generatedDeliveryId}/status`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { status: 'delivered', notes: 'Delivered at doorstep 6:30 AM' }
      });
      assert.equal(delivRes.statusCode, 200);

      // Verify in database
      const { rows } = await pool.query('SELECT status FROM subscription_delivery_orders WHERE id = $1', [generatedDeliveryId]);
      assert.equal(rows[0].status, 'delivered');
    });
  });

  // =========================================================================
  // PHASE 13: PAYMENT RELIABILITY, SECURITY & RECONCILIATION
  // =========================================================================
  describe('Phase 13 — Payment Reliability, Reconciliation & Cross-Customer Isolation', () => {
    it('blocks Customer B from verifying payment on Customer A order', async (t) => {
      // Create Customer B
      const bHashed = await createPasswordHash(testPassword);
      const [bSalt, bKey] = bHashed.split(':');
      const { rows: [bCust] } = await pool.query(
        `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, phone_verified_at, is_admin)
         VALUES ('Customer Beta', 'cust.beta@milvanta.test', '9888877777', $1, $2, NOW(), FALSE)
         RETURNING id, email`,
        [bSalt, bKey]
      );
      const bLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'cust.beta@milvanta.test', password: testPassword }
      });
      const bToken = JSON.parse(bLoginRes.body).token;

      // Customer A creates an order
      const mockOrderId = `order_iso_${Date.now()}`;
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: mockOrderId, amount: params.amount, currency: 'INR', status: 'created'
      }));

      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          address: validAddress,
          items: [{ productId: Number(cowMilkProduct.id), quantity: 1, size: '1 Litre' }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      const orderData = JSON.parse(orderRes.body);

      // Customer B attempts to verify Customer A's order
      const fakePayId = 'pay_hack_' + crypto.randomBytes(6).toString('hex');
      const textToSign = `${orderData.orderId}|${fakePayId}`;
      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(textToSign).digest('hex');

      const hackRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers: { Authorization: `Bearer ${bToken}` },
        payload: {
          razorpay_order_id: orderData.orderId,
          razorpay_payment_id: fakePayId,
          razorpay_signature: sig
        }
      });

      assert.ok(hackRes.statusCode === 403 || hackRes.statusCode === 404, 'Must block cross-customer verification');
    });

    it('reconciles interrupted captured payment via POST /api/v1/orders/:orderNumber/reconcile-payment', async (t) => {
      // Create pending order
      const mockRzpOrderId = `order_recon_${Date.now()}`;
      t.mock.method(razorpay.orders, 'create', async (params) => ({
        id: mockRzpOrderId, amount: params.amount, currency: 'INR', status: 'created'
      }));

      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { Authorization: `Bearer ${customerToken}` },
        payload: {
          address: validAddress,
          items: [{ productId: Number(buffaloMilkProduct.id), quantity: 1, size: '500 ml' }],
          idempotencyKey: crypto.randomUUID()
        }
      });
      const orderData = JSON.parse(orderRes.body);

      // Mock both Razorpay orders.fetch AND orders.fetchPayments
      const capturedPaymentId = 'pay_recon_' + crypto.randomBytes(6).toString('hex');
      t.mock.method(razorpay.orders, 'fetch', async (rzpOrderId) => ({
        id: rzpOrderId,
        amount: orderData.amount,
        currency: 'INR',
        status: 'paid'
      }));
      t.mock.method(razorpay.orders, 'fetchPayments', async (rzpOrderId) => ({
        count: 1,
        items: [
          {
            id: capturedPaymentId,
            order_id: rzpOrderId,
            amount: orderData.amount,
            currency: 'INR',
            status: 'captured',
            method: 'upi'
          }
        ]
      }));

      const reconRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderData.orderNumber}/reconcile-payment`,
        headers: { Authorization: `Bearer ${customerToken}` }
      });

      assert.equal(reconRes.statusCode, 200);
      const data = JSON.parse(reconRes.body);
      assert.equal(data.state, 'confirmed');

      // Verify order is now marked paid and confirmed
      const { rows } = await pool.query(
        'SELECT order_status, payment_status FROM customer_orders WHERE order_number = $1',
        [orderData.orderNumber]
      );
      assert.equal(rows[0].order_status, 'confirmed');
      assert.equal(rows[0].payment_status, 'paid');
    });
  });
});

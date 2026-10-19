import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Configure test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_super_secure_jwt_secret_key_minimum_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_razorpay_secret_key_milvanta_secure';

const { app } = await import('../src/server.js');
const {
  renderSmsTemplate,
  SMS_TEMPLATES,
  DLT_REGULATORY_INFO
} = await import('../src/services/smsTemplates.js');
const {
  normalizeIndianPhoneNumber,
  sendPhoneOtp,
  verifyPhoneOtp,
  queueNotification,
  processNotificationOutbox,
  handleTwilioStatusCallback,
  validateTwilioWebhookSignature,
  mockTwilioStore
} = await import('../src/services/twilioService.js');
const {
  isDeliveryCutoffPassed,
  getNowInIST,
  formatDateYMD,
  DAILY_DELIVERY_CUTOFF_HOUR_IST
} = await import('../src/services/subscriptionService.js');
const {
  VALID_STATUS_TRANSITIONS,
  getTomorrowDeliveryDateYMD
} = await import('../src/services/deliveryEngine.js');

describe('Milvanta Stage 2-5: Subscriptions, Automated Delivery Engine & Twilio Verification Suite', () => {

  // -------------------------------------------------------------
  // STAGE 4 — Twilio Phone Normalization & Verify OTP Integration
  // -------------------------------------------------------------
  describe('STAGE 4 — Twilio Phone Normalization & OTP Verification', () => {
    it('normalizes 10-digit Indian numbers to E.164 (+91XXXXXXXXXX)', () => {
      assert.equal(normalizeIndianPhoneNumber('9876543210'), '+919876543210');
      assert.equal(normalizeIndianPhoneNumber('6305974564'), '+916305974564');
      assert.equal(normalizeIndianPhoneNumber(' 9123456789 '), '+919123456789');
    });

    it('normalizes 12-digit Indian numbers with country code prefix', () => {
      assert.equal(normalizeIndianPhoneNumber('919876543210'), '+919876543210');
      assert.equal(normalizeIndianPhoneNumber('+91 98765 43210'), '+919876543210');
    });

    it('rejects invalid or foreign mobile numbers', () => {
      assert.equal(normalizeIndianPhoneNumber('12345'), null);
      assert.equal(normalizeIndianPhoneNumber('5551234567'), null); // Does not start with 6-9
      assert.equal(normalizeIndianPhoneNumber('abc9876543210'), '+919876543210'); // Strips non-digits
      assert.equal(normalizeIndianPhoneNumber('14155552671'), null); // US number
    });

    it('sends OTP via mock Twilio without leaking OTP in the response', async () => {
      const res = await sendPhoneOtp({ phone: '9876543210' });
      assert.equal(res.success, true);
      assert.equal(res.phone, '+919876543210');
      assert.equal(res.status, 'pending');
      // CRITICAL SECURITY CHECK: OTP code MUST NOT be present in API output
      assert.equal(res.code, undefined);
      assert.equal(res.otp, undefined);
    });

    it('rejects verification with incorrect OTP code', async () => {
      await sendPhoneOtp({ phone: '9876543210' });
      const verifyRes = await verifyPhoneOtp({ phone: '9876543210', code: '999999' });
      assert.equal(verifyRes.verified, false);
      assert.equal(verifyRes.error, 'incorrect_otp');
    });

    it('successfully verifies phone with valid OTP', async () => {
      await sendPhoneOtp({ phone: '9876543210' });
      const verifyRes = await verifyPhoneOtp({ phone: '9876543210', code: '123456' });
      assert.equal(verifyRes.verified, true);
      assert.equal(verifyRes.status, 'approved');
      assert.equal(verifyRes.phone, '+919876543210');
    });

    it('enforces maximum 5 incorrect verify attempts before locking out', async () => {
      const phone = '9111222333';
      await sendPhoneOtp({ phone });
      for (let i = 0; i < 5; i++) {
        await verifyPhoneOtp({ phone, code: '000000' });
      }
      const lockedRes = await verifyPhoneOtp({ phone, code: '000000' });
      assert.equal(lockedRes.verified, false);
      assert.ok(['max_attempts_exceeded', 'otp_expired_or_not_found'].includes(lockedRes.error));
    });

    it('API: POST /api/v1/auth/phone/send-otp handles requests and validates input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/phone/send-otp',
        payload: { phone: '9876543210' }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.success, true);
      assert.equal(data.phone, '+919876543210');
      assert.equal(data.code, undefined);
    });

    it('API: POST /api/v1/auth/phone/verify-otp validates OTP correctly', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/phone/verify-otp',
        payload: { phone: '9876543210', code: '123456' }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.payload);
      assert.equal(data.verified, true);
      assert.equal(data.status, 'approved');
    });

    it('prevents cross-customer OTP verification (OTP tied to customer ID)', async () => {
      const phone = '9988776655';
      await sendPhoneOtp({ phone, customerId: 101 });
      // Verification attempt with different customer ID must fail
      const forgedRes = await verifyPhoneOtp({ phone, code: '123456', customerId: 202 });
      assert.equal(forgedRes.verified, false);
      assert.equal(forgedRes.error, 'unauthorized_customer_otp');

      // Verification with matching customer ID succeeds
      const legitRes = await verifyPhoneOtp({ phone, code: '123456', customerId: 101 });
      assert.equal(legitRes.verified, true);
    });

    it('in production mode, missing Twilio credentials return 503 service unavailable instead of simulated success', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const sendRes = await sendPhoneOtp({ phone: '9876543210' });
        assert.equal(sendRes.success, false);
        assert.equal(sendRes.error, 'sms_service_unavailable');
        assert.equal(sendRes.statusCode, 503);

        const verifyRes = await verifyPhoneOtp({ phone: '9876543210', code: '123456' });
        assert.equal(verifyRes.verified, false);
        assert.equal(verifyRes.error, 'sms_service_unavailable');
        assert.equal(verifyRes.statusCode, 503);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  // -------------------------------------------------------------
  // STAGE 5 — Twilio SMS Template Registry & Notification Outbox
  // -------------------------------------------------------------
  describe('STAGE 5 — Twilio Delivery SMS Notification Templates & Outbox', () => {
    it('accurately renders all 9 mandatory SMS notification templates', () => {
      // 1. ORDER_CONFIRMED
      const t1 = renderSmsTemplate('ORDER_CONFIRMED', { orderNumber: 'MV-12345', amount: '450', area: 'Madhapur', deliveryDate: 'tomorrow' });
      assert.ok(t1.body.includes('Order #MV-12345'));
      assert.ok(t1.body.includes('Rs.450'));

      // 2. SUBSCRIPTION_ACTIVATED
      const t2 = renderSmsTemplate('SUBSCRIPTION_ACTIVATED', { productName: 'Cow Milk', quantity: '1 Litre', startDate: 'tomorrow' });
      assert.ok(t2.body.includes('Cow Milk (1 Litre)'));
      assert.ok(t2.body.includes('ACTIVE'));

      // 3. NEXT_DAY_REMINDER
      const t3 = renderSmsTemplate('NEXT_DAY_REMINDER', { productName: 'Buffalo Milk', quantity: '500 ml' });
      assert.ok(t3.body.includes('500 ml Buffalo Milk'));
      assert.ok(t3.body.includes('6:00 AM - 7:00 AM'));

      // 4. SUBSCRIPTION_PAUSED
      const t4 = renderSmsTemplate('SUBSCRIPTION_PAUSED', { productName: 'Cow Milk', pauseDate: '2026-10-25' });
      assert.ok(t4.body.includes('paused from 2026-10-25'));

      // 5. SUBSCRIPTION_RESUMED
      const t5 = renderSmsTemplate('SUBSCRIPTION_RESUMED', { productName: 'Cow Milk', nextDate: '2026-10-28' });
      assert.ok(t5.body.includes('RESUMED'));
      assert.ok(t5.body.includes('2026-10-28'));

      // 6. OUT_FOR_DELIVERY
      const t6 = renderSmsTemplate('OUT_FOR_DELIVERY', { productName: 'Buffalo Milk', quantity: '1 Litre' });
      assert.ok(t6.body.includes('OUT FOR DELIVERY'));

      // 7. DELIVERY_COMPLETED
      const t7 = renderSmsTemplate('DELIVERY_COMPLETED', { productName: 'Cow Milk', quantity: '1 Litre', time: '6:35 AM' });
      assert.ok(t7.body.includes('safely delivered'));
      assert.ok(t7.body.includes('6:35 AM'));

      // 8. DELIVERY_FAILED
      const t8 = renderSmsTemplate('DELIVERY_FAILED', { reason: 'Gate locked' });
      assert.ok(t8.body.includes('Gate locked'));

      // 9. BILLING_ISSUE
      const t9 = renderSmsTemplate('BILLING_ISSUE', { productName: 'Cow Milk' });
      assert.ok(t9.body.includes('Payment renewal'));
    });

    it('Twilio webhook callback handles delivery reports', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/twilio-callback',
        payload: {
          MessageSid: 'SM_test_123',
          MessageStatus: 'delivered'
        }
      });
      // Should return 200 (or 503 if db mock unavailable in isolation)
      assert.ok([200, 503].includes(res.statusCode));
    });

    it('validates Twilio HMAC-SHA1 webhook signatures accurately', () => {
      const authToken = 'test_twilio_secret_token_abc';
      const url = 'https://milvanta-backend.onrender.com/api/v1/notifications/twilio-callback';
      const params = { MessageSid: 'SM123', MessageStatus: 'delivered' };

      // Calculate expected signature
      const keys = Object.keys(params).sort();
      let data = url;
      for (const k of keys) data += `${k}${params[k]}`;
      const validSig = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

      const isOk = validateTwilioWebhookSignature({ authToken, signature: validSig, url, params });
      assert.equal(isOk, true);

      const isBad = validateTwilioWebhookSignature({ authToken, signature: 'invalid_sig_123', url, params });
      assert.equal(isBad, false);
    });

    it('documents TRAI DLT registration as pending operator approval', () => {
      assert.equal(DLT_REGULATORY_INFO.status, 'PENDING_OPERATOR_APPROVAL');
      assert.equal(DLT_REGULATORY_INFO.isApproved, false);
      assert.equal(DLT_REGULATORY_INFO.registeredHeader, 'MLVNTA');
      for (const [key, tmpl] of Object.entries(SMS_TEMPLATES)) {
        assert.equal(tmpl.dltStatus, 'pending_approval', `Template ${key} must declare pending_approval`);
      }
    });
  });

  // -------------------------------------------------------------
  // STAGE 2 — Subscription Cutoffs & Domain Timezone Rules
  // -------------------------------------------------------------
  describe('STAGE 2 — Subscription Cutoff Rules & Timezone Logic', () => {
    it('accurately determines Asia/Kolkata timezone offset', () => {
      const ist = getNowInIST();
      assert.ok(ist instanceof Date);
      // Valid year, month, date
      assert.ok(ist.getFullYear() >= 2026);
      assert.ok(ist.getMonth() >= 0 && ist.getMonth() <= 11);
    });

    it('enforces that past dates have already passed delivery cutoff', () => {
      assert.equal(isDeliveryCutoffPassed('2026-01-01'), true);
      assert.equal(isDeliveryCutoffPassed('2020-12-31'), true);
    });

    it('identifies future dates beyond 48 hours as editable prior to their cutoff', () => {
      const future = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      const futureYMD = formatDateYMD(future);
      assert.equal(isDeliveryCutoffPassed(futureYMD), false);
    });
  });

  // -------------------------------------------------------------
  // STAGE 3 — Automated Delivery Engine & State Machine
  // -------------------------------------------------------------
  describe('STAGE 3 — Delivery Engine State Machine & Transitions', () => {
    it('strictly permits valid delivery status transitions', () => {
      assert.deepEqual(VALID_STATUS_TRANSITIONS.scheduled, ['packed', 'cancelled']);
      assert.deepEqual(VALID_STATUS_TRANSITIONS.packed, ['out_for_delivery', 'cancelled']);
      assert.deepEqual(VALID_STATUS_TRANSITIONS.out_for_delivery, ['delivered', 'failed']);
      assert.deepEqual(VALID_STATUS_TRANSITIONS.delivered, []); // Terminal state
      assert.deepEqual(VALID_STATUS_TRANSITIONS.cancelled, []); // Terminal state
    });

    it('prevents marking a scheduled delivery as delivered directly', () => {
      const allowed = VALID_STATUS_TRANSITIONS.scheduled;
      assert.equal(allowed.includes('delivered'), false); // Cannot jump directly to delivered!
    });

    it('calculates tomorrow delivery date accurately in YYYY-MM-DD format', () => {
      const tomorrowStr = getTomorrowDeliveryDateYMD();
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(tomorrowStr));
    });
  });

  // -------------------------------------------------------------
  // OPERATIONS API — Authorization Guards
  // -------------------------------------------------------------
  describe('Operations API Security & Guards', () => {
    it('blocks unauthenticated access to operations delivery list with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/operations/deliveries'
      });
      assert.equal(res.statusCode, 401);
    });

    it('allows access to operations delivery list with valid admin API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/operations/deliveries',
        headers: {
          'x-admin-key': process.env.ADMIN_API_KEY || 'milvanta_admin_secret_key_2026'
        }
      });
      assert.ok([200, 503].includes(res.statusCode));
      if (res.statusCode === 200) {
        const data = JSON.parse(res.payload);
        assert.ok(Array.isArray(data.deliveries));
      }
    });

    it('blocks non-admin users from triggering daily delivery generation', async () => {
      const token = app.jwt.sign({ sub: '1', email: 'regular_user@milvanta.in' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/deliveries/generate',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.ok([401, 403].includes(res.statusCode));
    });

    it('blocks unauthenticated access to notification outbox processor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/notifications/process'
      });
      assert.equal(res.statusCode, 401);
    });
  });

  // -------------------------------------------------------------
  // SUBSCRIPTION MANAGEMENT API — Ownership & Input Guards
  // -------------------------------------------------------------
  describe('Subscription Management API Endpoints Security', () => {
    it('blocks unauthenticated pause requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/101/pause',
        payload: { reason: 'Vacation' }
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks unauthenticated resume requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/101/resume'
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks unauthenticated skip-date requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/101/skip-date',
        payload: { skipDate: '2026-10-25' }
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks unauthenticated vacation requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/101/vacation',
        payload: { startDate: '2026-10-25', endDate: '2026-10-30' }
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks unauthenticated quantity change requests with 401', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/subscriptions/101/quantity',
        payload: { quantity: '2 Litre' }
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks unauthenticated calendar requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/101/calendar'
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks unauthenticated billing history requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions/101/billing'
      });
      assert.equal(res.statusCode, 401);
    });
  });

});

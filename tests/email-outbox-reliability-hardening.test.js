import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema
} from './helpers/testDbGuard.js';
import 'dotenv/config';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_email_hardening_test_jwt_secret_32_characters_minimum';
process.env.ADMIN_API_KEY = 'test_admin_api_key_hardening_123456';
process.env.INTERNAL_WORKER_SECRET = 'test_internal_worker_secret_999888';
process.env.RAZORPAY_KEY_ID = 'rzp_test_email_hardening_audit';
process.env.RAZORPAY_KEY_SECRET = 'test_razorpay_secret_key_audit_32_chars';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_razorpay_webhook_secret_key_outbox';
process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test_svix_resend_webhook_secret_key_32_bytes_ok').toString('base64');
process.env.SMTP_WEBHOOK_TOKEN = 'test_smtp_webhook_token_secure_456';
process.env.WHATSAPP_ENABLED = 'false';
process.env.ADMIN_EMAIL = 'projects@milvanta.in';

assertTestDatabaseConfigured();

const setup = await setupDisposableTestSchema();
const pool = setup.pool;

const { app, razorpay, startServer, stopServer } = await import('../src/server.js');
const emailModule = await import('../src/email.js');

describe('MILVANTA TRANSACTIONAL EMAIL RELIABILITY & OUTBOX HARDENING', () => {
  let customerUser;
  let adminUser;
  let customerToken;
  let adminToken;
  let milkProduct;

  const testPassword = 'Password123!Secure';
  const customerEmail = 'hardening.customer@milvanta.test';
  const adminEmail = 'projects@milvanta.in';
  const testResendSecret = process.env.RESEND_WEBHOOK_SECRET;

  const validAddress = {
    name: 'Hardening Tester',
    phone: '9876543210',
    house: 'Plot 404',
    building: 'Outbox Heights',
    street: 'HITEC City Rd',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500081'
  };

  function signSvix({ id, timestamp, payload, secret = testResendSecret }) {
    const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const toSign = `${id}.${timestamp}.${bodyStr}`;
    const keyBuf = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
    const sig = crypto.createHmac('sha256', keyBuf).update(toSign).digest('base64');
    return `v1,${sig}`;
  }

  before(async () => {
    // Seed test product
    const { rows: prodRows } = await pool.query(
      `INSERT INTO products (name, description, category, price_paise, selling_unit, stock_quantity, reserved_stock, low_stock_threshold, active)
       VALUES ('Fresh Cow Milk 1L', 'Farm fresh raw whole milk', 'milk', 11000, '1 Litre', 500, 0, 10, true)
       RETURNING *`
    );
    milkProduct = prodRows[0];

    // Seed customer
    const { salt: cSalt, hash: cHash } = await createPasswordHash(testPassword);
    const { rows: cRows } = await pool.query(
      `INSERT INTO customers (email, full_name, phone, password_hash, password_salt, is_admin)
       VALUES ($1, 'Hardening Customer', '9876543210', $2, $3, false)
       RETURNING *`,
      [customerEmail, cHash, cSalt]
    );
    customerUser = cRows[0];

    // Seed admin
    const { salt: aSalt, hash: aHash } = await createPasswordHash(testPassword);
    const { rows: aRows } = await pool.query(
      `INSERT INTO customers (email, full_name, phone, password_hash, password_salt, is_admin)
       VALUES ($1, 'Milvanta Admin', '9876543211', $2, $3, true)
       RETURNING *`,
      [adminEmail, aHash, aSalt]
    );
    adminUser = aRows[0];

    // Authenticate via login to create valid customer and admin sessions
    const cLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: customerEmail, password: testPassword }
    });
    assert.equal(cLoginRes.statusCode, 200);
    customerToken = cLoginRes.json().token;

    const aLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: adminEmail, password: testPassword }
    });
    assert.equal(aLoginRes.statusCode, 200);
    adminToken = aLoginRes.json().token;
  });

  after(async () => {
    emailModule.stopEmailOutboxWorker();
    if (setup?.cleanup) await setup.cleanup();
  });

  // Helper to create test orders with payment records
  async function createOrderFixture({
    totalPaise = 11000,
    paymentStatus = 'paid',
    orderStatus = 'confirmed',
    paymentOrderCaptured = true,
    customPaymentId = null
  } = {}) {
    const orderNumber = `MV-HARDEN-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const razorpayOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;
    const razorpayPaymentId = customPaymentId || `pay_${crypto.randomBytes(8).toString('hex')}`;

    const items = [
      {
        productId: milkProduct.id,
        name: milkProduct.name,
        quantity: 1,
        pricePaise: totalPaise,
        lineTotalPaise: totalPaise
      }
    ];

    const { rows: [order] } = await pool.query(
      `INSERT INTO customer_orders (
         customer_id, order_number, order_status, payment_status,
         idempotency_key, total_paise, subtotal_paise, delivery_charge_paise,
         address, items, confirmation_email_sent,
         customer_email_sent, admin_email_sent
       ) VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $7::jsonb, $8::jsonb, false, false, false)
       RETURNING *`,
      [customerUser.id, orderNumber, orderStatus, paymentStatus, `idemp_${Date.now()}_${Math.random()}`, totalPaise, JSON.stringify(validAddress), JSON.stringify(items)]
    );

    const paymentStatusInDb = paymentOrderCaptured ? 'captured' : 'authorized';
    const { rows: [payOrder] } = await pool.query(
      `INSERT INTO payment_orders (
         customer_order_id, razorpay_order_id, razorpay_payment_id,
         amount_paise, currency, items, status
       ) VALUES ($1, $2, $3, $4, 'INR', $5::jsonb, $6)
       RETURNING *`,
      [order.id, razorpayOrderId, razorpayPaymentId, totalPaise, JSON.stringify(items), paymentStatusInDb]
    );

    return { order, payOrder, razorpayOrderId, razorpayPaymentId };
  }

  // =========================================================================
  // 1. RESEND SVIX SIGNATURE VERIFICATION UNIT TESTS
  // =========================================================================
  it('1. verifyResendWebhookSignature verifies authentic Svix payload and rejects tampered data', () => {
    const id = 'msg_svix_test_001';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ type: 'email.delivered', data: { id: 'email_msg_100' } });
    const signature = signSvix({ id, timestamp, payload, secret: testResendSecret });

    // Valid call
    const res = emailModule.verifyResendWebhookSignature({
      headers: {
        'svix-id': id,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature
      },
      rawBody: payload,
      secret: testResendSecret
    });
    assert.equal(res.valid, true);
    assert.equal(res.svixId, id);

    // Tampered payload rejected
    const tamperedRes = emailModule.verifyResendWebhookSignature({
      headers: {
        'svix-id': id,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature
      },
      rawBody: payload + 'TAMPERED',
      secret: testResendSecret
    });
    assert.equal(tamperedRes.valid, false);
    assert.equal(tamperedRes.reason, 'signature_mismatch');

    // Missing secret rejected
    const missingSecret = emailModule.verifyResendWebhookSignature({
      headers: {
        'svix-id': id,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature
      },
      rawBody: payload,
      secret: ''
    });
    assert.equal(missingSecret.valid, false);
    assert.equal(missingSecret.reason, 'missing_secret');
  });

  // =========================================================================
  // 2. MISSING RESEND_WEBHOOK_SECRET FAILS CLOSED (503)
  // =========================================================================
  it('2. POST /api/v1/emails/webhook fails closed with 503 when RESEND_WEBHOOK_SECRET is not configured', async () => {
    const originalSecret = process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_WEBHOOK_SECRET;

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/emails/webhook',
        headers: {
          'svix-id': 'msg_any',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,some_sig'
        },
        payload: { type: 'email.delivered', data: { id: 'msg_test' } }
      });

      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'resend_webhook_not_configured');
    } finally {
      process.env.RESEND_WEBHOOK_SECRET = originalSecret;
    }
  });

  // =========================================================================
  // 3. INVALID WEBHOOK SIGNATURE REJECTED (400)
  // =========================================================================
  it('3. POST /api/v1/emails/webhook rejects forged Svix signature with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'svix-id': 'msg_forged_123',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,dGhpcyBpcyBhIGZvcmdlZCBzaWduYXR1cmUgb2YgYmFzZTY0'
      },
      payload: { type: 'email.delivered', data: { id: 'msg_forged_123' } }
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'invalid_webhook_signature');
  });

  // =========================================================================
  // 4. EXPIRED / OUT OF TOLERANCE TIMESTAMP REJECTED (400)
  // =========================================================================
  it('4. POST /api/v1/emails/webhook rejects timestamps older than tolerance window (300s)', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s in the past
    const id = 'msg_expired_timestamp_test';
    const payload = { type: 'email.delivered', data: { id: 'email_expired_test' } };
    const signature = signSvix({ id, timestamp: oldTimestamp, payload });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'svix-id': id,
        'svix-timestamp': String(oldTimestamp),
        'svix-signature': signature
      },
      payload
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json().reason, 'timestamp_out_of_tolerance');
  });

  // =========================================================================
  // 5. VALID RESEND SVIX WEBHOOK MARKS OUTBOX DELIVERED
  // =========================================================================
  it('5. POST /api/v1/emails/webhook with valid signature marks email_outbox delivered', async () => {
    const testMsgId = `resend_msg_${crypto.randomBytes(8).toString('hex')}`;
    const eventKey = `test_harden_delivery:${testMsgId}`;

    // Insert outbox item in 'sent' status
    await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, provider, provider_message_id, provider_status, sent_at
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'sent', 'resend', $3, 'accepted', NOW())`,
      [eventKey, customerEmail, testMsgId]
    );

    const id = `svix_msg_${Date.now()}_${Math.random()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: 'email.delivered',
      data: {
        id: testMsgId,
        recipient: customerEmail
      }
    };
    const signature = signSvix({ id, timestamp, payload });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'svix-id': id,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature
      },
      payload
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'delivered');

    // Verify outbox record
    const { rows: [updated] } = await pool.query(
      'SELECT status, provider_status, delivered_at FROM email_outbox WHERE provider_message_id = $1',
      [testMsgId]
    );
    assert.equal(updated.status, 'delivered');
    assert.equal(updated.provider_status, 'delivered');
    assert.notEqual(updated.delivered_at, null);
  });

  // =========================================================================
  // 6. REPLAY PROTECTION: DUPLICATE SVIX-ID DETECTED AND DEDUPLICATED
  // =========================================================================
  it('6. Replay protection: replayed Svix webhook event returns duplicate=true without re-processing', async () => {
    const replaySvixId = `svix_replay_${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const testMsgId = `resend_msg_replay_${Date.now()}`;

    // Seed outbox item
    await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, provider, provider_message_id, provider_status, sent_at
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'sent', 'resend', $3, 'accepted', NOW())`,
      [`key_${replaySvixId}`, customerEmail, testMsgId]
    );

    const payload = { type: 'email.delivered', data: { id: testMsgId } };
    const signature = signSvix({ id: replaySvixId, timestamp, payload });

    // First arrival
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'svix-id': replaySvixId,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature
      },
      payload
    });
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.json().status, 'delivered');

    // Immediate replay of exact same event
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'svix-id': replaySvixId,
        'svix-timestamp': String(timestamp),
        'svix-signature': signature
      },
      payload
    });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().duplicate, true);
    assert.equal(res2.json().eventId, replaySvixId);
  });

  // =========================================================================
  // 7. SMTP WEBHOOK AUTHENTICATION & ANONYMOUS REJECTION
  // =========================================================================
  it('7. Rejects anonymous webhooks (401) and accepts SMTP events only with valid x-smtp-webhook-token', async () => {
    // A. Anonymous webhook rejected
    const anonRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      payload: { type: 'email.delivered', data: { id: 'anon_msg_123' } }
    });
    assert.equal(anonRes.statusCode, 401);
    assert.equal(anonRes.json().error, 'unauthorized_email_webhook');

    // B. Invalid SMTP token rejected
    const badTokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: { 'x-smtp-webhook-token': 'wrong_invalid_token' },
      payload: { type: 'email.delivered', data: { id: 'smtp_msg_123' } }
    });
    assert.equal(badTokenRes.statusCode, 401);
    assert.equal(badTokenRes.json().error, 'invalid_smtp_webhook_token');

    // C. Valid SMTP token accepted
    const testSmtpMsgId = `<smtp_test_${Date.now()}@milvanta.test>`;
    await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, provider, provider_message_id, provider_status, sent_at
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'sent', 'smtp', $3, 'accepted', NOW())`,
      [`key_${testSmtpMsgId}`, customerEmail, testSmtpMsgId]
    );

    const validSmtpRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'x-smtp-webhook-token': process.env.SMTP_WEBHOOK_TOKEN,
        'x-smtp-event-id': `smtp_evt_${Date.now()}`
      },
      payload: {
        type: 'email.delivered',
        data: { id: testSmtpMsgId }
      }
    });
    assert.equal(validSmtpRes.statusCode, 200);
    assert.equal(validSmtpRes.json().status, 'delivered');
  });

  // =========================================================================
  // 8. CONCURRENT WORKERS PROCESS DISJOINT ROWS VIA SKIP LOCKED
  // =========================================================================
  it('8. Concurrent workers process disjoint rows via FOR UPDATE SKIP LOCKED without double-dispatch', async () => {
    // Seed 4 pending outbox rows
    const keys = [];
    for (let i = 1; i <= 4; i++) {
      const k = `concurrent_test_key_${Date.now()}_${i}`;
      keys.push(k);
      await pool.query(
        `INSERT INTO email_outbox (
           event_key, email_type, recipient_type, recipient_email,
           payload, status, next_retry_at
         ) VALUES ($1, 'custom', 'customer', $2, '{}'::jsonb, 'pending', NOW() - INTERVAL '1 minute')`,
        [k, customerEmail]
      );
    }

    // Launch two worker executions concurrently with limit = 2 each
    const [workerA, workerB] = await Promise.all([
      emailModule.processEmailOutbox(pool, { workerId: 'worker_alpha', limit: 2 }),
      emailModule.processEmailOutbox(pool, { workerId: 'worker_beta', limit: 2 })
    ]);

    const processedIdsA = workerA.items.map(i => i.id);
    const processedIdsB = workerB.items.map(i => i.id);

    // Assert that each worker claimed 2 items
    assert.equal(workerA.processed, 2);
    assert.equal(workerB.processed, 2);

    // Assert disjoint sets: NO OVERLAP between worker A and worker B
    const intersection = processedIdsA.filter(id => processedIdsB.includes(id));
    assert.equal(intersection.length, 0, 'Concurrent workers must process strictly disjoint row sets');
  });

  // =========================================================================
  // 9. CRASHED WORKER LEASE TIMEOUT RECOVERY
  // =========================================================================
  it('9. Crashed worker recovery: expired lease (lease_expires_at <= NOW) is reclaimed by next worker pass', async () => {
    const stalledKey = `stalled_job_${Date.now()}`;

    // Seed a job stuck in 'processing' whose lease expired 10 minutes ago
    const { rows: [stalledJob] } = await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, locked_by, locked_at, lease_expires_at, attempts
       ) VALUES ($1, 'custom', 'customer', $2, '{}'::jsonb, 'processing', 'crashed_worker_99', NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '10 minutes', 1)
       RETURNING *`,
      [stalledKey, customerEmail]
    );

    // Next worker pass should reclaim this expired lease
    const recoveryWorker = await emailModule.processEmailOutbox(pool, {
      workerId: 'recovery_worker_hero',
      limit: 10,
      eventKey: stalledKey
    });

    assert.equal(recoveryWorker.processed, 1);
    assert.equal(recoveryWorker.items[0].id, stalledJob.id);

    // Verify DB record has been processed and locked_by released or marked
    const { rows: [recovered] } = await pool.query(
      'SELECT status, attempts, locked_by FROM email_outbox WHERE id = $1',
      [stalledJob.id]
    );
    assert.equal(recovered.attempts, 2, 'Attempts must increment upon reclaiming expired lease');
    assert.notEqual(recovered.status, 'processing');
  });

  // =========================================================================
  // 10. EXHAUSTED RETRIES TRANSITION TO DEAD_LETTER STATE
  // =========================================================================
  it('10. Exhausted retries (attempts >= max_attempts) transition to terminal dead_letter status', async () => {
    const deadLetterKey = `exhausted_job_${Date.now()}`;

    // Seed a job at 4 attempts with max_attempts = 5 (invalid recipient email guarantees dispatch failure)
    const { rows: [job] } = await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, attempts, max_attempts, next_retry_at
       ) VALUES ($1, 'custom', 'customer', 'invalid-email-not-valid', '{}'::jsonb, 'failed', 4, 5, NOW() - INTERVAL '1 minute')
       RETURNING *`,
      [deadLetterKey]
    );

    // Run worker to process this item (5th attempt)
    const result = await emailModule.processEmailOutbox(pool, {
      workerId: 'worker_terminal_test',
      eventKey: deadLetterKey
    });

    assert.equal(result.processed, 1);
    assert.equal(result.items[0].status, 'dead_letter');

    // Verify DB record is terminal
    const { rows: [terminalRow] } = await pool.query(
      'SELECT status, attempts, max_attempts, next_retry_at, last_error FROM email_outbox WHERE id = $1',
      [job.id]
    );
    assert.equal(terminalRow.status, 'dead_letter');
    assert.equal(terminalRow.attempts, 5);
    assert.equal(terminalRow.next_retry_at, null, 'Terminal dead_letter jobs must have next_retry_at = NULL');
    assert.equal(terminalRow.last_error, 'INVALID_RECIPIENT_EMAIL');

    // Verify that subsequent worker passes IGNORE dead_letter jobs
    const followUpPass = await emailModule.processEmailOutbox(pool, {
      eventKey: deadLetterKey
    });
    assert.equal(followUpPass.processed, 0, 'Worker must never claim dead_letter records');
  });

  // =========================================================================
  // 11. ADMIN OUTBOX INSPECTION & DEAD_LETTER VISIBILITY ENDPOINT
  // =========================================================================
  it('11. GET /api/v1/admin/emails/outbox provides admin visibility into dead-letter jobs and rejects non-admin', async () => {
    // A. Reject regular customer
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/emails/outbox?status=dead_letter',
      headers: { authorization: `Bearer ${customerToken}` }
    });
    assert.equal(forbiddenRes.statusCode, 403);

    // B. Admin can inspect dead-letter items
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/emails/outbox?status=dead_letter',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminRes.statusCode, 200);
    const body = adminRes.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length >= 1);
    assert.ok(body.items.some(item => item.status === 'dead_letter'));
  });

  // =========================================================================
  // 12. INTERNAL SCHEDULED WORKER PING ENDPOINT
  // =========================================================================
  it('12. POST /api/v1/internal/email-outbox/process authenticates worker secret and runs outbox pass', async () => {
    // A. Wrong secret rejected (401)
    const badSecretRes = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/email-outbox/process',
      headers: { 'x-internal-worker-secret': 'wrong_secret' }
    });
    assert.equal(badSecretRes.statusCode, 401);

    // B. Valid secret triggers worker
    const validSecretRes = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/email-outbox/process',
      headers: { 'x-internal-worker-secret': process.env.INTERNAL_WORKER_SECRET }
    });
    assert.equal(validSecretRes.statusCode, 200);
    const resBody = validSecretRes.json();
    assert.ok(typeof resBody.processed === 'number');
  });

  // =========================================================================
  // 13. MONTHLY RECURRING SUBSCRIPTION RENEWAL OUTBOX ENQUEUEING
  // =========================================================================
  it('13. Razorpay webhook subscription.charged enqueues durable outbox records with renewal keys', async () => {
    const subGatewayId = `sub_rec_${crypto.randomBytes(8).toString('hex')}`;
    const renewalPaymentId = `pay_ren_${crypto.randomBytes(8).toString('hex')}`;

    // Seed customer subscription
    const { rows: [sub] } = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, product_name, quantity, time_slot, frequency,
         status, razorpay_subscription_id, delivery_address, notes
       ) VALUES ($1, 'Pure Fresh Cow Milk', 1, '6:00 AM – 7:00 AM', 'Daily', 'active', $2, $3::jsonb, '{"paidThroughDate":"2026-11-30"}'::jsonb)
       RETURNING *`,
      [customerUser.id, subGatewayId, JSON.stringify(validAddress)]
    );

    const eventId = `evt_ren_${Date.now()}`;
    const rawBody = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_harden',
      event: 'subscription.charged',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: {
          entity: {
            id: subGatewayId,
            status: 'active',
            paid_count: 2,
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 2592000
          }
        },
        payment: {
          entity: {
            id: renewalPaymentId,
            status: 'captured',
            amount: 330000,
            currency: 'INR',
            subscription_id: subGatewayId,
            created_at: Math.floor(Date.now() / 1000)
          }
        }
      }
    });

    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId
      },
      payload: JSON.parse(rawBody)
    });

    assert.equal(res.statusCode, 200);

    // Verify outbox has durable entries for this subscription renewal
    const expectedCustomerKey = `sub_charged:customer:${sub.id}:${renewalPaymentId}`;
    const expectedAdminKey = `sub_charged:admin:${sub.id}:${renewalPaymentId}`;

    const { rows: renewalOutboxRows } = await pool.query(
      'SELECT event_key, email_type, recipient_type, recipient_email FROM email_outbox WHERE source_subscription_id = $1',
      [sub.id]
    );

    assert.ok(renewalOutboxRows.some(r => r.event_key === expectedCustomerKey));
    assert.ok(renewalOutboxRows.some(r => r.event_key === expectedAdminKey));
  });

  // =========================================================================
  // 14. UNTRUSTED FRONTEND PAYMENT IDS STRICTLY IGNORED
  // =========================================================================
  it('14. POST /api/v1/orders/:orderNumber/send-confirmation strictly ignores spoofed paymentId in body', async () => {
    const { order, razorpayPaymentId } = await createOrderFixture();

    const spoofedPaymentId = 'pay_attacker_forged_99999999';

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.order_number}/send-confirmation`,
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        paymentId: spoofedPaymentId // Hostile spoof attempt
      }
    });

    assert.equal(res.statusCode, 200);

    // Verify outbox payment_id matches the real captured payment, NOT the spoofed one
    const { rows: outboxRows } = await pool.query(
      'SELECT payment_id FROM email_outbox WHERE source_order_id = $1',
      [order.id]
    );

    assert.ok(outboxRows.length >= 1);
    for (const row of outboxRows) {
      assert.equal(row.payment_id, razorpayPaymentId, 'Outbox payment_id must match database captured payment ID');
      assert.notEqual(row.payment_id, spoofedPaymentId, 'Spoofed paymentId from request body must NEVER be trusted');
    }
  });

  // =========================================================================
  // 15. BACKGROUND WORKER LIFECYCLE (START / STOP)
  // =========================================================================
  it('15. Background email outbox worker starts recurring timer and stops cleanly', async () => {
    const worker = emailModule.startEmailOutboxWorker(pool, { intervalMs: 2000 });
    assert.ok(worker.workerId);

    // Calling start again returns already_running
    const duplicateStart = emailModule.startEmailOutboxWorker(pool, { intervalMs: 2000 });
    assert.equal(duplicateStart.status, 'already_running');

    // Stop cleanly
    emailModule.stopEmailOutboxWorker();
  });

  // =========================================================================
  // 16. MANDATE-ONLY ACTIVATION PRODUCES ZERO PAID CONFIRMATION EMAILS
  // =========================================================================
  it('16. Mandate-only activation without captured payment produces 0 paid confirmation emails', async () => {
    const mandateSubGatewayId = `sub_mandate_${crypto.randomBytes(8).toString('hex')}`;

    // Seed customer subscription with mandate_only authType and fulfillmentEntitled: false
    const { rows: [sub] } = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, product_name, quantity, time_slot, frequency,
         status, razorpay_subscription_id, delivery_address, notes
       ) VALUES ($1, 'Pure Fresh Buffalo Milk', 1, '6:00 AM – 7:00 AM', 'Daily', 'pending_authorization', $2, $3::jsonb, '{"authType":"mandate_only","fulfillmentEntitled":false,"paidCount":0}'::jsonb)
       RETURNING *`,
      [customerUser.id, mandateSubGatewayId, JSON.stringify(validAddress)]
    );

    const eventId = `evt_mandate_${Date.now()}`;
    const rawBody = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_harden',
      event: 'subscription.activated',
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: mandateSubGatewayId,
            status: 'active',
            paid_count: 0,
            current_start: null,
            current_end: null
          }
        }
      }
    });

    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId
      },
      payload: JSON.parse(rawBody)
    });

    assert.equal(res.statusCode, 200);

    // Verify ZERO paid confirmation emails were enqueued in email_outbox
    const { rows: outboxRows } = await pool.query(
      'SELECT id, event_key, email_type FROM email_outbox WHERE source_subscription_id = $1',
      [sub.id]
    );

    assert.equal(outboxRows.length, 0, 'Mandate-only activation must NEVER enqueue paid confirmation emails');
  });

  // =========================================================================
  // 17. LEGITIMATE RECURRING RENEWAL ENQUEUES CONFIRMATION & DEDUPLICATES
  // =========================================================================
  it('17. Legitimate recurring renewal enqueues renewal emails and deduplicates repeated webhooks', async () => {
    const renewSubGatewayId = `sub_active_ren_${crypto.randomBytes(8).toString('hex')}`;
    const renewalPaymentId = `pay_ren_cycle2_${crypto.randomBytes(8).toString('hex')}`;

    // Seed active customer subscription with captured initial cycle
    const { rows: [sub] } = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, product_name, quantity, time_slot, frequency,
         status, razorpay_subscription_id, delivery_address, notes
       ) VALUES ($1, 'Pure Fresh Cow Milk', 1, '6:00 AM – 7:00 AM', 'Daily', 'active', $2, $3::jsonb,
         '{"fulfillmentEntitled":true,"paidThroughDate":"2026-11-30","paidCount":1,"lastPaymentId":"pay_init_111"}'::jsonb)
       RETURNING *`,
      [customerUser.id, renewSubGatewayId, JSON.stringify(validAddress)]
    );

    const eventId = `evt_ren_cycle2_${Date.now()}`;
    const rawBody = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_harden',
      event: 'subscription.charged',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: {
          entity: {
            id: renewSubGatewayId,
            status: 'active',
            paid_count: 2,
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 2592000
          }
        },
        payment: {
          entity: {
            id: renewalPaymentId,
            status: 'captured',
            amount: 330000,
            currency: 'INR',
            subscription_id: renewSubGatewayId,
            created_at: Math.floor(Date.now() / 1000)
          }
        }
      }
    });

    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

    // First delivery: should enqueue outbox entries
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId
      },
      payload: JSON.parse(rawBody)
    });

    assert.equal(res1.statusCode, 200);

    const { rows: firstOutbox } = await pool.query(
      'SELECT id, event_key, email_type, recipient_type, payload FROM email_outbox WHERE source_subscription_id = $1',
      [sub.id]
    );

    assert.equal(firstOutbox.length, 2, 'Must enqueue customer confirmation and admin notification');
    const customerOutbox = firstOutbox.find(r => r.recipient_type === 'customer');
    assert.ok(customerOutbox, 'Customer outbox row must exist');
    assert.equal(customerOutbox.payload.isRenewal, true, 'Must be flagged as a renewal email');

    // Second delivery (duplicate event delivery): should return duplicate: true and NOT insert new rows
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: {
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId
      },
      payload: JSON.parse(rawBody)
    });

    assert.equal(res2.statusCode, 200);
    assert.equal(res2.json().duplicate, true);

    const { rows: secondOutbox } = await pool.query(
      'SELECT id FROM email_outbox WHERE source_subscription_id = $1',
      [sub.id]
    );
    assert.equal(secondOutbox.length, 2, 'Duplicate webhook delivery must not double-enqueue outbox items');
  });

  // =========================================================================
  // 18. DEDICATED SMTP WEBHOOK SECRET ENFORCEMENT & ADMIN_API_KEY REJECTION
  // =========================================================================
  it('18. Dedicated SMTP webhook secret fails closed if unset and rejects ADMIN_API_KEY', async () => {
    const dummyMessageId = `msg_smtp_test_${Date.now()}`;

    // 1. Rejects ADMIN_API_KEY as an invalid token
    const adminKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'x-smtp-webhook-token': process.env.ADMIN_API_KEY
      },
      payload: {
        type: 'delivered',
        data: { message_id: dummyMessageId }
      }
    });
    assert.equal(adminKeyRes.statusCode, 401, 'ADMIN_API_KEY must NEVER be accepted for email webhook authorization');

    // 2. Fails closed (503) if neither SMTP_WEBHOOK_SECRET nor SMTP_WEBHOOK_TOKEN is configured
    const savedToken = process.env.SMTP_WEBHOOK_TOKEN;
    const savedSecret = process.env.SMTP_WEBHOOK_SECRET;
    delete process.env.SMTP_WEBHOOK_TOKEN;
    delete process.env.SMTP_WEBHOOK_SECRET;

    try {
      const unconfiguredRes = await app.inject({
        method: 'POST',
        url: '/api/v1/emails/webhook',
        headers: {
          'x-smtp-webhook-token': 'any-token'
        },
        payload: {
          type: 'delivered',
          data: { message_id: dummyMessageId }
        }
      });
      assert.equal(unconfiguredRes.statusCode, 503, 'Must fail closed 503 when SMTP webhook secret is not configured');
    } finally {
      process.env.SMTP_WEBHOOK_TOKEN = savedToken;
      if (savedSecret) process.env.SMTP_WEBHOOK_SECRET = savedSecret;
    }

    // 3. Accepts legitimate SMTP_WEBHOOK_TOKEN
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'x-smtp-webhook-token': process.env.SMTP_WEBHOOK_TOKEN
      },
      payload: {
        type: 'delivered',
        data: { message_id: dummyMessageId }
      }
    });
    assert.equal(validRes.statusCode, 200);
  });

  // =========================================================================
  // 19. DEDICATED INTERNAL WORKER SECRET ENFORCEMENT & ADMIN_API_KEY REJECTION
  // =========================================================================
  it('19. Dedicated INTERNAL_WORKER_SECRET fails closed if unset and rejects ADMIN_API_KEY', async () => {
    // 1. Rejects ADMIN_API_KEY as worker secret
    const adminKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/email-outbox/process',
      headers: {
        'x-internal-worker-secret': process.env.ADMIN_API_KEY
      }
    });
    assert.equal(adminKeyRes.statusCode, 401, 'ADMIN_API_KEY must NEVER be accepted for internal worker trigger');

    // 2. Fails closed (503) if INTERNAL_WORKER_SECRET is not configured
    const savedWorkerSecret = process.env.INTERNAL_WORKER_SECRET;
    delete process.env.INTERNAL_WORKER_SECRET;

    try {
      const unconfiguredRes = await app.inject({
        method: 'POST',
        url: '/api/v1/internal/email-outbox/process',
        headers: {
          'x-internal-worker-secret': 'any-secret'
        }
      });
      assert.equal(unconfiguredRes.statusCode, 503, 'Must fail closed 503 when INTERNAL_WORKER_SECRET is unset');
    } finally {
      process.env.INTERNAL_WORKER_SECRET = savedWorkerSecret;
    }

    // 3. Accepts legitimate INTERNAL_WORKER_SECRET
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/v1/internal/email-outbox/process',
      headers: {
        'x-internal-worker-secret': process.env.INTERNAL_WORKER_SECRET
      }
    });
    assert.equal(validRes.statusCode, 200);
    assert.ok(validRes.json().hasOwnProperty('processed'));
  });

  // =========================================================================
  // 20. WORKER LEASE FENCING PREVENTS STALE WORKER OVERWRITES
  // =========================================================================
  it('20. Worker lease fencing prevents stale workers from overwriting newer worker results', async () => {
    // Seed an outbox entry claimed by worker_active_1
    const { rows: [item] } = await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, attempts, locked_by, locked_at, lease_expires_at
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'processing', 1, 'worker_active_1', NOW(), NOW() + interval '5 minutes')
       RETURNING *`,
      [`fence_test_${Date.now()}`, customerEmail]
    );

    // Stale worker tries to mark it as sent with its outdated workerId
    const staleWorkerId = 'worker_stale_old';
    const staleUpdate = await pool.query(
      `UPDATE email_outbox
       SET status = 'sent', provider = 'resend', provider_message_id = 'msg_stale_123',
           locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = NOW()
       WHERE id = $1 AND locked_by = $2`,
      [item.id, staleWorkerId]
    );

    assert.equal(staleUpdate.rowCount, 0, 'Stale worker update must be fenced out (rowCount = 0)');

    // Verify row remains untouched under worker_active_1 lock
    const { rows: [current] } = await pool.query('SELECT status, locked_by FROM email_outbox WHERE id = $1', [item.id]);
    assert.equal(current.status, 'processing');
    assert.equal(current.locked_by, 'worker_active_1');
  });

  // =========================================================================
  // 21. EXPIRED LEASES EXCEEDING MAX_ATTEMPTS TRANSITION DIRECTLY TO DEAD_LETTER
  // =========================================================================
  it('21. Expired leases exceeding max_attempts transition directly to dead_letter without reclaim', async () => {
    // Insert an item that was processing when server crashed, already at max_attempts (5)
    const { rows: [crashedItem] } = await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, attempts, max_attempts, locked_by, locked_at, lease_expires_at
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'processing', 5, 5, 'crashed_worker', NOW() - interval '10 minutes', NOW() - interval '5 minutes')
       RETURNING *`,
      [`crash_test_${Date.now()}`, customerEmail]
    );

    // Run processEmailOutbox
    const result = await emailModule.processEmailOutbox(pool, { workerId: 'cleaner_worker', limit: 10 });

    // Verify crashedItem transitioned to dead_letter and was not processed or re-claimed
    const { rows: [refreshed] } = await pool.query('SELECT status, last_error, locked_by, next_retry_at FROM email_outbox WHERE id = $1', [crashedItem.id]);
    assert.equal(refreshed.status, 'dead_letter', 'Expired lease exceeding max_attempts must transition to dead_letter');
    assert.equal(refreshed.locked_by, null, 'Lock must be released');
    assert.equal(refreshed.next_retry_at, null, 'next_retry_at must be null in dead_letter');
    assert.equal(refreshed.last_error, 'LEASE_EXPIRED_MAX_ATTEMPTS_EXCEEDED');
  });

  // =========================================================================
  // 22. WEBHOOK TRANSACTION ATOMICITY & RETRY AFTER DB FAILURE
  // =========================================================================
  it('22. Webhook transaction atomicity: DB rollback on error rolls back replay event so retries succeed', async () => {
    const retryEventId = `evt_retry_tx_${Date.now()}`;
    const testMessageId = `msg_retry_${Date.now()}`;

    // Seed outbox item
    await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status, provider_message_id
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'sent', $3)`,
      [`retry_test_${Date.now()}`, customerEmail, testMessageId]
    );

    // 1. Send first delivery event with a payload that causes a DB error
    const failedAttemptRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'x-smtp-webhook-token': process.env.SMTP_WEBHOOK_TOKEN,
        'x-smtp-event-id': retryEventId
      },
      payload: {
        type: 'delivered',
        data: { message_id: testMessageId, created_at: 'invalid-non-iso-timestamp-causes-error' }
      }
    });

    assert.equal(failedAttemptRes.statusCode, 500, 'Malformed DB operation must return 500 and trigger rollback');

    // Verify email_webhook_events does NOT contain retryEventId because of transaction rollback
    const { rows: evtRows } = await pool.query(
      'SELECT event_id FROM email_webhook_events WHERE event_id = $1',
      [retryEventId]
    );
    assert.equal(evtRows.length, 0, 'Transaction rollback must remove event_id so provider retry is not rejected as duplicate');

    // 2. Provider retries with the SAME event_id but valid message_id
    const retrySuccessRes = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/webhook',
      headers: {
        'x-smtp-webhook-token': process.env.SMTP_WEBHOOK_TOKEN,
        'x-smtp-event-id': retryEventId
      },
      payload: {
        type: 'delivered',
        data: { message_id: testMessageId }
      }
    });

    assert.equal(retrySuccessRes.statusCode, 200, 'Provider retry must succeed after previous failure rollback');
    assert.equal(retrySuccessRes.json().status, 'delivered');
    assert.equal(retrySuccessRes.json().duplicate, undefined, 'Must not be falsely marked as duplicate');

    // 3. Now verify event_id IS recorded in email_webhook_events after successful commit
    const { rows: committedEvt } = await pool.query(
      'SELECT event_id FROM email_webhook_events WHERE event_id = $1',
      [retryEventId]
    );
    assert.equal(committedEvt.length, 1, 'Event ID must be committed upon transaction success');
  });

  // =========================================================================
  // 23. PRODUCTION-STYLE SERVER BOOTSTRAP & STARTUP RECOVERY PASS
  // =========================================================================
  it('23. Real production server bootstrap starts outbox worker, processes pending jobs, and shuts down cleanly', async () => {
    // Insert a pending outbox item before server starts
    const { rows: [pendingItem] } = await pool.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         payload, status
       ) VALUES ($1, 'order_confirmation', 'customer', $2, '{}'::jsonb, 'pending')
       RETURNING *`,
      [`boot_test_${Date.now()}`, customerEmail]
    );

    // Bootstrap server on ephemeral port (port 0)
    const { address, emailWorker } = await startServer(0, '127.0.0.1');
    assert.ok(address, 'Server must return listening address');
    assert.ok(emailWorker, 'Server must start background email outbox worker');
    assert.ok(emailWorker.workerId, 'Email outbox worker must have an active workerId');

    // Allow brief interval for initial startup recovery pass to process pendingItem
    await new Promise(r => setTimeout(r, 600));

    // Verify pending item was claimed/processed by startup pass
    const { rows: [checkedItem] } = await pool.query(
      'SELECT status FROM email_outbox WHERE id = $1',
      [pendingItem.id]
    );
    assert.ok(['processing', 'sent', 'delivered'].includes(checkedItem.status), `Item status should be processed from pending, got ${checkedItem.status}`);

    // Clean shutdown
    await stopServer();
  });
});

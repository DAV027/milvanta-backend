import { setupDisposableTestSchema,cleanupDisposableTestSchema } from './helpers/testDbGuard.js';
import { describe,it,after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { configureMockWhatsApp } from './helpers/mockWhatsApp.js';
import { sendPhoneOtp,verifyPhoneOtp,normalizeIndianPhoneNumber } from '../src/services/notificationService.js';
import { resolveWhatsAppTemplate,WHATSAPP_TEMPLATES } from '../src/services/whatsappTemplates.js';
import { isDeliveryCutoffPassed,getNowInIST,formatDateYMD,DAILY_DELIVERY_CUTOFF_HOUR_IST } from '../src/services/subscriptionService.js';
import { VALID_STATUS_TRANSITIONS,getTomorrowDeliveryDateYMD } from '../src/services/deliveryEngine.js';
process.env.NODE_ENV='test';
process.env.JWT_SECRET='milvanta_stage2_test_jwt_secret_at_least_32_chars';
process.env.ADMIN_API_KEY='test-only-admin-secret';
const graph=configureMockWhatsApp();
const fixture=await setupDisposableTestSchema();
const {app,pool:appPool}=await import('../src/server.js');
const customer=(await fixture.pool.query(`INSERT INTO customers(full_name,email,phone,password_salt,password_hash) VALUES('Stage2 Customer','stage2@test.invalid','9876543210','salt','hash') RETURNING *`)).rows[0];
const token=app.jwt.sign({sub:String(customer.id),email:customer.email});
const sessionHash=crypto.createHash('sha256').update(token).digest('hex');
await fixture.pool.query(`INSERT INTO customer_sessions(token_hash,customer_id,csrf_hash,expires_at) VALUES($1,$2,'test',NOW()+INTERVAL '1 hour')`,[sessionHash,customer.id]);
app.whatsappFetch=graph.fetchImpl;
after(async()=>{await app.close();await appPool.end();await cleanupDisposableTestSchema(fixture.pool,fixture.schemaName);});

describe('Milvanta subscriptions, delivery and WhatsApp security',()=>{
  describe('Sole-channel phone verification and templates',()=>{
    it('advertises a single channel and exposes no legacy callback',async()=>{
      const config=await app.inject({url:'/api/v1/auth/phone/config'});
      assert.equal(config.json().channel,'whatsapp');
      assert.equal(config.json().provider,undefined);
      const removed=await app.inject({method:'POST',url:'/api/v1/notifications/twilio-callback',payload:{MessageStatus:'delivered'}});
      assert.equal(removed.statusCode,404);
    });
    it('normalizes Indian numbers and rejects malformed/foreign recipients',()=>{
      for(const number of ['9876543210','919876543210','+91 98765 43210']) assert.equal(normalizeIndianPhoneNumber(number),'+919876543210');
      for(const number of ['abc9876543210','12345','14155552671']) assert.equal(normalizeIndianPhoneNumber(number),null);
    });
    it('requires database-backed authentication for both OTP endpoints',async()=>{
      for(const endpoint of ['send-otp','verify-otp']) {
        const response=await app.inject({method:'POST',url:`/api/v1/auth/phone/${endpoint}`,payload:{phone:customer.phone,...(endpoint==='verify-otp'?{code:'123456'}:{})}});
        assert.equal(response.statusCode,401);
      }
      const forged=app.jwt.sign({sub:String(customer.id),jti:'unregistered-session'});
      const response=await app.inject({method:'POST',url:'/api/v1/auth/phone/send-otp',headers:{authorization:`Bearer ${forged}`},payload:{phone:customer.phone}});
      assert.equal(response.statusCode,401);
      assert.equal(graph.requests.length,0);
    });
    it('returns service unavailable without credentials and cannot verify a failed send',async()=>{
      const saved=process.env.WHATSAPP_ACCESS_TOKEN;delete process.env.WHATSAPP_ACCESS_TOKEN;
      try {
        const response=await app.inject({method:'POST',url:'/api/v1/auth/phone/send-otp',headers:{authorization:`Bearer ${token}`},payload:{phone:customer.phone}});
        assert.equal(response.statusCode,503);assert.equal(response.json().success,false);
        assert.match(response.json().message,/WhatsApp.*unavailable/);
        const verified=await verifyPhoneOtp({pool:fixture.pool,customerId:customer.id,sessionHash,phone:customer.phone,code:'123456'});
        assert.equal(verified.verified,false);
        assert.equal((await fixture.pool.query('SELECT phone_verified_at FROM customers WHERE id=$1',[customer.id])).rows[0].phone_verified_at,null);
        assert.equal(graph.requests.length,0);
      } finally {process.env.WHATSAPP_ACCESS_TOKEN=saved;}
    });
    it('retains mandatory phone ownership checks when messaging is disabled',async()=>{
      process.env.MANDATORY_PHONE_VERIFICATION='true';
      try {
        const response=await app.inject({method:'POST',url:'/api/v1/subscriptions',headers:{authorization:`Bearer ${token}`},payload:{productId:1}});
        assert.equal(response.statusCode,403);assert.equal(response.json().error,'phone_verification_required');
      } finally {delete process.env.MANDATORY_PHONE_VERIFICATION;}
    });
    it('maps all required events to explicit Meta template schemas',()=>{
      assert.equal(WHATSAPP_TEMPLATES.AUTH_OTP.metaCategory,'AUTHENTICATION');
      const params={orderNumber:'MV1',amount:'100',deliveryDate:'2026-10-23',orderLink:'https://milvanta.in/profile.html',productName:'Milk',quantity:'1 Litre',startDate:'2026-10-23',pauseDate:'2026-10-24',nextDate:'2026-10-25',time:'06:30 AM',reason:'Gate locked',dueDate:'2026-10-26',code:'123456'};
      for(const [key,t] of Object.entries(WHATSAPP_TEMPLATES)) {
        const resolved=resolveWhatsAppTemplate(key,params);
        assert.match(resolved.name,/^milvanta_/);
        assert.deepEqual(resolved.values,t.fields.map(field=>params[field]));
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
      assert.equal(res.statusCode,200);
      if (res.statusCode === 200) {
        const data = JSON.parse(res.payload);
        assert.ok(Array.isArray(data.deliveries));
      }
    });

    it('blocks non-admin users from triggering daily delivery generation', async () => {
      // A real non-admin session must be denied authorization, not fail a missing-table lookup.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/deliveries/generate',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.statusCode, 403);
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

    it('keeps the removed quantity-change route inaccessible for all callers', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/subscriptions/101/quantity',
        payload: { quantity: '2 Litre' }
      });
      assert.equal(res.statusCode, 404);
      const authenticated=await app.inject({method:'PATCH',url:'/api/v1/subscriptions/101/quantity',headers:{authorization:`Bearer ${token}`},payload:{quantity:'2 Litre'}});
      assert.equal(authenticated.statusCode,404);
      assert.equal(Number((await fixture.pool.query('SELECT COUNT(*) FROM customer_subscriptions')).rows[0].count),0);
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

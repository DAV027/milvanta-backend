import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  getDeliveryCronTarget,
  isValidDeliveryWorkerSecret,
  verifyDeliveryWorkerSecret
} from '../src/services/deliveryCronPolicy.js';
import { generateDailyDeliveries, getTomorrowDeliveryDateYMD } from '../src/services/deliveryEngine.js';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const engine = fs.readFileSync(new URL('../src/services/deliveryEngine.js', import.meta.url), 'utf8');

test('IST cron refuses to generate before the 20:00 delivery cutoff', () => {
  assert.deepEqual(getDeliveryCronTarget(new Date('2026-11-05T14:29:59Z')), {
    allowed:false,reason:'before_daily_delivery_cutoff'
  });
  assert.deepEqual(getDeliveryCronTarget(new Date('2026-11-05T03:00:00Z')), {
    allowed:false,reason:'before_daily_delivery_cutoff'
  });
});

test('cron targets the following morning at and after 20:00 IST', () => {
  for(const instant of ['2026-11-05T14:30:00Z','2026-11-05T14:45:00Z','2026-11-05T18:29:59Z']) {
    assert.deepEqual(getDeliveryCronTarget(new Date(instant)), {
      allowed:true,targetDate:'2026-11-06'
    });
  }
});

test('IST midnight and calendar rollover never use previous day or invent past deliveries', () => {
  assert.deepEqual(getDeliveryCronTarget(new Date('2026-11-05T18:30:00Z')), {
    allowed:false,reason:'before_daily_delivery_cutoff'
  });
  assert.deepEqual(getDeliveryCronTarget(new Date('2026-11-30T14:45:00Z')), {
    allowed:true,targetDate:'2026-12-01'
  });
  assert.deepEqual(getDeliveryCronTarget(new Date('2026-12-31T14:45:00Z')), {
    allowed:true,targetDate:'2027-01-01'
  });
});

test('cron rejects invalid injected clock values', () => {
  assert.throws(()=>getDeliveryCronTarget(new Date('invalid')),/invalid_delivery_cron_clock/);
  assert.throws(()=>getDeliveryCronTarget({}),/invalid_delivery_cron_clock/);
});

test('configuration requires a strong dedicated delivery worker secret', () => {
  assert.equal(isValidDeliveryWorkerSecret('too-short'),false);
  assert.equal(isValidDeliveryWorkerSecret('x'.repeat(32)),true);
  assert.equal(isValidDeliveryWorkerSecret(' x'.repeat(17)),false);
  assert.equal(isValidDeliveryWorkerSecret('x'.repeat(513)),false);
});

test('authentication accepts exact configured secret and rejects malformed or incorrect secret', () => {
  const expected='TEST_ONLY_delivery_cron_secret_0123456789abcdef';
  assert.equal(verifyDeliveryWorkerSecret(expected,expected),true);
  assert.equal(verifyDeliveryWorkerSecret('TEST_ONLY_delivery_cron_secret_wrongxxxx',expected),false);
  assert.equal(verifyDeliveryWorkerSecret('',expected),false);
  assert.equal(verifyDeliveryWorkerSecret(null,expected),false);
  assert.equal(verifyDeliveryWorkerSecret(expected,'weak'),false);
  assert.equal(verifyDeliveryWorkerSecret('x'.repeat(1024),expected),false);
});

test('production server defines exactly one guarded internal generation endpoint',()=>{
  const route="app.post('/api/v1/internal/deliveries/generate'";
  assert.equal(server.split(route).length-1,1);
  const start=server.indexOf(route);
  const body=server.slice(start,start+2200);
  assert.match(body,/process\.env\.DELIVERY_CRON_SECRET/);
  assert.match(body,/verifyDeliveryWorkerSecret\(request\.headers\['x-delivery-worker-secret'\], configured\)/);
  assert.match(body,/reply\.code\(401\)\.send\(\{ error: 'unauthorized' \}\)/);
  assert.match(body,/getDeliveryCronTarget\(\)/);
  assert.match(body,/if \(!plan\.allowed\)/);
  assert.ok(body.includes('generateDailyDeliveries(pool, plan.targetDate, { rejectPastDates: true, liveGatewayOnly: true })'));
  assert.doesNotMatch(body,/request\.body\??\.targetDate|request\.query\??\.targetDate/);
  assert.doesNotMatch(body,/reply\.send\(\{.*secret/);
});

test('engine enforces paid entitlement, payment proof, valid address, and duplicate date prevention',()=>{
  assert.match(engine,/subNotes\.fulfillmentEntitled !== true/);
  assert.match(engine,/if \(!paymentId \|\| isMandateOnly\)/);
  assert.match(engine,/reason: 'missingOrInvalidAddress'/);
  assert.match(engine,/ON CONFLICT \(subscription_id, delivery_date\) DO NOTHING/);
  assert.match(engine,/WHERE cs\.status = 'active'/);
});

test('unattended cron excludes Test Mode and unknown-mode subscriptions', () => {
  assert.ok(engine.includes("process.env.NODE_ENV !== 'test' || options.liveGatewayOnly === true"));
  assert.ok(engine.includes('if (enforceLiveGatewayOnly)'));
  assert.ok(engine.includes("if (notes.keyMode !== 'live')"));
  const route="app.post('/api/v1/internal/deliveries/generate'";
  const part=server.slice(server.indexOf(route),server.indexOf('// ---------- Internal Operations & Dispatch APIs'));
  assert.ok(part.includes('liveGatewayOnly: true'));
});

test('generator and preview retain Razorpay subscription identity for recurring paid-through rules', () => {
  const selections = engine.split('cs.plan_type, cs.razorpay_subscription_id, cs.notes').length - 1;
  assert.equal(selections, 2, 'generation and preview must both retain gateway subscription ID');
});

test('cron does not create its own in-process timer and requires independent scheduling',()=>{
  const route="app.post('/api/v1/internal/deliveries/generate'";
  const part=server.slice(server.indexOf(route),server.indexOf('// ---------- Internal Operations & Dispatch APIs'));
  assert.doesNotMatch(part,/setInterval|setTimeout|cron\.schedule|app\.listen/);
  assert.match(part,/daily_delivery_generation_failed/);
});


test('real delivery generator skips Test Mode and unknown-mode rows without attempting any inserts', async () => {
  const queries=[];
  const subs=[
    {id:4,customer_id:1,notes:{keyMode:'test',fulfillmentEntitled:true,lastPaymentId:'pay_synthetic'}},
    {id:5,customer_id:1,notes:{fulfillmentEntitled:true,lastPaymentId:'pay_unknown'}}
  ];
  const client={
    async query(statement) {
      const sql=String(statement);
      queries.push(sql);
      if(sql.includes("FROM customer_subscriptions cs")) return {rows:subs,rowCount:subs.length};
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[],rowCount:0};
      throw new Error('Unexpected database query during Test Mode dispatch exclusion');
    },
    release() {}
  };
  const pool={connect:async()=>client};
  const result=await generateDailyDeliveries(pool,getTomorrowDeliveryDateYMD(),{
    rejectPastDates:true,
    liveGatewayOnly:true
  });
  assert.equal(result.generatedCount,0);
  assert.equal(result.skippedCount,2);
  assert.equal(result.totalActiveSubscriptions,2);
  assert.deepEqual(queries.map(q=>q.trim().slice(0,6)),['BEGIN','SELECT','COMMIT']);
});

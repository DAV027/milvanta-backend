import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FIXED_30_DELIVERIES_POLICY,
  shiftDeliveryDate,
  firstEligibleDeliveryDate,
  buildFixed30DeliveryCoverage,
  validatedFixedDeliveryCoverage
} from '../src/services/deliveryCoveragePolicy.js';
import { getEffectivePaidThroughDate } from '../src/services/subscriptionService.js';
import { evaluateSubscriptionDeliveryEligibility } from '../src/services/deliveryEngine.js';

const serverCode = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const validNotes = {
  deliveryCoverageOptIn: FIXED_30_DELIVERIES_POLICY,
  months: 1, days: 30,
  startDate: null
};

function verifiedFixture(notes) {
  return {
    id: 9999,
    customer_id: 77,
    cost_per_day_paise: 10500,
    total_amount_paise: 315000,
    status: 'active',
    plan_type: 'month',
    razorpay_subscription_id: 'sub_fixtureThisIsNotARealAccountId',
    notes: {
      ...validNotes,
      ...notes,
      fulfillmentEntitled: true,
      paidCount: 1,
      lastPaymentId: 'pay_synthetic_do_not_send'
    }
  };
}

test('19:59:59 IST permits delivery the next morning', () => {
  assert.equal(firstEligibleDeliveryDate(new Date('2026-11-04T14:29:59Z')), '2026-11-05');
});

test('20:00:00 IST and 23:01 IST defer until day after tomorrow', () => {
  assert.equal(firstEligibleDeliveryDate(new Date('2026-11-04T14:30:00Z')), '2026-11-06');
  assert.equal(firstEligibleDeliveryDate(new Date('2026-11-04T17:31:00Z')), '2026-11-06');
});

test('midnight IST opens the next-morning window', () => {
  assert.equal(firstEligibleDeliveryDate(new Date('2026-11-04T18:30:00Z')), '2026-11-06');
});

test('a configured future start cannot be silently moved earlier', () => {
  assert.equal(firstEligibleDeliveryDate(new Date('2026-11-04T17:31:00Z'), '2026-12-01'), '2026-12-01');
  assert.equal(firstEligibleDeliveryDate(new Date('2026-11-04T17:31:00Z'), '2026-11-05'), '2026-11-06');
});

test('30-day coverage for Nov 4 after cutoff runs Nov 6–Dec 5 inclusive', () => {
  const coverage = buildFixed30DeliveryCoverage({
    notes: validNotes,
    paymentConfirmedAt: new Date('2026-11-04T17:31:00Z'),
    dailyRatePaise: 10500, totalAmountPaise: 315000, paidCount: 1
  });
  assert.deepEqual(coverage,{
    deliveryCoveragePolicy: FIXED_30_DELIVERIES_POLICY,
    deliveryCoverageDays: 30,
    deliveryFirstDate: '2026-11-06',
    deliveryLastDate: '2026-12-05'
  });
  assert.equal(shiftDeliveryDate(coverage.deliveryFirstDate, 29), coverage.deliveryLastDate);
});

test('before cutoff, 30 days runs Nov 5–Dec 4 inclusive', () => {
  const w=buildFixed30DeliveryCoverage({
    notes:validNotes,paymentConfirmedAt:new Date('2026-11-04T14:29:59Z'),
    dailyRatePaise:10500,totalAmountPaise:315000,paidCount:1
  });
  assert.equal(w.deliveryFirstDate,'2026-11-05');
  assert.equal(w.deliveryLastDate,'2026-12-04');
});

test('month-end, leap year and year-end date shifts are calendar-safe',()=>{
  assert.equal(shiftDeliveryDate('2028-02-28',1),'2028-02-29');
  assert.equal(shiftDeliveryDate('2026-12-31',1),'2027-01-01');
  assert.equal(shiftDeliveryDate('2026-11-06',29),'2026-12-05');
  assert.throws(()=>shiftDeliveryDate('2026-02-30',1),/invalid_delivery_date_shift/);
});

test('no opt-in, legacy record, mandate-only auth and mismatched price cannot extend entitlement', () => {
  const args={notes:validNotes,paymentConfirmedAt:new Date('2026-11-04T17:31:00Z'),dailyRatePaise:10500,totalAmountPaise:315000,paidCount:1};
  assert.equal(buildFixed30DeliveryCoverage({...args,notes:{months:1,days:30}}),null);
  assert.equal(buildFixed30DeliveryCoverage({...args,paidCount:0}),null);
  assert.equal(buildFixed30DeliveryCoverage({...args,paidCount:2}),null);
  assert.equal(buildFixed30DeliveryCoverage({...args,totalAmountPaise:305000}),null);
  assert.equal(buildFixed30DeliveryCoverage({...args,notes:{...validNotes,months:2,days:60}}),null);
  assert.equal(buildFixed30DeliveryCoverage({...args,notes:{...validNotes,deliveryCoveragePolicy:FIXED_30_DELIVERIES_POLICY}}),null);
});

test('fixed window must be structurally consistent and backed by paid captured evidence', () => {
  const meta=buildFixed30DeliveryCoverage({
    notes:validNotes,paymentConfirmedAt:new Date('2026-11-04T17:31:00Z'),
    dailyRatePaise:10500,totalAmountPaise:315000,paidCount:1
  });
  const row=verifiedFixture(meta);
  assert.deepEqual(validatedFixedDeliveryCoverage(row),{firstDate:'2026-11-06',lastDate:'2026-12-05',days:30});
  assert.equal(validatedFixedDeliveryCoverage({...row,notes:{...row.notes,deliveryLastDate:'2027-04-05'}}),null);
  assert.equal(validatedFixedDeliveryCoverage({...row,notes:{...row.notes,fulfillmentEntitled:false}}),null);
  assert.equal(validatedFixedDeliveryCoverage({...row,notes:{...row.notes,authType:'mandate_only'}}),null);
  assert.equal(validatedFixedDeliveryCoverage({...row,notes:{...row.notes,lastPaymentId:null}}),null);
  assert.equal(validatedFixedDeliveryCoverage({...row,total_amount_paise:300000}),null);
  assert.equal(validatedFixedDeliveryCoverage({...row,razorpay_subscription_id:null}),null);
});

test('verified fixed coverage overrides gateway billing end only for delivery eligibility', async()=>{
  const meta=buildFixed30DeliveryCoverage({notes:validNotes,
    paymentConfirmedAt:new Date('2026-11-04T17:31:00Z'),
    dailyRatePaise:10500,totalAmountPaise:315000,paidCount:1});
  const row=verifiedFixture({...meta,paidThroughDate:'2026-12-03'});
  const failsIfDbQueried={query(){throw new Error('unexpected database query')}};
  assert.equal(await getEffectivePaidThroughDate(failsIfDbQueried,row),'2026-12-05');
  const early=await evaluateSubscriptionDeliveryEligibility(failsIfDbQueried,row,'2026-11-05');
  assert.equal(early.eligible,false);assert.equal(early.reason,'beforeStartDate');
  const late=await evaluateSubscriptionDeliveryEligibility(failsIfDbQueried,row,'2026-12-06');
  assert.equal(late.eligible,false);assert.equal(late.reason,'beyondEntitlement');
});

test('without verified coverage, paid-through date stays on the old billing path',async()=>{
  const row=verifiedFixture({paidThroughDate:'2026-12-03'});
  assert.equal(validatedFixedDeliveryCoverage(row),null);
  assert.equal(await getEffectivePaidThroughDate({query(){throw new Error('unexpected DB')}},row),'2026-12-03');
});

test('server writes window only after captured cycle verification and on payment-evidenced webhook',()=>{
  assert.match(serverCode, /MILVANTA_30_DELIVERY_DAYS_V1 === 'true'/);
  assert.match(serverCode, /deliveryCoverageOptIn: FIXED_30_DELIVERIES_POLICY/);
  assert.match(serverCode, /const deliveryCoverage = process\.env\.MILVANTA_30_DELIVERY_DAYS_V1 === 'true'/);
  assert.match(serverCode, /buildFixed30DeliveryCoverage\\(\\{/);
  assert.match(serverCode, /JSON\\.stringify\\(deliveryCoverage \\|\\| \\{\\}\\)/);
  assert.match(serverCode, /validatedFixedDeliveryCoverage\\(sub\\)/);
});

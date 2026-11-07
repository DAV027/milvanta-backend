import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { previewRecurringMorningObligation, recordVerifiedRecurringInitialGap }
  from '../src/services/recurringMorningObligations.js';

const bill = {
  id: 123, customer_id: 42, razorpay_subscription_id: 'sub_synthetic_123',
  plan_type: 'month', cost_per_day_paise: 10500,
  notes: {
    keyMode: 'live', months: 1,
    planFirstCycleStartYMD: '2026-11-01',
    planFirstCycleEndYMD: '2026-11-30',
    planEntitlementStartYMD: '2026-11-06',
    paidThroughDate: '2026-12-05',
    days: 30,
    amountPerMonthPaise: 315000
  }
};
const payment = {
  id: 'pay_synthetic_captured_123', subscription_id: bill.razorpay_subscription_id,
  status: 'captured', currency: 'INR', amount: 315000
};
const atCutoff = new Date('2026-11-06T14:30:00Z');
function fakeLedger() {
  const rows = new Map();
  const events = new Map();
  const statements = [];
  let sequence = 0;
  const client = {
    async query(sql, params) {
      const q = String(sql);
      statements.push(q);
      if (q.includes('SELECT id FROM refund_requests WHERE subscription_id')) {
        return {rows:[]};
      }
      if (q.includes('INSERT INTO subscription_recurring_morning_obligations')) {
        const key = params[0] + ':' + params[4];
        if (rows.has(key)) return {rows:[],rowCount:0};
        const row = {id:++sequence,payment_id:params[3],owed_mornings:params[7],
          first_cycle_start:params[4]};
        rows.set(key,row);
        return {rows:[row],rowCount:1};
      }
      if (q.includes('INSERT INTO subscription_recurring_morning_obligation_events')) {
        if (!events.has(params[1])) events.set(params[1],params);
        return {rows:[],rowCount:1};
      }
      if (q.includes('SELECT id,payment_id,owed_mornings FROM subscription_recurring_morning_obligations')) {
        const r=rows.get(params[0]+':'+params[1]);
        return {rows:r?[r]:[]};
      }
      throw Error('Unexpected SQL in fake ledger');
    }
  };
  return {client,rows,events,statements};
}

test('accurate owed mornings at 19:59 vs 20:00 IST and past entire month',()=>{
  const before = previewRecurringMorningObligation({
    firstCycleStart:'2026-11-01',firstCycleEnd:'2026-11-30',
    plannedEntitlementStart:'2026-11-06',plannedPaidThrough:'2026-12-05',purchasedMornings:30,
    verifiedAt:new Date('2026-11-06T14:29:59Z'),dailyRatePaise:10500
  });
  assert.equal(before.owedMornings,1);
  assert.equal(before.owedAmountPaise,10500);
  const after = previewRecurringMorningObligation({
    firstCycleStart:'2026-11-01',firstCycleEnd:'2026-11-30',
    plannedEntitlementStart:'2026-11-06',plannedPaidThrough:'2026-12-05',purchasedMornings:30,
    verifiedAt:atCutoff,dailyRatePaise:10500
  });
  assert.equal(after.owedMornings,2);
  assert.equal(after.deliverableWithinPaidThrough,28);
  assert.equal(after.firstEligibleDelivery,'2026-11-08');
  assert.equal(after.owedAmountPaise,21000);
  const expired=previewRecurringMorningObligation({
    firstCycleStart:'2026-11-01',firstCycleEnd:'2026-11-30',
    plannedEntitlementStart:'2026-11-06',plannedPaidThrough:'2026-12-05',purchasedMornings:30,
    verifiedAt:new Date('2026-12-05T14:30:00Z'),dailyRatePaise:10500
  });
  assert.equal(expired.owedMornings,30);
});

test('future full-month purchase creates no shortfall until month actually starts',()=>{
  const x=previewRecurringMorningObligation({
    firstCycleStart:'2026-12-01',firstCycleEnd:'2026-12-31',
    plannedEntitlementStart:'2026-12-01',plannedPaidThrough:'2026-12-31',purchasedMornings:31,
    verifiedAt:atCutoff,dailyRatePaise:10500
  });
  assert.equal(x.owedMornings,0);
  assert.equal(x.requiresReconciliation,false);
});

test('invalid cycle, partial month and rate fail closed',()=>{
  for (const x of [
    {firstCycleStart:'2026-11-06',firstCycleEnd:'2026-11-30'},
    {firstCycleStart:'2026-11-01',firstCycleEnd:'2026-12-31'},
    {firstCycleStart:'2026-02-29',firstCycleEnd:'2026-02-28'},
    {firstCycleStart:'2026-11-01',firstCycleEnd:'2026-11-29'}
  ]) {
    assert.throws(()=>previewRecurringMorningObligation({
      ...x,plannedEntitlementStart:'2026-11-06',plannedPaidThrough:'2026-12-05',
      purchasedMornings:30,dailyRatePaise:10500
    }));
  }
  assert.throws(()=>previewRecurringMorningObligation({
    firstCycleStart:'2026-11-01',firstCycleEnd:'2026-11-30',
    plannedEntitlementStart:'2026-11-06',plannedPaidThrough:'2026-12-05',
    purchasedMornings:30,dailyRatePaise:0
  }),/invalid_recurring_daily_rate/);
});

test('feature flag defaults off for all accounts, no SQL',async()=>{
  const db=fakeLedger();
  const value=await recordVerifiedRecurringInitialGap(db.client,{
    subscription:bill,paidCount:1,capturedPayment:payment,verifiedAt:atCutoff,enabled:false
  });
  assert.equal(value.reason,'feature_disabled');
  assert.equal(db.statements.length,0);
});

test('refuse Test Mode, legacy, mandate-only, missing evidence and later paid cycles',async()=>{
  const variations=[
    {subscription:{...bill,notes:{...bill.notes,keyMode:'test'}}},
    {subscription:{...bill,notes:{...bill.notes,keyMode:undefined}}},
    {subscription:{...bill,notes:{...bill.notes,authType:'mandate_only'}}},
    {paidCount:0},
    {paidCount:2},
    {subscription:{...bill,notes:{...bill.notes,months:2}}},
    {capturedPayment:{...payment,status:'authorized'}},
    {capturedPayment:{...payment,currency:'USD'}},
    {capturedPayment:{...payment,amount:100}},
    {capturedPayment:{...payment,subscription_id:undefined}},
    {capturedPayment:{...payment,id:'inv_synthetic'}},
    {subscription:{...bill,notes:{...bill.notes,planFirstCycleStartYMD:null}}}
  ];
  for(const change of variations){
    const db=fakeLedger();
    const result=await recordVerifiedRecurringInitialGap(db.client,{
      subscription:bill,paidCount:1,capturedPayment:payment,verifiedAt:atCutoff,
      enabled:true,...change
    });
    assert.equal(result.recorded,false);
    assert.equal(db.statements.length,0);
  }
});

test('pending customer refund prevents new recurring liability accrual',async()=>{
  const db=fakeLedger();
  const query=db.client.query.bind(db.client);
  db.client.query=async(sql,params)=>{
    if (String(sql).includes('SELECT id FROM refund_requests WHERE subscription_id')) {
      return {rows:[{id:99}]};
    }
    return query(sql,params);
  };
  const result=await recordVerifiedRecurringInitialGap(db.client,{
    subscription:bill,paidCount:1,capturedPayment:payment,verifiedAt:atCutoff,enabled:true
  });
  assert.equal(result.recorded,false);
  assert.equal(result.reason,'refund_reconciliation_required');
  assert.equal(db.rows.size,0);
  assert.equal(db.events.size,0);
});

test('one captured first-cycle payment creates one pending obligation + event; retries idempotent',async()=>{
  const db=fakeLedger();
  const args={subscription:bill,paidCount:1,capturedPayment:payment,verifiedAt:atCutoff,enabled:true};
  const first=await recordVerifiedRecurringInitialGap(db.client,args);
  assert.equal(first.recorded,true);
  assert.equal(first.status,'pending_reconciliation');
  assert.equal(first.plan.owedMornings,2);
  const again=await recordVerifiedRecurringInitialGap(db.client,args);
  assert.equal(again.recorded,false);
  assert.equal(again.reason,'already_recorded');
  assert.equal(db.rows.size,1);
  assert.equal(db.events.size,1);
  assert.deepEqual([...db.events.values()][0].slice(2,4),[2,'Verified live payment; initial gap pending finance review']);
});

test('same cycle with a different captured payment is blocked for finance investigation',async()=>{
  const db=fakeLedger(), args={subscription:bill,paidCount:1,capturedPayment:payment,verifiedAt:atCutoff,enabled:true};
  await recordVerifiedRecurringInitialGap(db.client,args);
  await assert.rejects(()=>recordVerifiedRecurringInitialGap(db.client,{
    ...args,capturedPayment:{...payment,id:'pay_other_captured_456'}
  }),/recurring_obligation_duplicate_cycle_payment_conflict/);
});

test('checkout keeps first-cycle snapshot and ledger capture is opt-in only',()=>{
  const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(source,/planFirstCycleStartYMD: firstCycleCoverage\.firstCycleStart/);
  assert.match(source,/planFirstCycleEndYMD: firstCycleCoverage\.firstCycleEnd/);
  assert.match(source,/planEntitlementStartYMD/);
  assert.match(source,/recordVerifiedRecurringInitialGap\(client/);
  assert.match(source,/capturedPayment: rawPaymentEntity/);
  assert.match(source,/T00:30:00Z/);
  const module=fs.readFileSync(new URL('../src/services/recurringMorningObligations.js',import.meta.url),'utf8');
  assert.match(module,/RECURRING_MORNING_OBLIGATIONS_ENABLED==='true'/);
  assert.doesNotMatch(module,/razorpay\.(payments|subscriptions)/);
});

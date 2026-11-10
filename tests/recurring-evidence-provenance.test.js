import test from 'node:test';
import assert from 'node:assert/strict';
import {planBillingCreditProvenance,recordBillingCreditProvenance}
  from '../src/services/billingCreditProvenance.js';
import {recordSignedRecurringCaptureObservation}
  from '../src/services/recurringCaptureObservations.js';
import {assessRecurringFinanceReconciliation}
  from '../src/services/recurringFinanceReconciliation.js';

const subscription={
  id:21,customer_id:3,razorpay_subscription_id:'sub_evidence_test',
  cost_per_day_paise:10500,plan_type:'month',
  notes:{keyMode:'live',months:1,paidCount:1,fulfillmentEntitled:true,
    lastPaymentId:'pay_evidence_test'}
};

test('skip, unskip, vacation and resume map to exact signed mornings',()=>{
  const cases=[
    ['skip','skip:10','2026-11-10',1,10500,['2026-11-10'],[1]],
    ['unskip','unskip:10','2026-11-10',-1,-10500,['2026-11-10'],[-1]],
    ['vacation','vacation:33','2026-11-30',3,31500,
      ['2026-11-30','2026-12-01','2026-12-02'],[1,1,1]],
    ['pause_resume','pause:55','2026-11-02',2,21000,
      ['2026-11-02','2026-11-03'],[1,1]]
  ];
  for(const [sourceKind,sourceReference,startDate,daysCount,totalAmountPaise,dates,deltas] of cases){
    const planned=planBillingCreditProvenance({
      subscription,adjustmentId:44,sourceKind,sourceReference,
      startDate,daysCount,totalAmountPaise
    });
    assert.deepEqual(planned.map(x=>x.deliveryDate),dates);
    assert.deepEqual(planned.map(x=>x.daysDelta),deltas);
    assert.ok(planned.every(x=>x.evidenceState==='date_known_payment_unverified'));
  }
});

test('invalid source, date, amount, oversized range and wrong sign abort',()=>{
  const base={subscription,adjustmentId:33,sourceKind:'skip',
    sourceReference:'skip:123',startDate:'2026-11-10',daysCount:1,totalAmountPaise:10500};
  const scenarios=[
    {startDate:'2026-02-30'}, {sourceKind:'unskip'},
    {sourceReference:'user supplied arbitrary'},
    {daysCount:367,totalAmountPaise:3853500},
    {daysCount:2,totalAmountPaise:10500},
    {daysCount:1,totalAmountPaise:-10500},
    {adjustmentId:0}
  ];
  for(const p of scenarios)assert.throws(()=>planBillingCreditProvenance({...base,...p}));
});

test('provenance is off unless explicitly enabled; prepaid account also excluded',async()=>{
  const db={query:async()=>{throw Error('No DB write expected')}};
  let r=await recordBillingCreditProvenance(db,{
    subscription,adjustmentId:33,sourceKind:'skip',sourceReference:'skip:44',
    startDate:'2026-11-10',daysCount:1,totalAmountPaise:10500,enabled:false,
    isRecurringAutopay:true
  });
  assert.equal(r.reason,'feature_disabled');
  r=await recordBillingCreditProvenance(db,{
    subscription,adjustmentId:33,sourceKind:'skip',sourceReference:'skip:44',
    startDate:'2026-11-10',daysCount:1,totalAmountPaise:10500,enabled:true,
    isRecurringAutopay:false
  });
  assert.equal(r.reason,'not_recurring_autopay');
});

const payment={id:'pay_capture_evidence',subscription_id:'sub_evidence_test',
  amount:315000,status:'captured',currency:'INR',created_at:1793962800};

test('only captured INR signed-webhook raw payments can be observed, flag OFF by default',async()=>{
  const client={query:async()=>{throw Error('No DB write expected')}};
  const args={subscription,rawPaymentEntity:payment,eventId:'evt_capture_001',paidCount:1};
  assert.equal((await recordSignedRecurringCaptureObservation(client,{...args,enabled:false})).reason,'feature_disabled');
  const missingCycle=await recordSignedRecurringCaptureObservation(client,{
    ...args,paidCount:0,enabled:true
  });
  assert.equal(missingCycle.reason,'invalid_verified_webhook_or_cycle');
  const bad=[
    {status:'authorized'}, {currency:'USD'}, {subscription_id:'sub_other'},
    {amount:0},{amount:'315000'}, {id:'inv_fake'}, {id:{malformed:true}}
  ];
  for(const change of bad){
    const res=await recordSignedRecurringCaptureObservation(client,{
      ...args,rawPaymentEntity:{...payment,...change},enabled:true
    });
    assert.equal(res.recorded,false);
  }
});

test('finance review does not count duplicates and never permits automatic refund or dispatch',()=>{
  const report=assessRecurringFinanceReconciliation({
    subscription,paidThroughDate:'2026-12-05',
    billingAdjustments:[{adjustment_type:'credit',days_count:'2',amount_paise:'21000',row_count:3}],
    datedCreditProvenance:[
      {delivery_date:'2026-11-10',source_kind:'skip',adjustment_type:'credit',days_delta:1,
        amount_paise:10500,evidence_state:'date_known_payment_unverified'},
      {delivery_date:'2026-11-10',source_kind:'vacation',adjustment_type:'credit',days_delta:1,
        amount_paise:10500,evidence_state:'date_known_payment_unverified'},
      {delivery_date:'2026-11-10',source_kind:'unskip',adjustment_type:'credit',days_delta:-1,
        amount_paise:-10500,evidence_state:'date_known_payment_unverified'},
      {delivery_date:'2026-11-11',source_kind:'vacation',adjustment_type:'credit',days_delta:1,
        amount_paise:10500,evidence_state:'date_known_payment_unverified'}
    ],
    captureObservations:[{
      gateway_payment_id:'pay_evidence_test',gateway_subscription_id:'sub_evidence_test',
      amount_paise:315000,paid_count_at_event:1,currency:'INR',
      proof_level:'signed_webhook_payment_entity'
    }]
  });
  assert.equal(report.datedCreditProvenance.legacyOrMissingEvidence,false);
  assert.deepEqual(report.datedCreditProvenance.overlappingPositiveClaimDates,['2026-11-10']);
  assert.ok(report.reviewFlags.includes('multiple_positive_credit_claims_same_date'));
  assert.equal(report.signedWebhookCaptureObservations.observedCapturedAmountPaise,315000);
  assert.equal(report.customerRefundableAmountPaise,null);
  assert.equal(report.mayAutoApplyCredits,false);
  assert.equal(report.mayAutoGenerateDeliveries,false);
});

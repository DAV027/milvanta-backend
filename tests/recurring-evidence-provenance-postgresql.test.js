import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {
  setupDisposableTestSchema,cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import {getEarliestPermittedDeliveryDateYMD,getISTCalendarYMD}
  from '../src/services/deliveryCronPolicy.js';
import {
  skipDeliveryDate,unskipDeliveryDate,setVacation,resumeSubscription,addDaysToYMD
} from '../src/services/subscriptionService.js';
import {recordSignedRecurringCaptureObservation}
  from '../src/services/recurringCaptureObservations.js';
import {previewRecurringFinanceReconciliation}
  from '../src/services/recurringFinanceReconciliation.js';

process.env.NODE_ENV='test';
process.env.RECURRING_CREDIT_PROVENANCE_ENABLED='true';

const target=getEarliestPermittedDeliveryDateYMD();
const second=addDaysToYMD(target,1);
const payment={
  id:'pay_provenance_pg_123',subscription_id:'sub_provenance_pg_123',
  amount:315000,status:'captured',currency:'INR',created_at:1793962800
};
let setup,pool,subId,customerId;
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const c=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash) "+
    "VALUES('Evidence Test','credit-date-evidence@test.invalid','9000000056','salt','hash') RETURNING id"
  );
  customerId=c.rows[0].id;
  const notes={
    keyMode:'live',fulfillmentEntitled:true,months:1,paidCount:1,
    startDate:getISTCalendarYMD(),paidThroughDate:addDaysToYMD(target,40),
    lastPaymentId:payment.id
  };
  const sub=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,"+
    "status,razorpay_subscription_id,notes) "+
    "VALUES($1,'Milk','1 Litre','month',10500,315000,'active',$2,$3::jsonb) RETURNING id",
    [customerId,payment.subscription_id,JSON.stringify(notes)]
  );
  subId=sub.rows[0].id;
});
after(async()=>{
  delete process.env.RECURRING_CREDIT_PROVENANCE_ENABLED;
  if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);
});

test('real skip writes exactly one adjustment and one dated source; retry does not duplicate',async()=>{
  const args={subscriptionId:subId,customerId,skipDate:target};
  const first=await skipDeliveryDate(pool,args);
  assert.equal(first.success,true,JSON.stringify(first));
  const retry=await skipDeliveryDate(pool,args);
  assert.equal(retry.success,true,JSON.stringify(retry));
  const rows=await pool.query(
    "SELECT source_kind,delivery_date::text AS day,days_delta,amount_paise,evidence_state "+
    "FROM subscription_billing_credit_provenance WHERE subscription_id=$1",[subId]
  );
  assert.equal(rows.rowCount,1);
  assert.equal(rows.rows[0].day,target);
  assert.equal(rows.rows[0].source_kind,'skip');
  assert.equal(rows.rows[0].amount_paise,10500);
  assert.equal(rows.rows[0].evidence_state,'date_known_payment_unverified');
});

test('overlapping vacation is date-granular and flagged, never auto-paid',async()=>{
  const result=await setVacation(pool,{
    subscriptionId:subId,customerId,startDate:target,endDate:second
  });
  assert.equal(result.success,true,JSON.stringify(result));
  const report=await previewRecurringFinanceReconciliation(pool,{subscriptionId:subId});
  assert.equal(report.datedCreditProvenance.recordedRows,3);
  assert.equal(report.datedCreditProvenance.legacyOrMissingEvidence,false);
  assert.ok(report.reviewFlags.includes('multiple_positive_credit_claims_same_date'));
  assert.deepEqual(report.datedCreditProvenance.overlappingPositiveClaimDates,[target]);
  assert.equal(report.customerPayableCreditPaise,null);
});

test('unskip reverses the same morning, with independent signed provenance',async()=>{
  const result=await unskipDeliveryDate(pool,{subscriptionId:subId,customerId,skipDate:target});
  assert.equal(result.success,true,JSON.stringify(result));
  const rows=await pool.query(
    "SELECT source_kind,delivery_date::text AS day,days_delta,amount_paise "+
    "FROM subscription_billing_credit_provenance WHERE subscription_id=$1 ORDER BY id",
    [subId]
  );
  assert.equal(rows.rowCount,4);
  assert.deepEqual(rows.rows.filter(r=>r.day===target).map(r=>r.days_delta),[1,1,-1]);
  const review=await previewRecurringFinanceReconciliation(pool,{subscriptionId:subId});
  assert.equal(review.billingAdjustments.credit.days,2);
  assert.equal(review.datedCreditProvenance.netCreditDaysEvidenced,2);
  assert.equal(review.datedCreditProvenance.legacyOrMissingEvidence,false);
  assert.equal(review.mayAutoRefund,false);
});

test('signed captured recurring payment observation is one per payment, never whole contract estimate',async()=>{
  const row=(await pool.query('SELECT * FROM customer_subscriptions WHERE id=$1',[subId])).rows[0];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const args={
      subscription:row,rawPaymentEntity:payment,eventId:'evt_provenance_pg_001',
      paidCount:1,enabled:true
    };
    const first=await recordSignedRecurringCaptureObservation(client,args);
    assert.equal(first.recorded,true);
    const second=await recordSignedRecurringCaptureObservation(client,args);
    assert.equal(second.reason,'already_observed');
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const report=await previewRecurringFinanceReconciliation(pool,{subscriptionId:subId});
  assert.equal(report.signedWebhookCaptureObservations.recordedPayments,1);
  assert.equal(report.signedWebhookCaptureObservations.observedCapturedAmountPaise,315000);
  assert.equal(report.signedWebhookCaptureObservations.evidenceOnlyNotSettlementProof,true);
  const record=await pool.query(
    "SELECT proof_level,currency,paid_count_at_event FROM recurring_subscription_capture_observations WHERE subscription_id=$1",
    [subId]
  );
  assert.equal(record.rowCount,1);
  assert.equal(record.rows[0].proof_level,'signed_webhook_payment_entity');
  assert.equal(record.rows[0].currency,'INR');
});

test('conflicting replay of same gateway payment cannot overwrite verified amount',async()=>{
  const row=(await pool.query('SELECT * FROM customer_subscriptions WHERE id=$1',[subId])).rows[0];
  await assert.rejects(
    recordSignedRecurringCaptureObservation(pool,{
      subscription:row,rawPaymentEntity:{...payment,amount:21000},
      eventId:'evt_provenance_pg_002',paidCount:1,enabled:true
    }),
    /recurring_capture_observation_payment_conflict/
  );
  const r=await pool.query(
    "SELECT amount_paise FROM recurring_subscription_capture_observations WHERE subscription_id=$1",
    [subId]
  );
  assert.equal(r.rowCount,1);
  assert.equal(Number(r.rows[0].amount_paise),315000);
});

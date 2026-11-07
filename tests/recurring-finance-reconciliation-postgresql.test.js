/**
 * Read-only recurring financial reconciliation from a disposable PG schema.
 * No staging, real customer records, Razorpay gateway or deployment.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupDisposableTestSchema,cleanupDisposableTestSchema} from './helpers/testDbGuard.js';
import {previewRecurringFinanceReconciliation} from '../src/services/recurringFinanceReconciliation.js';

let setup,pool,subId,customerId,obId;
const notes={
  keyMode:'live',fulfillmentEntitled:true,paidCount:1,months:1,
  lastPaymentId:'pay_disposable_finance_review_2026',
  startDate:'2026-11-06',paidThroughDate:'2026-12-05'
};

before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const cust=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash) "+
    "VALUES('Finance Report Test','accounting-disposable@test.invalid','9000000077','salt','hash') RETURNING id"
  );
  customerId=cust.rows[0].id;
  const sub=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,status,razorpay_subscription_id,notes) "+
    "VALUES($1,'Pure Cow Milk','1 Litre','month',10500,315000,'active','sub_disposable_finance_review_2026',$2::jsonb) RETURNING id",
    [customerId,JSON.stringify(notes)]
  );
  subId=sub.rows[0].id;
  await pool.query(
    "INSERT INTO subscription_billing_adjustments "+
    "(subscription_id,customer_id,adjustment_type,days_count,amount_paise,notes) "+
    "VALUES ($1,$2,'credit',1,10500,'Skipped synthetic date'),"+
    "($1,$2,'credit',2,21000,'Vacation synthetic range'),"+
    "($1,$2,'credit',-1,-10500,'Reversal of synthetic skip')",
    [subId,customerId]
  );
  await pool.query(
    "INSERT INTO subscription_entitlement_ledger "+
    "(subscription_id,customer_id,entry_type,days_delta,amount_paise,notes) "+
    "VALUES($1,$2,'delivery_skipped',1,10500,'Synthetic skip'),"+
    "($1,$2,'vacation_pause',2,21000,'Synthetic vacation'),"+
    "($1,$2,'credit_consumed',-1,-10500,'Synthetic unskip')",
    [subId,customerId]
  );
  const ob=await pool.query(
    "INSERT INTO subscription_recurring_morning_obligations "+
    "(subscription_id,customer_id,razorpay_subscription_id,payment_id,"+
    "first_cycle_start,first_cycle_end,first_eligible_delivery,owed_mornings,daily_rate_paise,status) "+
    "VALUES($1,$2,'sub_disposable_finance_review_2026','pay_disposable_finance_review_2026',"+
    "'2026-11-01','2026-11-30','2026-11-08',2,10500,'approved') RETURNING id",
    [subId,customerId]
  );
  obId=ob.rows[0].id;
  const ord=await pool.query(
    "INSERT INTO subscription_delivery_orders "+
    "(delivery_order_number,subscription_id,customer_id,product_name,quantity,"+
    "delivery_date,status,delivery_address,fulfillment_source) "+
    "VALUES('MV-FINANCE-TEST-1',$1,$2,'Pure Cow Milk','1 Litre','2026-12-06',"+
    "'scheduled','{}'::jsonb,'owed_morning_prototype') RETURNING id",
    [subId,customerId]
  );
  await pool.query(
    "INSERT INTO subscription_recurring_morning_reservations "+
    "(obligation_id,subscription_id,customer_id,delivery_order_id,delivery_date,status) "+
    "VALUES($1,$2,$3,$4,'2026-12-06','reserved')",
    [obId,subId,customerId,ord.rows[0].id]
  );
  await pool.query(
    "INSERT INTO refund_requests "+
    "(request_number,request_type,customer_id,subscription_id,payment_id,"+
    "requested_amount_paise,calculated_eligible_amount_paise,reason_category,idempotency_key,status) "+
    "VALUES('REF-FINANCE-REVIEW-DISPOSABLE','subscription',$1,$2,'pay_disposable_finance_review_2026',"+
    "10500,10500,'cancellation','finance-review-disposable','pending')",
    [customerId,subId]
  );
});
after(async()=>{if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);});

test('read-only snapshot separates recurring credits, owed mornings, held days, and refund claims',async()=>{
  const review=await previewRecurringFinanceReconciliation(pool,{subscriptionId:subId});
  assert.equal(review.success,true);
  assert.equal(review.source,'read_only_finance_reconciliation');
  assert.equal(review.paidThroughDate,'2026-12-05');
  assert.equal(review.billingAdjustments.credit.days,2);
  assert.equal(review.billingAdjustments.credit.amountPaise,21000);
  assert.equal(review.billingAdjustments.credit.entries,3);
  assert.equal(review.owedMorningObligations.owedMornings,2);
  assert.equal(review.owedMorningObligations.activeReservedMornings,1);
  assert.equal(review.owedMorningObligations.items[0].unreservedMornings,1);
  assert.equal(review.owedMorningObligations.potentialUnsettledPaise,21000);
  assert.equal(review.refundRequests.pendingPaise,10500);
  assert.equal(review.deliveryOrders.prototypeScheduled,1);
  assert.ok(review.reviewFlags.includes('independent_credits_and_owed_mornings_overlap_unreconciled'));
  assert.ok(review.reviewFlags.includes('refund_and_owed_obligation_overlap_unreconciled'));
  assert.equal(review.customerPayableCreditPaise,null);
  assert.equal(review.customerRefundableAmountPaise,null);
  assert.equal(review.mayAutoRefund,false);
  assert.equal(review.mayAutoApplyCredits,false);
  assert.equal(review.mayAutoGenerateDeliveries,false);
});

test('report does not alter obligations, credits, refunds, orders or other ledgers',async()=>{
  const snapshot=async()=>{
    const rows=await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM subscription_billing_adjustments WHERE subscription_id=$1',[subId]),
      pool.query('SELECT COUNT(*)::int AS n FROM subscription_entitlement_ledger WHERE subscription_id=$1',[subId]),
      pool.query('SELECT owed_mornings,fulfilled_mornings,refunded_mornings FROM subscription_recurring_morning_obligations WHERE id=$1',[obId]),
      pool.query('SELECT status FROM refund_requests WHERE subscription_id=$1',[subId]),
      pool.query('SELECT status FROM subscription_recurring_morning_reservations WHERE obligation_id=$1',[obId])
    ]);
    return rows.map(r=>r.rows);
  };
  const original=await snapshot();
  await previewRecurringFinanceReconciliation(pool,{subscriptionId:subId});
  assert.deepEqual(await snapshot(),original);
});

test('report-only service has no public route or Razorpay refund call and uses repeatable-read read-only SQL',()=>{
  const code=fs.readFileSync(new URL('../src/services/recurringFinanceReconciliation.js',import.meta.url),'utf8');
  assert.match(code,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(code,/razorpay\.(subscriptions|payments|refunds)/);
  assert.doesNotMatch(code,/INSERT INTO|UPDATE subscription_|DELETE FROM/);
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.doesNotMatch(server,/previewRecurringFinanceReconciliation/);
});

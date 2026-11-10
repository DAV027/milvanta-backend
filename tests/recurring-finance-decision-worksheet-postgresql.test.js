/**
 * Read-only date-level finance decision worksheet, disposable PG schema only.
 * No actual customer/merchant account, gateway calls or deliverable orders.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDisposableTestSchema,cleanupDisposableTestSchema}
  from './helpers/testDbGuard.js';
import {previewRecurringFinanceDecisionWorksheet}
  from '../src/services/recurringFinanceDecisionWorksheet.js';

let setup,pool,subId,customerId,obId,orderId;
const day='2026-11-12';
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const c=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash) "+
    "VALUES('Worksheet Customer','decision-worksheet@test.invalid','9000000038','salt','hash') RETURNING id"
  );
  customerId=c.rows[0].id;
  const notes={keyMode:'live',months:1,paidCount:1,fulfillmentEntitled:true,
    lastPaymentId:'pay_decision_worksheet_1',startDate:'2026-11-06',
    paidThroughDate:'2026-12-05'};
  const sub=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,"+
    "status,razorpay_subscription_id,notes) "+
    "VALUES($1,'Milk','1 Litre','month',10500,315000,'active',"+
    "'sub_decision_worksheet_1',$2::jsonb) RETURNING id",
    [customerId,JSON.stringify(notes)]
  );
  subId=sub.rows[0].id;
  const a=await pool.query(
    "INSERT INTO subscription_billing_adjustments "+
    "(subscription_id,customer_id,adjustment_type,days_count,amount_paise,notes) "+
    "VALUES($1,$2,'credit',1,10500,'Synthetic skip') RETURNING id",
    [subId,customerId]
  );
  const b=await pool.query(
    "INSERT INTO subscription_billing_adjustments "+
    "(subscription_id,customer_id,adjustment_type,days_count,amount_paise,notes) "+
    "VALUES($1,$2,'credit',1,10500,'Synthetic overlapping vacation') RETURNING id",
    [subId,customerId]
  );
  const ids=[a.rows[0].id,b.rows[0].id];
  for(let i=0;i<ids.length;i++){
    await pool.query(
      "INSERT INTO subscription_billing_credit_provenance "+
      "(subscription_id,customer_id,billing_adjustment_id,source_kind,source_reference,"+
      "delivery_date,days_delta,amount_paise) "+
      "VALUES($1,$2,$3,$4,$5,$6,1,10500)",
      [subId,customerId,ids[i],i===0?'skip':'vacation',i===0?'skip:21':'vacation:31',day]
    );
  }
  const ob=await pool.query(
    "INSERT INTO subscription_recurring_morning_obligations "+
    "(subscription_id,customer_id,razorpay_subscription_id,payment_id,"+
    "first_cycle_start,first_cycle_end,first_eligible_delivery,owed_mornings,daily_rate_paise,status) "+
    "VALUES($1,$2,'sub_decision_worksheet_1','pay_decision_worksheet_1',"+
    "'2026-11-01','2026-11-30','2026-11-08',2,10500,'approved') RETURNING id",
    [subId,customerId]
  );
  obId=ob.rows[0].id;
  const order=await pool.query(
    "INSERT INTO subscription_delivery_orders "+
    "(delivery_order_number,subscription_id,customer_id,product_name,quantity,"+
    "delivery_date,status,delivery_address,fulfillment_source) "+
    "VALUES('MV-FINANCE-DECISION-TEST',$1,$2,'Milk','1 Litre','2026-12-06',"+
    "'scheduled','{}'::jsonb,'owed_morning_prototype') RETURNING id",
    [subId,customerId]
  );
  orderId=order.rows[0].id;
  await pool.query(
    "INSERT INTO subscription_recurring_morning_reservations "+
    "(obligation_id,subscription_id,customer_id,delivery_order_id,delivery_date,status) "+
    "VALUES($1,$2,$3,$4,'2026-12-06','reserved')",
    [obId,subId,customerId,orderId]
  );
  await pool.query(
    "INSERT INTO refund_requests "+
    "(request_number,request_type,customer_id,subscription_id,payment_id,"+
    "requested_amount_paise,calculated_eligible_amount_paise,reason_category,idempotency_key) "+
    "VALUES('REF-DECISION-WORKSHEET','subscription',$1,$2,'pay_decision_worksheet_1',"+
    "10500,10500,'non_delivery','decision-worksheet-test')",
    [customerId,subId]
  );
});
after(async()=>{if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);});

test('transactionally combines duplicate dated credits, outstanding owed mornings and refund claims',async()=>{
  const review=await previewRecurringFinanceDecisionWorksheet(pool,{subscriptionId:subId});
  assert.equal(review.success,true);
  assert.equal(review.auditType,'internal_read_only_date_evidence');
  const overlap=review.dateRows.find(x=>x.deliveryDate===day);
  assert.equal(overlap.positiveSourceRows,2);
  assert.ok(overlap.flags.includes('multiple_credit_sources_same_morning'));
  assert.equal(review.adjustmentCoverage.length,2);
  assert.ok(review.adjustmentCoverage.every(x=>x.provenanceMatchesAdjustment));
  assert.equal(review.obligationInventory.remainingUnassignedMornings,2);
  assert.equal(review.obligationInventory.activePrototypeHolds,1);
  assert.ok(review.reviewFlags.includes('owed_mornings_not_allocated_to_unique_compensation_dates'));
  assert.ok(review.reviewFlags.includes('refund_requests_require_external_verification'));
  assert.ok(review.dateRows.some(x=>x.flags.includes('active_prototype_hold_on_date')));
  assert.equal(review.customerPayableCreditPaise,null);
  assert.equal(review.customerRefundableAmountPaise,null);
  assert.equal(review.mayAutoRefund,false);
  assert.equal(review.mayAutoGenerateDeliveries,false);
});

test('date worksheet never mutates credit, fulfillment, refund or obligation tables',async()=>{
  const before=await Promise.all([
    pool.query('SELECT owed_mornings,fulfilled_mornings,refunded_mornings,status FROM subscription_recurring_morning_obligations WHERE id=$1',[obId]),
    pool.query('SELECT status FROM subscription_recurring_morning_reservations WHERE obligation_id=$1',[obId]),
    pool.query('SELECT status FROM subscription_delivery_orders WHERE id=$1',[orderId]),
    pool.query('SELECT status FROM refund_requests WHERE subscription_id=$1',[subId]),
    pool.query('SELECT COUNT(*)::int AS n FROM subscription_billing_credit_provenance WHERE subscription_id=$1',[subId])
  ]);
  const state=before.map(v=>v.rows);
  await previewRecurringFinanceDecisionWorksheet(pool,{subscriptionId:subId});
  const after=await Promise.all([
    pool.query('SELECT owed_mornings,fulfilled_mornings,refunded_mornings,status FROM subscription_recurring_morning_obligations WHERE id=$1',[obId]),
    pool.query('SELECT status FROM subscription_recurring_morning_reservations WHERE obligation_id=$1',[obId]),
    pool.query('SELECT status FROM subscription_delivery_orders WHERE id=$1',[orderId]),
    pool.query('SELECT status FROM refund_requests WHERE subscription_id=$1',[subId]),
    pool.query('SELECT COUNT(*)::int AS n FROM subscription_billing_credit_provenance WHERE subscription_id=$1',[subId])
  ]);
  assert.deepEqual(after.map(v=>v.rows),state);
});

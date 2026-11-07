/**
 * Disposable-only verification of the migration 023 release trigger and
 * refund-approval hold. No real customer, notifications or Razorpay calls.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDisposableTestSchema,cleanupDisposableTestSchema} from './helpers/testDbGuard.js';
import {getISTCalendarYMD,getEarliestPermittedDeliveryDateYMD} from '../src/services/deliveryCronPolicy.js';
import {addDaysToYMD,unskipDeliveryDate} from '../src/services/subscriptionService.js';
import {reservePrototypeOwedMorning} from '../src/services/recurringMorningReservationPrototype.js';
import {approveRefundRequest} from '../src/services/refundService.js';

process.env.NODE_ENV='test';
process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED='true';

const today=getISTCalendarYMD();
const target=getEarliestPermittedDeliveryDateYMD();
const cycleStart=today.slice(0,7)+'-01';
const dt=new Date(today+'T00:00:00Z');
const cycleEnd=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).toISOString().slice(0,10);
let setup,pool,customerId,adminId,subId,obId,first,second,third,fourth;

async function reservation(id) {
  const result=await pool.query(
    "SELECT status,release_reason FROM subscription_recurring_morning_reservations WHERE delivery_order_id=$1",
    [id]
  );
  return result.rows[0];
}
async function auditCount() {
  const row=await pool.query(
    "SELECT COUNT(*)::int AS n FROM subscription_recurring_morning_obligation_events WHERE obligation_id=$1 AND event_key LIKE 'prototype_released:%'",
    [obId]
  );
  return row.rows[0].n;
}
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const cust=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash) "+
    "VALUES('Bulk Test','proto-bulk@tests.invalid','9000000092','salt','hash') RETURNING id"
  );
  customerId=cust.rows[0].id;
  const adm=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash,is_admin) "+
    "VALUES('Refund Admin','refund-review@tests.invalid','9000000093','salt','hash',TRUE) RETURNING id"
  );
  adminId=adm.rows[0].id;
  const notes={
    keyMode:'live',fulfillmentEntitled:true,lastPaymentId:'pay_proto_bulk_test',
    startDate:cycleStart,paidThroughDate:today,paidCount:1,months:1
  };
  const sub=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,status,"+
    "razorpay_subscription_id,delivery_address,notes) "+
    "VALUES ($1,'Test Cow Milk','1 Litre','month',10500,315000,'active','sub_proto_bulk_test',$2::jsonb,$3::jsonb) "+
    "RETURNING id",
    [customerId,JSON.stringify({street:'Imaginary St',house:'42',pincode:'500033'}),JSON.stringify(notes)]
  );
  subId=sub.rows[0].id;
  const ob=await pool.query(
    "INSERT INTO subscription_recurring_morning_obligations "+
    "(subscription_id,customer_id,razorpay_subscription_id,payment_id,first_cycle_start,"+
    "first_cycle_end,first_eligible_delivery,owed_mornings,daily_rate_paise,status) "+
    "VALUES($1,$2,'sub_proto_bulk_test','pay_proto_bulk_test',$3,$4,$5,4,10500,'approved') RETURNING id",
    [subId,customerId,cycleStart,cycleEnd,today]
  );
  obId=ob.rows[0].id;
  const book=async (d)=>{
    const result=await reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:d});
    assert.equal(result.success,true,JSON.stringify(result));
    return result.deliveryOrderId;
  };
  first=await book(target);
  second=await book(addDaysToYMD(target,1));
  third=await book(addDaysToYMD(target,2));
  fourth=await book(addDaysToYMD(target,3));
});
after(async()=>{
  delete process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED;
  if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);
});

test('transaction rollback reverses trigger release and audit atomically',async()=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      "UPDATE subscription_delivery_orders SET status='cancelled',failed_reason='Pause' WHERE id=$1",
      [first]
    );
    const r=await client.query(
      'SELECT status FROM subscription_recurring_morning_reservations WHERE delivery_order_id=$1',
      [first]
    );
    assert.equal(r.rows[0].status,'released');
    await client.query('ROLLBACK');
  }finally{client.release();}
  assert.equal((await reservation(first)).status,'reserved');
  assert.equal(await auditCount(),0);
});

test('bulk pause and vacation SQL both release held mornings once',async()=>{
  await pool.query(
    "UPDATE subscription_delivery_orders SET status='cancelled',"+
    "failed_reason='Subscription paused by customer',updated_at=NOW() "+
    "WHERE subscription_id=$1 AND delivery_date=$2 AND status='scheduled'",
    [subId,target]
  );
  assert.equal((await reservation(first)).status,'released');
  assert.equal((await reservation(first)).release_reason,'prototype_cancelled');

  const vacationDate=addDaysToYMD(target,1);
  await pool.query(
    "UPDATE subscription_delivery_orders SET status='cancelled',"+
    "failed_reason='Vacation mode active',updated_at=NOW() "+
    "WHERE subscription_id=$1 AND delivery_date >= $2 AND delivery_date <= $3 AND status='scheduled'",
    [subId,vacationDate,vacationDate]
  );
  assert.equal((await reservation(second)).status,'released');
  assert.equal(await auditCount(),2);
  await pool.query(
    "UPDATE subscription_delivery_orders SET status='cancelled' WHERE id=$1",
    [second]
  );
  assert.equal(await auditCount(),2,'repeated terminal status must not add an event');
});

test('bulk customer cancellation also releases without settling owed mornings',async()=>{
  await pool.query(
    "UPDATE subscription_delivery_orders SET status='cancelled',"+
    "failed_reason='Subscription cancelled by customer',updated_at=NOW() "+
    "WHERE subscription_id=$1 AND status='scheduled'",
    [subId]
  );
  for(const id of [first,second,third,fourth]){
    assert.equal((await reservation(id)).status,'released');
  }
  assert.equal(await auditCount(),4);
  const balance=await pool.query(
    'SELECT fulfilled_mornings,refunded_mornings FROM subscription_recurring_morning_obligations WHERE id=$1',
    [obId]
  );
  assert.equal(balance.rows[0].fulfilled_mornings,0);
  assert.equal(balance.rows[0].refunded_mornings,0);
});

test('unskip cannot revive a released prototype reservation',async()=>{
  const restoreDate=addDaysToYMD(target,2);
  await pool.query(
    "UPDATE subscription_delivery_orders SET failed_reason='Delivery date skipped by customer' WHERE id=$1",
    [third]
  );
  await pool.query(
    "INSERT INTO subscription_skipped_dates(subscription_id,customer_id,skip_date,reason) "+
    "VALUES($1,$2,$3,'Test-only skip')",
    [subId,customerId,restoreDate]
  );
  // The ordinary customer unskip API is allowed to undo a real paid-order
  // skip, but it must never resurrect a released owed-morning prototype.
  await pool.query(
    "UPDATE customer_subscriptions SET notes=jsonb_set(notes,'{paidThroughDate}',to_jsonb($2::text)) WHERE id=$1",
    [subId,restoreDate]
  );
  const unskip=await unskipDeliveryDate(pool,{
    subscriptionId:subId,customerId,skipDate:restoreDate
  });
  assert.equal(unskip.success,true,JSON.stringify(unskip));
  const r=await pool.query(
    'SELECT status FROM subscription_delivery_orders WHERE id=$1',
    [third]
  );
  assert.equal(r.rows[0].status,'cancelled');
  assert.equal((await reservation(third)).status,'released');
});

test('subscription refund approval is blocked before any Razorpay money movement',async()=>{
  const req=await pool.query(
    "INSERT INTO refund_requests "+
    "(request_number,request_type,customer_id,subscription_id,payment_id,"+
    "requested_amount_paise,calculated_eligible_amount_paise,reason_category,idempotency_key) "+
    "VALUES('REF-PROTO-BULK-001','subscription',$1,$2,'pay_proto_bulk_test',"+
    "21000,21000,'cancellation','proto-bulk-refund-review') RETURNING id",
    [customerId,subId]
  );
  let gatewayCalls=0;
  const result=await approveRefundRequest(pool,{
    refundRequestId:req.rows[0].id,adminId,approvedAmountPaise:21000,
    razorpayClient:{payments:{refund:async()=>{gatewayCalls++;throw Error('must not charge/refund');}}}
  });
  assert.equal(result.success,false);
  assert.equal(result.error,'recurring_morning_liability_requires_reconciliation');
  assert.equal(result.statusCode,409);
  assert.equal(gatewayCalls,0);
  const check=await pool.query(
    'SELECT status,approved_amount_paise FROM refund_requests WHERE id=$1',
    [req.rows[0].id]
  );
  assert.equal(check.rows[0].status,'pending');
  assert.equal(check.rows[0].approved_amount_paise,null);
});

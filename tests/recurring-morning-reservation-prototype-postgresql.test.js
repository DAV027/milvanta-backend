/**
 * Test-only, disposable-Postgres prototype verification. No staging, live
 * customers, real deliveries, Razorpay, notifications, or external workers.
 */
import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDisposableTestSchema,cleanupDisposableTestSchema} from './helpers/testDbGuard.js';
import {getEarliestPermittedDeliveryDateYMD,getISTCalendarYMD} from '../src/services/deliveryCronPolicy.js';
import {addDaysToYMD} from '../src/services/subscriptionService.js';
import {updateDeliveryStatus} from '../src/services/deliveryEngine.js';
import {
  reservePrototypeOwedMorning,transitionPrototypeOwedMorning
} from '../src/services/recurringMorningReservationPrototype.js';

process.env.NODE_ENV='test';
process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED='true';

const today=getISTCalendarYMD();
const target=getEarliestPermittedDeliveryDateYMD();
const later=addDaysToYMD(target,1);
const third=addDaysToYMD(target,2);
const todayDate=new Date(today+'T00:00:00Z');
const monthStart=today.slice(0,7)+'-01';
const monthEnd=new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()+1,0))
  .toISOString().slice(0,10);

let setup,pool,subId,obId,customerId,firstOrder,secondOrder,thirdOrder;

async function countRows(table) {
  const safe=['subscription_recurring_morning_reservations','subscription_delivery_orders',
    'subscription_recurring_morning_obligation_events'];
  assert.ok(safe.includes(table));
  return Number((await pool.query('SELECT COUNT(*)::int AS n FROM '+table)).rows[0].n);
}
async function getBalance(){
  const r=await pool.query(
    'SELECT owed_mornings,fulfilled_mornings,refunded_mornings FROM subscription_recurring_morning_obligations WHERE id=$1',
    [obId]
  );
  return r.rows[0];
}
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const customer=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash) "+
    "VALUES('Prototype Customer','prototype-reservation@test.invalid','9000000088','salt','hash') RETURNING id"
  );
  customerId=customer.rows[0].id;
  const notes={
    keyMode:'live',fulfillmentEntitled:true,
    lastPaymentId:'pay_disposable_proto_01',
    startDate:monthStart,paidThroughDate:today,paidCount:1,months:1
  };
  const s=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,"+
    "status,razorpay_subscription_id,delivery_address,notes) "+
    "VALUES ($1,'Pure Cow Milk','1 Litre','month',10500,315000,"+
    "'active','sub_disposable_proto_01',$2::jsonb,$3::jsonb) RETURNING id",
    [customerId,JSON.stringify({house:'42',street:'Test Street',pincode:'500033'}),JSON.stringify(notes)]
  );
  subId=s.rows[0].id;
  const ob=await pool.query(
    "INSERT INTO subscription_recurring_morning_obligations "+
    "(subscription_id,customer_id,razorpay_subscription_id,payment_id,"+
    "first_cycle_start,first_cycle_end,first_eligible_delivery,"+
    "owed_mornings,daily_rate_paise,status) "+
    "VALUES ($1,$2,'sub_disposable_proto_01','pay_disposable_proto_01',"+
    "$3,$4,$5,2,10500,'approved') RETURNING id",
    [subId,customerId,monthStart,monthEnd,today]
  );
  obId=ob.rows[0].id;
});
after(async()=>{
  delete process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED;
  if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);
});

test('prototype is denied when its explicit test-only flag is missing',async()=>{
  const before=await countRows('subscription_delivery_orders');
  process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED='false';
  try{
    const result=await reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:target});
    assert.equal(result.success,false);
    assert.equal(result.reason,'prototype_disabled');
    assert.equal(await countRows('subscription_delivery_orders'),before);
  }finally{
    process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED='true';
  }
});

test('two concurrent attempts for same date reserve exactly one source-tagged order',async()=>{
  const result=await Promise.all([
    reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:target}),
    reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:target})
  ]);
  const successes=result.filter(r=>r.success);
  assert.equal(successes.length,1);
  assert.equal(result.filter(r=>r.reason==='delivery_order_already_exists').length,1);
  firstOrder=successes[0].deliveryOrderId;
  assert.equal(successes[0].dispatchAuthorized,false);
  assert.equal(await countRows('subscription_delivery_orders'),1);
  assert.equal(await countRows('subscription_recurring_morning_reservations'),1);
  const row=await pool.query('SELECT fulfillment_source,status FROM subscription_delivery_orders WHERE id=$1',[firstOrder]);
  assert.equal(row.rows[0].fulfillment_source,'owed_morning_prototype');
  assert.equal(row.rows[0].status,'scheduled');
});

test('normal operational endpoint refuses prototype rows even in test environment',async()=>{
  const result=await updateDeliveryStatus(pool,{
    deliveryOrderId:firstOrder,status:'packed',actor:'driver_fake',enforceLiveGateway:true
  });
  assert.equal(result.success,false);
  assert.equal(result.error,'prototype_owed_morning_not_operational');
  assert.equal(result.statusCode,409);
  const row=await pool.query('SELECT status FROM subscription_delivery_orders WHERE id=$1',[firstOrder]);
  assert.equal(row.rows[0].status,'scheduled');
});

test('reservation balance includes active holds, so third day cannot overbook two owed mornings',async()=>{
  const second=await reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:later});
  assert.equal(second.success,true);
  secondOrder=second.deliveryOrderId;
  const overbook=await reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:third});
  assert.equal(overbook.success,false);
  assert.equal(overbook.reason,'no_unreserved_mornings');
  assert.equal(await countRows('subscription_delivery_orders'),2);
  assert.equal((await getBalance()).fulfilled_mornings,0);
});

test('actual prototype scheduled->packed->out_for_delivery->delivered settles once',async()=>{
  for(const status of ['packed','out_for_delivery','delivered']){
    const result=await transitionPrototypeOwedMorning(pool,{
      deliveryOrderId:firstOrder,status,actor:'test_operator'
    });
    assert.equal(result.success,true,status);
    assert.equal(result.status,status);
  }
  const row=await pool.query(
    'SELECT status FROM subscription_recurring_morning_reservations WHERE delivery_order_id=$1',
    [firstOrder]
  );
  assert.equal(row.rows[0].status,'fulfilled');
  assert.equal((await getBalance()).fulfilled_mornings,1);
  const repeated=await transitionPrototypeOwedMorning(pool,{deliveryOrderId:firstOrder,status:'delivered'});
  assert.equal(repeated.success,false);
  assert.equal(repeated.reason,'reservation_not_active');
  assert.equal((await getBalance()).fulfilled_mornings,1);
  const event=await pool.query(
    "SELECT COUNT(*)::int AS n FROM subscription_recurring_morning_obligation_events "+
    "WHERE obligation_id=$1 AND event_type='fulfilled'",
    [obId]
  );
  assert.equal(event.rows[0].n,1);
});

test('cancelling a reserved morning releases its balance without crediting fulfillment',async()=>{
  const cancel=await transitionPrototypeOwedMorning(pool,{
    deliveryOrderId:secondOrder,status:'cancelled',actor:'test_operator'
  });
  assert.equal(cancel.success,true);
  assert.equal(cancel.reservationStatus,'released');
  const row=await pool.query(
    'SELECT status,release_reason FROM subscription_recurring_morning_reservations WHERE delivery_order_id=$1',
    [secondOrder]
  );
  assert.equal(row.rows[0].status,'released');
  assert.equal(row.rows[0].release_reason,'prototype_cancelled');
  assert.equal((await getBalance()).fulfilled_mornings,1);
  const next=await reservePrototypeOwedMorning(pool,{subscriptionId:subId,targetDate:third});
  assert.equal(next.success,true);
  thirdOrder=next.deliveryOrderId;
  assert.equal(await countRows('subscription_delivery_orders'),3);
});

test('renewal after reservation blocks future prototype dispatch but permits cancellation release',async()=>{
  await pool.query(
    "UPDATE customer_subscriptions SET notes=jsonb_set(jsonb_set(notes,'{paidCount}','2'::jsonb),"+
    "'{paidThroughDate}',to_jsonb($2::text)) WHERE id=$1",
    [subId,addDaysToYMD(third,30)]
  );
  const blocked=await transitionPrototypeOwedMorning(pool,{
    deliveryOrderId:thirdOrder,status:'packed',actor:'test_operator'
  });
  assert.equal(blocked.success,false);
  assert.equal(blocked.reason,'renewal_or_payment_changed');
  const order=await pool.query('SELECT status FROM subscription_delivery_orders WHERE id=$1',[thirdOrder]);
  assert.equal(order.rows[0].status,'scheduled');
  const cancel=await transitionPrototypeOwedMorning(pool,{
    deliveryOrderId:thirdOrder,status:'cancelled',actor:'test_operator'
  });
  assert.equal(cancel.success,true);
  assert.equal(cancel.reservationStatus,'released');
  assert.equal((await getBalance()).fulfilled_mornings,1);
  const outstanding=await pool.query(
    "SELECT COUNT(*)::int AS n FROM subscription_recurring_morning_reservations "+
    "WHERE obligation_id=$1 AND status='reserved'",
    [obId]
  );
  assert.equal(outstanding.rows[0].n,0);
});

test('migration prevents additional reservation on reused subscription/date even after release',async()=>{
  const copy=await pool.query(
    "SELECT obligation_id,subscription_id,customer_id,delivery_order_id,delivery_date "+
    "FROM subscription_recurring_morning_reservations WHERE delivery_order_id=$1",
    [secondOrder]
  );
  const res=copy.rows[0];
  await assert.rejects(pool.query(
    "INSERT INTO subscription_recurring_morning_reservations "+
    "(obligation_id,subscription_id,customer_id,delivery_order_id,delivery_date) "+
    "VALUES($1,$2,$3,$4,$5)",
    [res.obligation_id,res.subscription_id,res.customer_id,res.delivery_order_id,res.delivery_date]
  ),err=>err.code==='23505');
});

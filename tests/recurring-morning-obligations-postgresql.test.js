/**
 * Disposable PostgreSQL integration for the opt-in liability ledger.
 * Does not query, migrate, or modify production/staging databases.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';
import { recordVerifiedRecurringInitialGap } from '../src/services/recurringMorningObligations.js';

const notes={
  keyMode:'live',months:1,days:30,amountPerMonthPaise:315000,
  planFirstCycleStartYMD:'2026-11-01',
  planFirstCycleEndYMD:'2026-11-30',
  planEntitlementStartYMD:'2026-11-06',
  paidThroughDate:'2026-12-05'
};
const captured={
  id:'pay_disposable_billing_123',subscription_id:'sub_disposable_billing_123',
  status:'captured',currency:'INR',amount:315000
};
const verifiedAt=new Date('2026-11-06T14:30:00Z');
let setup,pool,sub;
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const c=await pool.query("INSERT INTO customers (full_name,email,phone,password_salt,password_hash) VALUES ('Billing Test','billing-test@example.invalid','9876500042','salt','hash') RETURNING id");
  const customerId=c.rows[0].id;
  const res=await pool.query(`INSERT INTO customer_subscriptions
 (customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,status,razorpay_subscription_id,notes)
 VALUES ($1,'Milk','1 Litre','month',10500,315000,'active',$2,$3::jsonb)
 RETURNING id,customer_id,cost_per_day_paise,razorpay_subscription_id,plan_type,notes`,
    [customerId,captured.subscription_id,JSON.stringify(notes)]);
  sub=res.rows[0];
});
after(async()=>{if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);});

test('DB accrues one liability and one event despite retries',async()=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const args={subscription:sub,paidCount:1,capturedPayment:captured,verifiedAt,enabled:true};
    const first=await recordVerifiedRecurringInitialGap(client,args);
    assert.equal(first.recorded,true);
    assert.equal(first.plan.owedMornings,2);
    const again=await recordVerifiedRecurringInitialGap(client,args);
    assert.equal(again.reason,'already_recorded');
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const obs=await pool.query('SELECT * FROM subscription_recurring_morning_obligations WHERE subscription_id=$1',[sub.id]);
  assert.equal(obs.rowCount,1);
  assert.equal(obs.rows[0].status,'pending_reconciliation');
  assert.equal(obs.rows[0].owed_mornings,2);
  assert.equal(obs.rows[0].fulfilled_mornings,0);
  assert.equal(obs.rows[0].refunded_mornings,0);
  assert.equal(Number(obs.rows[0].credited_amount_paise),21000);
  const events=await pool.query('SELECT event_type,days_delta FROM subscription_recurring_morning_obligation_events WHERE obligation_id=$1',[obs.rows[0].id]);
  assert.equal(events.rowCount,1);
  assert.equal(events.rows[0].event_type,'accrued');
  assert.equal(events.rows[0].days_delta,2);
});

test('same calendar cycle with a second payment is held for finance investigation',async()=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await assert.rejects(
      recordVerifiedRecurringInitialGap(client,{
        subscription:sub,paidCount:1,capturedPayment:{...captured,id:'pay_other_disposable'},
        verifiedAt,enabled:true
      }),/recurring_obligation_duplicate_cycle_payment_conflict/);
    await client.query('ROLLBACK');
  }finally{client.release();}
  const count=await pool.query('SELECT COUNT(*)::int AS n FROM subscription_recurring_morning_obligations');
  assert.equal(count.rows[0].n,1);
});

test('DB CHECK rejects double fulfillment or refund beyond owed mornings',async()=>{
  await assert.rejects(
    pool.query('UPDATE subscription_recurring_morning_obligations SET fulfilled_mornings=3 WHERE subscription_id=$1',[sub.id]),
    err=>err.code==='23514'
  );
  const res=await pool.query('SELECT fulfilled_mornings,refunded_mornings FROM subscription_recurring_morning_obligations WHERE subscription_id=$1',[sub.id]);
  assert.equal(res.rows[0].fulfilled_mornings,0);
  assert.equal(res.rows[0].refunded_mornings,0);
});

test('liability accrual does not create physical orders or change customer entitlement',async()=>{
  const res=await pool.query('SELECT status,notes FROM customer_subscriptions WHERE id=$1',[sub.id]);
  assert.equal(res.rows[0].status,'active');
  assert.deepEqual(res.rows[0].notes,notes);
  const orders=await pool.query('SELECT COUNT(*)::int AS n FROM subscription_delivery_orders WHERE subscription_id=$1',[sub.id]);
  assert.equal(orders.rows[0].n,0);
});

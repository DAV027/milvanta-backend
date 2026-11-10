/**
 * Finance approval + redemption preview against disposable PostgreSQL only.
 * NO production/staging data, physical deliveries, gateway operations or jobs.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';
import { approveRecurringMorningObligation, previewRecurringMorningRedemption }
  from '../src/services/recurringMorningRedemption.js';

process.env.NODE_ENV='test';

const notes = {
  keyMode:'live',fulfillmentEntitled:true,paidCount:1,months:1,
  lastPaymentId:'pay_disposable_review_123',
  startDate:'2026-11-06',paidThroughDate:'2026-12-05'
};
let setup,pool,adminId,ordinaryId,subscriptionId,obligationId;
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const a=await pool.query(
    "INSERT INTO customers (full_name,email,phone,password_salt,password_hash,is_admin) VALUES ('Finance Reviewer','reviewer@test.invalid','9876501231','salt','hash',TRUE) RETURNING id"
  );
  adminId=a.rows[0].id;
  const c=await pool.query(
    "INSERT INTO customers (full_name,email,phone,password_salt,password_hash,is_admin) VALUES ('Milk Subscriber','subscriber@test.invalid','9876501232','salt','hash',FALSE) RETURNING id"
  );
  ordinaryId=c.rows[0].id;
  const sub=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,status,razorpay_subscription_id,delivery_address,notes) "+
    "VALUES ($1,'Milk','1 Litre','month',10500,315000,'active','sub_disposable_review_123',$2::jsonb,$3::jsonb) RETURNING id",
    [ordinaryId,JSON.stringify({street:'Synthetic St',house:'42',pincode:'500033'}),JSON.stringify(notes)]
  );
  subscriptionId=sub.rows[0].id;
  const ob=await pool.query(
    "INSERT INTO subscription_recurring_morning_obligations "+
    "(subscription_id,customer_id,razorpay_subscription_id,payment_id,first_cycle_start,first_cycle_end,first_eligible_delivery,owed_mornings,daily_rate_paise) "+
    "VALUES ($1,$2,'sub_disposable_review_123','pay_disposable_review_123','2026-11-01','2026-11-30','2026-11-08',2,10500) RETURNING id",
    [subscriptionId,ordinaryId]
  );
  obligationId=ob.rows[0].id;
});
after(async()=>{if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);});

test('finance approval is OFF by default and a normal customer may not approve',async()=>{
  const disabled=await approveRecurringMorningObligation(pool,{
    obligationId,reviewerId:adminId,caseReference:'FIN-REVIEW-2026'
  });
  assert.equal(disabled.reason,'approval_feature_disabled');
  const denied=await approveRecurringMorningObligation(pool,{
    obligationId,reviewerId:ordinaryId,caseReference:'FIN-REVIEW-2026',enabled:true
  });
  assert.equal(denied.approved,false);
  assert.equal(denied.reason,'finance_reviewer_not_admin');
  const current=await pool.query('SELECT status FROM subscription_recurring_morning_obligations WHERE id=$1',[obligationId]);
  assert.equal(current.rows[0].status,'pending_reconciliation');
});

test('the same reviewed obligation is approved exactly once with audit evidence',async()=>{
  const first=await approveRecurringMorningObligation(pool,{
    obligationId,reviewerId:adminId,caseReference:'FIN-REVIEW-2026',enabled:true
  });
  assert.equal(first.approved,true);
  assert.equal(first.dispatchAuthorized,false);
  const repeated=await approveRecurringMorningObligation(pool,{
    obligationId,reviewerId:adminId,caseReference:'FIN-REVIEW-2026',enabled:true
  });
  assert.equal(repeated.approved,false);
  assert.equal(repeated.reason,'already_approved');
  const res=await pool.query(
    'SELECT event_type,days_delta,evidence FROM subscription_recurring_morning_obligation_events WHERE obligation_id=$1 AND event_key=$2',
    [obligationId,'approval:'+obligationId]
  );
  assert.equal(res.rowCount,1);
  assert.equal(res.rows[0].event_type,'adjusted');
  assert.equal(res.rows[0].days_delta,0);
  assert.equal(res.rows[0].evidence.reviewerId,Number(adminId));
  assert.equal(res.rows[0].evidence.caseReference,'FIN-REVIEW-2026');
});

test('read-only candidate after paid-through does not create a delivery order',async()=>{
  const preview=await previewRecurringMorningRedemption(pool,{
    subscriptionId,targetDate:'2026-12-06',now:new Date('2026-11-07T06:00:00Z')
  });
  assert.equal(preview.eligible,true);
  assert.equal(preview.availableMornings,2);
  assert.equal(preview.canGeneratePhysicalOrder,false);
  const orders=await pool.query(
    'SELECT COUNT(*)::int AS n FROM subscription_delivery_orders WHERE subscription_id=$1',[subscriptionId]
  );
  assert.equal(orders.rows[0].n,0);
});

test('new paid renewal immediately blocks owed-morning candidate to avoid overlap',async()=>{
  await pool.query(
    "UPDATE customer_subscriptions SET notes=jsonb_set(jsonb_set(notes,'{paidCount}','2'::jsonb),'{paidThroughDate}',to_jsonb($2::text)) WHERE id=$1",
    [subscriptionId,'2027-01-05']
  );
  const preview=await previewRecurringMorningRedemption(pool,{
    subscriptionId,targetDate:'2026-12-06',now:new Date('2026-11-07T06:00:00Z')
  });
  assert.equal(preview.eligible,false);
  assert.equal(preview.reason,'renewal_or_multimonth_requires_reconciliation');
  assert.equal(preview.canGeneratePhysicalOrder,false);
  const ob=await pool.query(
    'SELECT status,fulfilled_mornings,refunded_mornings FROM subscription_recurring_morning_obligations WHERE id=$1',[obligationId]
  );
  assert.equal(ob.rows[0].status,'approved');
  assert.equal(ob.rows[0].fulfilled_mornings,0);
  assert.equal(ob.rows[0].refunded_mornings,0);
});

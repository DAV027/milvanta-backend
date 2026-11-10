/**
 * Read-only gateway reconciliation against synthetic Razorpay and disposable
 * PostgreSQL fixtures only. No live Razorpay, Render, staging, or production.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {
  setupDisposableTestSchema,cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import {previewRecurringGatewaySnapshotReconciliation}
  from '../src/services/recurringGatewaySnapshotReconciliation.js';

let setup,pool,subscriptionId,paymentId='pay_disposable_gateway_1';
const gatewaySubscriptionId='sub_disposable_gateway_1';
const gatewayRefundId='rfnd_disposable_gateway_1';
const snapshot={
  subscriptionId:gatewaySubscriptionId,accountMode:'live',complete:true,
  retrievedAt:'2026-11-09T10:00:00Z',
  payments:[{
    id:paymentId,subscription_id:gatewaySubscriptionId,
    invoice_id:'inv_disposable_gateway_1',
    captured:true,status:'captured',currency:'INR',amount:315000,
    amount_refunded:10500
  }],
  invoices:[{
    id:'inv_disposable_gateway_1',subscription_id:gatewaySubscriptionId,
    payment_id:paymentId,status:'paid',
    billing_start:1793491200,billing_end:1796083200
  }],
  refunds:[{
    id:gatewayRefundId,payment_id:paymentId,
    status:'processed',currency:'INR',amount:10500
  }]
};
before(async()=>{
  setup=await setupDisposableTestSchema();
  pool=setup.pool;
  const c=await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash) "+
    "VALUES('Independent Gateway Review','gateway-proof@test.invalid','9000000061','salt','hash') RETURNING id"
  );
  const customerId=c.rows[0].id;
  const sub=await pool.query(
    "INSERT INTO customer_subscriptions "+
    "(customer_id,product_name,quantity,plan_type,cost_per_day_paise,total_amount_paise,status,razorpay_subscription_id,notes) "+
    "VALUES($1,'Milk','1 Litre','month',10500,1890000,'active',$2,$3::jsonb) RETURNING id",
    [customerId,gatewaySubscriptionId,JSON.stringify({
      keyMode:'live',paidCount:1,months:6,fulfillmentEntitled:true,
      lastPaymentId:paymentId
    })]
  );
  subscriptionId=sub.rows[0].id;
  await pool.query(
    "INSERT INTO recurring_subscription_capture_observations "+
    "(subscription_id,customer_id,gateway_subscription_id,gateway_payment_id,"+
    "source_webhook_event_id,amount_paise,paid_count_at_event) "+
    "VALUES ($1,$2,$3,$4,'evt_disposable_gateway_1',315000,1)",
    [subscriptionId,customerId,gatewaySubscriptionId,paymentId]
  );
  await pool.query(
    "INSERT INTO refund_requests "+
    "(request_number,request_type,customer_id,subscription_id,payment_id,"+
    "requested_amount_paise,calculated_eligible_amount_paise,approved_amount_paise,"+
    "reason_category,idempotency_key,status,gateway_refund_id) "+
    "VALUES('REF-DISPOSABLE-GATEWAY-1','subscription',$1,$2,$3,"+
    "10500,10500,10500,'non_delivery','gateway-disposable-test','processed',$4)",
    [customerId,subscriptionId,paymentId,gatewayRefundId]
  );
});
after(async()=>{if(setup)await cleanupDisposableTestSchema(pool,setup.schemaName);});

test('supplied exact gateway capture/refund evidence matches existing webhook and refund records without payout',async()=>{
  const r=await previewRecurringGatewaySnapshotReconciliation(pool,{
    subscriptionId,gatewaySnapshot:snapshot
  });
  assert.equal(r.success,true);
  assert.deepEqual(r.reviewFlags,[]);
  assert.equal(r.capturedPaymentCount,1);
  assert.equal(r.observedCapturedAmountPaise,315000);
  assert.equal(r.processedRefundAmountPaise,10500);
  assert.equal(r.gatewayCycles.length,1);
  assert.equal(r.paymentComparisons[0].consistentWithWebhook,true);
  assert.equal(r.customerRefundableAmountPaise,null);
  assert.equal(r.mayAutoRefund,false);
  assert.equal(r.independentlyConfirmedSettlement,false);
  assert.notEqual(r.observedCapturedAmountPaise,1890000,'contract value is not captured revenue');
});

test('gateway receipts cannot silently rewrite local processed refund records',async()=>{
  const bad=await previewRecurringGatewaySnapshotReconciliation(pool,{
    subscriptionId,gatewaySnapshot:{...snapshot,refunds:[{
      ...snapshot.refunds[0],amount:15000
    }]}
  });
  assert.ok(bad.reviewFlags.includes('refund_totals_do_not_match_gateway_payment'));
  assert.ok(bad.reviewFlags.includes('local_processed_refund_receipt_mismatch'));
  assert.equal(bad.customerRefundableAmountPaise,null);
});

test('read-only comparison changes no customer, capture, request, or ledger row',async()=>{
  const evidence=async()=>{
    const tables=[
      'customer_subscriptions','recurring_subscription_capture_observations',
      'refund_requests','subscription_entitlement_ledger'
    ];
    const rows=await Promise.all(tables.map(async t=>{
      const r=await pool.query(
        'SELECT COUNT(*)::int AS n FROM '+t+' WHERE '+
        (t==='customer_subscriptions'?'id=$1':'subscription_id=$1'),
        [subscriptionId]
      );
      return r.rows[0].n;
    }));
    return rows;
  };
  const before=await evidence();
  await previewRecurringGatewaySnapshotReconciliation(pool,{
    subscriptionId,gatewaySnapshot:snapshot
  });
  assert.deepEqual(await evidence(),before);
});

/**
 * Read-only accounting evidence inventory for a Milvanta recurring subscription.
 *
 * It NEVER computes a payable refund/credit, changes entitlements, or
 * interprets contractual total_amount_paise as captured gateway revenue.
 * Legacy billing_adjustments have no delivery date / cycle reference, so
 * automatic netting against first-cycle obligations is unsafe.
 *
 * Internal finance-review helper only; not exposed through HTTP or cron.
 */
import {
  acquireClient, getEffectivePaidThroughDate, getSubscriptionGatewayMode,
  isRecurringAutopaySubscription
} from './subscriptionService.js';

function finiteInt(x) {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isSafeInteger(n)) throw Error('invalid_finance_reconciliation_integer');
  return n;
}
function nonneg(x) {
  const n=finiteInt(x);
  if (n < 0) throw Error('invalid_finance_reconciliation_nonnegative');
  return n;
}
const unique = entries=>[...new Set(entries)];

export function assessRecurringFinanceReconciliation({
  subscription, paidThroughDate=null,
  billingAdjustments=[], entitlementLedger=[], obligations=[],
  reservations=[], refundRequests=[], deliveryOrders=[],
  datedCreditProvenance=[],captureObservations=[]
}={}) {
  if (!subscription?.id || !subscription?.customer_id) throw Error('finance_subscription_required');
  const notes=subscription.notes && typeof subscription.notes==='object' ? subscription.notes : {};
  const gatewayMode=getSubscriptionGatewayMode(notes);
  const isRecurring=isRecurringAutopaySubscription(subscription);
  const issues=[];
  if (!isRecurring) issues.push('not_recurring_autopay');
  if (gatewayMode!=='live') issues.push('gateway_mode_not_live');
  if (notes.fulfillmentEntitled!==true || Number(notes.paidCount)<1) {
    issues.push('captured_entitlement_not_verified');
  }
  const months=Number(notes.months);
  const paidCycles=Number(notes.paidCount);
  if (!Number.isInteger(months) || months!==1) issues.push('multimonth_or_unknown_plan_policy');
  if (!Number.isInteger(paidCycles) || paidCycles!==1) issues.push('renewal_or_missing_cycle_reconciliation');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(paidThroughDate||''))) {
    issues.push('paid_through_unverified');
  }
  const dailyRate=nonneg(subscription.cost_per_day_paise||0);
  if (dailyRate===0) issues.push('daily_price_unverified');

  const adjustments={credit:{days:0,amountPaise:0,entries:0},
    extension:{days:0,amountPaise:0,entries:0},
    refund:{days:0,amountPaise:0,entries:0}};
  for(const r of billingAdjustments) {
    const key=r.adjustment_type;
    if (!Object.hasOwn(adjustments,key)) throw Error('unrecognized_billing_adjustment_type');
    adjustments[key].days+=finiteInt(r.days_count);
    adjustments[key].amountPaise+=finiteInt(r.amount_paise);
    adjustments[key].entries+=nonneg(r.row_count);
  }
  if (adjustments.credit.days!==0 || adjustments.credit.amountPaise!==0) {
    issues.push('undated_recurring_credit_provenance_requires_review');
  }
  for(const [key,v] of Object.entries(adjustments)) {
    if (v.days<0 || v.amountPaise<0) issues.push('negative_net_'+key+'_adjustment');
    if (v.days*dailyRate!==v.amountPaise && v.days!==0) {
      issues.push(key+'_amount_day_rate_mismatch');
    }
  }

  // A date-stamped source is NOT a validated payment/cycle match.
  // Overlapping positive claims remain in the report even if an unskip
  // cancels part of their net amount. No automatic credit is calculated.
  const byDate=new Map();
  let evidencedCreditDays=0, evidencedCreditPaise=0;
  for(const r of datedCreditProvenance){
    const day=String(r.delivery_date||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      issues.push('credit_provenance_invalid_delivery_date');
      continue;
    }
    const signedDays=finiteInt(r.days_delta),amount=finiteInt(r.amount_paise);
    if (signedDays!==1 && signedDays!==-1) issues.push('credit_provenance_invalid_direction');
    if (Math.sign(signedDays)!==Math.sign(amount) || Math.abs(amount)!==dailyRate) {
      issues.push('credit_provenance_price_or_direction_mismatch');
    }
    if (r.evidence_state!=='date_known_payment_unverified') {
      issues.push('unexpected_credit_capture_proof_claim');
    }
    const data=byDate.get(day)||{positive:0,negative:0,netDays:0,netPaise:0};
    data.positive+=signedDays>0?1:0;
    data.negative+=signedDays<0?1:0;
    data.netDays+=signedDays;
    data.netPaise+=amount;
    byDate.set(day,data);
    if (r.adjustment_type==='credit'){
      evidencedCreditDays+=signedDays;
      evidencedCreditPaise+=amount;
    }
  }
  const overlappingDates=[...byDate.entries()]
    .filter(([,v])=>v.positive>1)
    .map(([day])=>day);
  if (overlappingDates.length) issues.push('multiple_positive_credit_claims_same_date');
  const missingDateEvidence=adjustments.credit.days!==evidencedCreditDays ||
    adjustments.credit.amountPaise!==evidencedCreditPaise;
  if (missingDateEvidence && (adjustments.credit.entries>0 || datedCreditProvenance.length>0)){
    issues.push('credit_date_provenance_incomplete_or_legacy');
  }
  // Signed webhook observations are historical evidence, not proof of
  // settlement, nor a substitute for querying Razorpay before a refund.
  let observedCapturedTotalPaise=0;
  const observedCycles=new Map();
  const observedPaymentIds=new Set();
  for(const payment of captureObservations){
    const amount=nonneg(payment.amount_paise);
    const cycle=nonneg(payment.paid_count_at_event);
    if(amount<=0||cycle<1 || payment.currency!=='INR' ||
       payment.proof_level!=='signed_webhook_payment_entity' ||
       payment.gateway_subscription_id!==subscription.razorpay_subscription_id){
      issues.push('capture_observation_invalid_or_foreign');
      continue;
    }
    if(observedPaymentIds.has(payment.gateway_payment_id)){
      issues.push('duplicate_capture_observation_identity');
      continue;
    }
    observedPaymentIds.add(payment.gateway_payment_id);
    observedCapturedTotalPaise+=amount;
    if(!Number.isSafeInteger(observedCapturedTotalPaise)) {
      throw Error('capture_observation_amount_overflow');
    }
    observedCycles.set(cycle,(observedCycles.get(cycle)||0)+1);
  }
  if([...observedCycles.values()].some(n=>n>1)) {
    issues.push('multiple_captures_same_paid_cycle_require_review');
  }
  if (captureObservations.length && Number.isInteger(paidCycles) &&
      paidCycles>Math.max(0,...observedCycles.keys())) {
    issues.push('capture_observations_missing_paid_cycles');
  }
  if((obligations.length>0||adjustments.credit.entries>0) &&
     captureObservations.length===0){
    issues.push('no_signed_capture_observations_for_finance_claim');
  }
  for(const ob of obligations){
    if (captureObservations.length>0 &&
       !observedPaymentIds.has(ob.payment_id)) {
      issues.push('obligation_payment_absent_from_signed_capture_observations');
    }
  }

  const auditEntryCounts={};
  for(const r of entitlementLedger) {
    if (!r.entry_type) throw Error('invalid_entitlement_ledger_type');
    auditEntryCounts[r.entry_type] = {
      rows:nonneg(r.row_count),daysDelta:finiteInt(r.days_delta),
      amountPaise:finiteInt(r.amount_paise)
    };
  }

  let owed=0, fulfilled=0, refunded=0, reserved=0, obligationValue=0;
  const perObligation=[];
  for(const ob of obligations) {
    const obligationId=nonneg(ob.id);
    const days=nonneg(ob.owed_mornings),completed=nonneg(ob.fulfilled_mornings),
      returned=nonneg(ob.refunded_mornings),rate=nonneg(ob.daily_rate_paise);
    const activeHold=reservations.filter(r=>Number(r.obligation_id)===obligationId &&
      r.status==='reserved').reduce((sum,r)=>sum+nonneg(r.reservation_count),0);
    const settled=completed+returned;
    const available=days-settled-activeHold;
    if (available<0) issues.push('owed_morning_reserved_balance_violation');
    if (rate!==dailyRate) issues.push('obligation_price_mismatch');
    if (!ob.payment_id || !ob.razorpay_subscription_id ||
        ob.razorpay_subscription_id!==subscription.razorpay_subscription_id ||
        ob.payment_id!==(notes.lastPaymentId || notes.paymentId)) {
      issues.push('obligation_and_payment_evidence_mismatch');
    }
    if (ob.status!=='approved' && ob.status!=='pending_reconciliation' && ob.status!=='closed') {
      issues.push('unknown_obligation_status');
    }
    owed+=days;fulfilled+=completed;refunded+=returned;reserved+=activeHold;
    obligationValue+=Math.max(0,days-settled)*rate;
    perObligation.push({
      id:obligationId,status:ob.status,
      owedMornings:days,fulfilledMornings:completed,
      refundedMornings:returned,reservedMornings:activeHold,
      unreservedMornings:Math.max(0,available),
      potentialUnsettledPaise:Math.max(0,days-settled)*rate,
      paymentEvidencePresent:Boolean(ob.payment_id&&ob.razorpay_subscription_id)
    });
  }

  if (obligations.length>0 && adjustments.credit.days>0) {
    issues.push('independent_credits_and_owed_mornings_overlap_unreconciled');
  }
  if (reserved>0) issues.push('outstanding_owed_morning_reservations');
  const refunds={pendingPaise:0,approvedUnconfirmedPaise:0,processedPaise:0,
    pendingCount:0,approvedCount:0,processedCount:0,failedCount:0};
  for(const req of refundRequests) {
    const amount=nonneg(req.requested_amount_paise||0);
    const approved=nonneg(req.approved_amount_paise||0);
    if (req.status==='pending'||req.status==='processing') {
      refunds.pendingPaise+=amount;refunds.pendingCount++;
    } else if(req.status==='approved') {
      refunds.approvedUnconfirmedPaise+=approved;refunds.approvedCount++;
      if (approved===0) issues.push('approved_refund_missing_amount');
    } else if(req.status==='processed') {
      refunds.processedPaise+=approved;refunds.processedCount++;
      if (approved===0) issues.push('processed_refund_missing_amount');
      if (!req.gateway_refund_id) issues.push('processed_refund_missing_gateway_receipt');
    } else if(req.status==='failed') refunds.failedCount++;
  }
  if ((refunds.pendingCount+refunds.approvedCount+refunds.processedCount)>0) {
    issues.push('refund_ledger_needs_independent_reconciliation');
    if (obligations.length>0) issues.push('refund_and_owed_obligation_overlap_unreconciled');
  }

  const deliveries={paidDelivered:0,prototypeDelivered:0,
    paidScheduled:0,prototypeScheduled:0,otherStatuses:0};
  for(const row of deliveryOrders){
    const n=nonneg(row.order_count),source=row.fulfillment_source;
    if(source==='paid_entitlement'&&row.status==='delivered') deliveries.paidDelivered+=n;
    else if(source==='owed_morning_prototype'&&row.status==='delivered') deliveries.prototypeDelivered+=n;
    else if(source==='paid_entitlement'&&row.status==='scheduled') deliveries.paidScheduled+=n;
    else if(source==='owed_morning_prototype'&&row.status==='scheduled') deliveries.prototypeScheduled+=n;
    else deliveries.otherStatuses+=n;
  }
  if (deliveries.prototypeDelivered>0) issues.push('test_only_delivery_present_not_physical_proof');
  // Missing ledger rows (not just low nonzero counts) are evidence gaps.
  if ((auditEntryCounts.delivery_fulfilled?.rows || 0)<deliveries.paidDelivered) {
    issues.push('delivery_vs_entitlement_ledger_count_mismatch');
  }

  const flags=unique(issues);
  return {
    subscriptionId:Number(subscription.id),
    source:'read_only_finance_reconciliation',
    gatewayMode,isRecurring,paidCycles:Number.isInteger(paidCycles)?paidCycles:null,
    months:Number.isInteger(months)?months:null,paidThroughDate:paidThroughDate||null,
    dailyRatePaise:dailyRate,
    billingAdjustments:adjustments,entitlementLedger:auditEntryCounts,
    datedCreditProvenance:{
      recordedRows:datedCreditProvenance.length,
      distinctDates:byDate.size,
      netCreditDaysEvidenced:evidencedCreditDays,
      netCreditPaiseEvidenced:evidencedCreditPaise,
      legacyOrMissingEvidence:missingDateEvidence,
      overlappingPositiveClaimDates:overlappingDates,
      captureEvidenceAttached:false
    },
    signedWebhookCaptureObservations:{
      recordedPayments:observedPaymentIds.size,
      observedCapturedAmountPaise:observedCapturedTotalPaise,
      observedPaidCycleNumbers:[...observedCycles.keys()].sort((a,b)=>a-b),
      evidenceOnlyNotSettlementProof:true
    },
    owedMorningObligations: {
      recordedCount:obligations.length,owedMornings:owed,
      fulfilledMornings:fulfilled,refundedMornings:refunded,
      activeReservedMornings:reserved,potentialUnsettledPaise:obligationValue,
      items:perObligation
    },
    refundRequests:refunds,deliveryOrders:deliveries,
    reviewFlags:flags,
    requiresManualFinanceReview:true,
    customerPayableCreditPaise:null,
    customerRefundableAmountPaise:null,
    mayAutoApplyCredits:false,mayAutoRefund:false,mayAutoGenerateDeliveries:false,
    note:'Undated skip/vacation credit adjustments and independent owed obligations cannot be automatically netted. Contract price is not evidence of captured revenue.'
  };
}

/**
 * Snapshot-only SQL: a single read-only, repeatable-read transaction prevents
 * mixed billing/refund data; no admin route, notifications, refunds, or edits.
 */
export async function previewRecurringFinanceReconciliation(pool,{subscriptionId}={}) {
  if (!Number.isSafeInteger(Number(subscriptionId)) || Number(subscriptionId)<=0) {
    return {success:false,reason:'invalid_subscription_id'};
  }
  const {client,release}=await acquireClient(pool);
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const subRows=await client.query(
      'SELECT * FROM customer_subscriptions WHERE id=$1',[subscriptionId]);
    if (!subRows.rows.length) {
      await client.query('COMMIT');
      return {success:false,reason:'subscription_not_found'};
    }
    const subscription=subRows.rows[0];
    const paidThroughDate=await getEffectivePaidThroughDate(client,subscription);
    const adjustmentRows=await client.query(
      'SELECT adjustment_type,COUNT(*)::int AS row_count,'+
      'COALESCE(SUM(days_count),0)::bigint AS days_count,'+
      'COALESCE(SUM(amount_paise),0)::bigint AS amount_paise '+
      'FROM subscription_billing_adjustments WHERE subscription_id=$1 GROUP BY adjustment_type',
      [subscriptionId]
    );
    const ledgerRows=await client.query(
      'SELECT entry_type,COUNT(*)::int AS row_count,'+
      'COALESCE(SUM(days_delta),0)::bigint AS days_delta,'+
      'COALESCE(SUM(amount_paise),0)::bigint AS amount_paise '+
      'FROM subscription_entitlement_ledger WHERE subscription_id=$1 GROUP BY entry_type',
      [subscriptionId]
    );
    const obligationRows=await client.query(
      'SELECT id,owed_mornings,fulfilled_mornings,refunded_mornings,'+
      'daily_rate_paise,status,payment_id,razorpay_subscription_id '+
      'FROM subscription_recurring_morning_obligations WHERE subscription_id=$1 ORDER BY id',
      [subscriptionId]
    );
    const reservationRows=await client.query(
      'SELECT obligation_id,status,COUNT(*)::int AS reservation_count '+
      'FROM subscription_recurring_morning_reservations WHERE subscription_id=$1 GROUP BY obligation_id,status',
      [subscriptionId]
    );
    const refundRows=await client.query(
      'SELECT status,requested_amount_paise,approved_amount_paise,gateway_refund_id '+
      'FROM refund_requests WHERE subscription_id=$1',
      [subscriptionId]
    );
    const deliveryRows=await client.query(
      'SELECT status,fulfillment_source,COUNT(*)::int AS order_count '+
      'FROM subscription_delivery_orders WHERE subscription_id=$1 GROUP BY status,fulfillment_source',
      [subscriptionId]
    );
    const provenanceRows=await client.query(
      "SELECT p.delivery_date::text AS delivery_date,p.days_delta,p.amount_paise,"+
      "p.evidence_state,a.adjustment_type FROM subscription_billing_credit_provenance p "+
      "JOIN subscription_billing_adjustments a ON a.id=p.billing_adjustment_id "+
      "WHERE p.subscription_id=$1 ORDER BY p.delivery_date,p.id",
      [subscriptionId]
    );
    const captureRows=await client.query(
      "SELECT gateway_payment_id,gateway_subscription_id,amount_paise,currency,"+
      "paid_count_at_event,proof_level FROM recurring_subscription_capture_observations "+
      "WHERE subscription_id=$1 ORDER BY paid_count_at_event,id",
      [subscriptionId]
    );
    const review=assessRecurringFinanceReconciliation({
      subscription,paidThroughDate,
      billingAdjustments:adjustmentRows.rows,entitlementLedger:ledgerRows.rows,
      obligations:obligationRows.rows,reservations:reservationRows.rows,
      refundRequests:refundRows.rows,deliveryOrders:deliveryRows.rows,
      datedCreditProvenance:provenanceRows.rows,
      captureObservations:captureRows.rows
    });
    await client.query('COMMIT');
    return {success:true,...review};
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    throw err;
  } finally{release();}
}

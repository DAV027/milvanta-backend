/**
 * Recurring initial-cycle owed mornings: opt-in FINANCE REVIEW accrual only.
 * No Razorpay writes, refunds, delivery entitlement or dispatch changes.
 */
import { getEarliestPermittedDeliveryDateYMD } from './deliveryCronPolicy.js';

function dateMs(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) throw Error('invalid_recurring_cycle_date');
  const [y,m,d] = str.split('-').map(Number);
  const ms = Date.UTC(y,m-1,d);
  const x = new Date(ms);
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== m-1 || x.getUTCDate() !== d) throw Error('invalid_recurring_cycle_date');
  return ms;
}

export function previewRecurringMorningObligation({
  firstCycleStart, firstCycleEnd, plannedEntitlementStart,
  plannedPaidThrough, purchasedMornings, verifiedAt=new Date(), dailyRatePaise
}) {
  if (!(verifiedAt instanceof Date) || Number.isNaN(verifiedAt.getTime())) throw Error('invalid_recurring_verified_time');
  const monthStart=dateMs(firstCycleStart),monthEnd=dateMs(firstCycleEnd),
        coverageStart=dateMs(plannedEntitlementStart),coverageEnd=dateMs(plannedPaidThrough);
  const a=new Date(monthStart),b=new Date(monthEnd);
  if (monthStart>monthEnd || a.getUTCFullYear()!==b.getUTCFullYear() || a.getUTCMonth()!==b.getUTCMonth() ||
      a.getUTCDate()!==1 || b.getUTCDate()!==new Date(Date.UTC(b.getUTCFullYear(),b.getUTCMonth()+1,0)).getUTCDate() ||
      coverageStart<monthStart || coverageStart>monthEnd || coverageEnd<coverageStart) {
    throw Error('invalid_recurring_first_cycle_bounds');
  }
  if (!Number.isSafeInteger(purchasedMornings) || purchasedMornings<1 || purchasedMornings>31) {
    throw Error('invalid_recurring_first_cycle_purchase_days');
  }
  if (!Number.isSafeInteger(dailyRatePaise) || dailyRatePaise<=0) throw Error('invalid_recurring_daily_rate');
  const firstEligibleDelivery=getEarliestPermittedDeliveryDateYMD(verifiedAt,plannedEntitlementStart);
  const firstEligibleMs=dateMs(firstEligibleDelivery);
  const deliverableWithinPaidThrough=Math.max(0,Math.floor((coverageEnd-firstEligibleMs)/86400000)+1);
  // Only the shortfall AFTER the already-paid entitlement period is owed.
  // An in-progress November plan can already cover some December mornings;
  // do not double-award those mornings as extra credit.
  const owedMornings=Math.max(0,purchasedMornings-deliverableWithinPaidThrough);
  return {firstCycleStart,firstCycleEnd,plannedEntitlementStart,plannedPaidThrough,
    firstEligibleDelivery,purchasedMornings,deliverableWithinPaidThrough,owedMornings,
    owedAmountPaise:owedMornings*dailyRatePaise,requiresReconciliation:owedMornings>0,
    financialStatus:'pending_finance_reconciliation'};
}
/**
 * Call only inside an already authenticated, captured-payment transaction.
 * Revalidates LIVE mode, exact first-cycle amount, subscription ID and capture.
 * Remains OFF without RECURRING_MORNING_OBLIGATIONS_ENABLED=true.
 */
export async function recordVerifiedRecurringInitialGap(client,{
  subscription,paidCount,capturedPayment,verifiedAt=new Date(),
  enabled=process.env.RECURRING_MORNING_OBLIGATIONS_ENABLED==='true'
}={}) {
  if (!enabled) return {recorded:false,reason:'feature_disabled'};
  const notes=subscription?.notes;
  if (!subscription || notes?.keyMode!=='live') return {recorded:false,reason:'gateway_mode_not_live'};
  if (!subscription.razorpay_subscription_id?.startsWith('sub_') ||
      !subscription.id || !subscription.customer_id) return {recorded:false,reason:'invalid_recurring_identity'};
  if (Number(paidCount)!==1) return {recorded:false,reason:'not_first_paid_cycle'};
  // Averaged multi-month Razorpay charges are not whole delivered-day units.
  // Defer their reconciliation until the full contract accounting is approved.
  if (Number(notes.months)!==1) return {recorded:false,reason:'multi_cycle_requires_reconciliation'};
  if (notes.fulfillmentEntitled===false || notes.authType==='mandate_only') return {recorded:false,reason:'mandate_only'};
  const firstCycleStart=notes.planFirstCycleStartYMD,firstCycleEnd=notes.planFirstCycleEndYMD;
  const plannedEntitlementStart=notes.planEntitlementStartYMD,plannedPaidThrough=notes.paidThroughDate;
  const purchasedMornings=Number(notes.days);
  if (!firstCycleStart || !firstCycleEnd || !plannedEntitlementStart || !plannedPaidThrough) {
    return {recorded:false,reason:'missing_checkout_or_paid_entitlement_snapshot'};
  }
  const expectedAmount=Number(notes.amountPerMonthPaise),rate=Number(subscription.cost_per_day_paise);
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount<=0 || !Number.isSafeInteger(rate) || rate<=0) {
    return {recorded:false,reason:'invalid_verified_price'};
  }
  if (!capturedPayment || capturedPayment.status!=='captured' ||
      typeof capturedPayment.id!=='string' || !capturedPayment.id.startsWith('pay_') ||
      capturedPayment.subscription_id!==subscription.razorpay_subscription_id ||
      capturedPayment.currency!=='INR' || Number(capturedPayment.amount)!==expectedAmount) {
    return {recorded:false,reason:'captured_payment_not_independently_verified'};
  }
  const plan=previewRecurringMorningObligation({
    firstCycleStart,firstCycleEnd,plannedEntitlementStart,plannedPaidThrough,
    purchasedMornings,verifiedAt,dailyRatePaise:rate
  });
  if (!plan.requiresReconciliation) return {recorded:false,reason:'no_initial_shortfall',plan};

  const created=await client.query(`INSERT INTO subscription_recurring_morning_obligations
 (subscription_id,customer_id,razorpay_subscription_id,payment_id,first_cycle_start,first_cycle_end,
  first_eligible_delivery,owed_mornings,daily_rate_paise)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
 ON CONFLICT (subscription_id,first_cycle_start,source) DO NOTHING
 RETURNING id,owed_mornings,payment_id`,
    [subscription.id,subscription.customer_id,subscription.razorpay_subscription_id,capturedPayment.id,
     firstCycleStart,firstCycleEnd,plan.firstEligibleDelivery,plan.owedMornings,rate]);
  if (created.rows.length) {
    const id=created.rows[0].id;
    await client.query(`INSERT INTO subscription_recurring_morning_obligation_events
 (obligation_id,event_key,event_type,days_delta,notes,evidence)
 VALUES ($1,$2,'accrued',$3,$4,$5::jsonb)
 ON CONFLICT (event_key) DO NOTHING`,
      [id,'first_cycle_unservable:'+subscription.id+':'+firstCycleStart,plan.owedMornings,
       'Verified live payment; initial gap pending finance review',
       JSON.stringify({source:'verified_live_payment',firstCycleStart,firstCycleEnd})]);
    return {recorded:true,obligationId:id,status:'pending_reconciliation',plan};
  }
  const existing=await client.query(`SELECT id,payment_id,owed_mornings FROM subscription_recurring_morning_obligations
 WHERE subscription_id=$1 AND first_cycle_start=$2 AND source='first_cycle_unservable'`,[subscription.id,firstCycleStart]);
  if (!existing.rows.length || existing.rows[0].payment_id!==capturedPayment.id) {
    throw Error('recurring_obligation_duplicate_cycle_payment_conflict');
  }
  return {recorded:false,reason:'already_recorded',obligationId:existing.rows[0].id,plan};
}

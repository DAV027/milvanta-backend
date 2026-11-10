/**
 * Opt-in, date-granular adjustment provenance, NOT a customer credit ledger.
 * No credit, refund, gateway or entitlement mutation. Writes only source
 * evidence inside the caller's existing SQL transaction, or nothing when OFF.
 */

function parseYMD(ymd) {
  if (typeof ymd!=='string'|| !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('invalid_credit_provenance_delivery_date');
  }
  const [year,month,day]=ymd.split('-').map(Number);
  const d=new Date(Date.UTC(year,month-1,day));
  if (d.getUTCFullYear()!==year || d.getUTCMonth()!==month-1 || d.getUTCDate()!==day) {
    throw new Error('invalid_credit_provenance_delivery_date');
  }
  return d;
}
function addDay(date, count) {
  const d=new Date(date.getTime());
  d.setUTCDate(d.getUTCDate()+count);
  return d.toISOString().slice(0,10);
}
function validId(value){return Number.isSafeInteger(Number(value))&&Number(value)>0;}

export function planBillingCreditProvenance({
  subscription,adjustmentId,sourceKind,sourceReference,startDate,
  daysCount,totalAmountPaise
}) {
  if (!subscription?.id || !subscription?.customer_id ||
      !validId(adjustmentId) ||
      !['skip','unskip','vacation','pause_resume'].includes(sourceKind) ||
      typeof sourceReference!=='string' || !/^[a-z_]+:[0-9]+$/.test(sourceReference) ||
      sourceReference.length>160) throw new Error('invalid_credit_provenance_source');
  if (!Number.isInteger(daysCount)||daysCount===0||Math.abs(daysCount)>366) {
    throw new Error('invalid_credit_provenance_days');
  }
  if (!Number.isSafeInteger(totalAmountPaise) ||
      Math.sign(totalAmountPaise)!==Math.sign(daysCount) ||
      totalAmountPaise===0 || totalAmountPaise%daysCount!==0) {
    throw new Error('invalid_credit_provenance_amount');
  }
  if ((sourceKind==='unskip')!==(daysCount<0)) {
    throw new Error('invalid_credit_provenance_direction');
  }
  const rate=Number(subscription.cost_per_day_paise);
  if (!Number.isSafeInteger(rate)||rate<=0 || totalAmountPaise!==rate*daysCount) {
    throw new Error('credit_provenance_rate_mismatch');
  }
  const date=parseYMD(startDate);
  return Array.from({length:Math.abs(daysCount)},(_,index)=>({
    deliveryDate:addDay(date,index),
    daysDelta:Math.sign(daysCount),
    amountPaise:rate*Math.sign(daysCount),
    // Even if notes contains a payment ID it has not been independently
    // linked to this adjustment/cycle. Do NOT call this a verified credit.
    evidenceState:'date_known_payment_unverified'
  }));
}

export async function recordBillingCreditProvenance(client,{
  subscription,adjustmentId,sourceKind,sourceReference,startDate,
  daysCount,totalAmountPaise,isRecurringAutopay=false,
  enabled=process.env.RECURRING_CREDIT_PROVENANCE_ENABLED==='true'
}={}) {
  if (!enabled) return {recorded:false,reason:'feature_disabled'};
  if (!isRecurringAutopay) {
    return {recorded:false,reason:'not_recurring_autopay'};
  }
  const days=planBillingCreditProvenance({
    subscription,adjustmentId,sourceKind,sourceReference,
    startDate,daysCount,totalAmountPaise
  });
  for(const day of days){
    const row=await client.query(
      "INSERT INTO subscription_billing_credit_provenance "+
      "(subscription_id,customer_id,billing_adjustment_id,source_kind,source_reference,"+
      "delivery_date,days_delta,amount_paise,evidence_state) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,'date_known_payment_unverified') "+
      "ON CONFLICT(billing_adjustment_id,delivery_date) DO NOTHING RETURNING id",
      [subscription.id,subscription.customer_id,adjustmentId,
       sourceKind,sourceReference,day.deliveryDate,day.daysDelta,day.amountPaise]
    );
    if (row.rowCount!==1) {
      // An idempotent caller should not attempt to apply the same adjustment
      // twice; fail/rollback instead of quietly concealing a double posting.
      throw new Error('duplicate_credit_provenance_adjustment_date');
    }
  }
  return {recorded:true,daysRecorded:days.length,verifiedCapture:false};
}

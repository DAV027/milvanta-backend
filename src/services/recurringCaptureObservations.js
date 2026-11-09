/**
 * Opt-in append-only observation of an explicitly captured Razorpay payment
 * entity within an already signature-verified webhook transaction.
 * Does not charge, refund, extend entitlement or infer gateway settlement.
 * Only raw captured payment entities; paid invoices and fetched payment lists
 * are intentionally excluded until separately verified.
 */
export async function recordSignedRecurringCaptureObservation(client,{
  subscription,rawPaymentEntity,eventId,paidCount,
  enabled=process.env.RECURRING_CAPTURE_OBSERVATIONS_ENABLED==='true'
}={}) {
  if (!enabled) return {recorded:false,reason:'feature_disabled'};
  const notes=subscription?.notes;
  if (!subscription?.id || !subscription?.customer_id ||
      notes?.keyMode!=='live' || !subscription.razorpay_subscription_id?.startsWith('sub_')) {
    return {recorded:false,reason:'live_subscription_identity_not_verified'};
  }
  if (!rawPaymentEntity || rawPaymentEntity.status!=='captured' ||
      !rawPaymentEntity.id?.startsWith('pay_') ||
      rawPaymentEntity.subscription_id!==subscription.razorpay_subscription_id ||
      rawPaymentEntity.currency!=='INR' ||
      !Number.isSafeInteger(rawPaymentEntity.amount) ||
      rawPaymentEntity.amount<=0) {
    return {recorded:false,reason:'raw_captured_payment_entity_missing_or_invalid'};
  }
  if (typeof eventId!=='string' || !/^[A-Za-z0-9_-]{4,160}$/.test(eventId) ||
      !Number.isSafeInteger(paidCount)||paidCount<1) {
    return {recorded:false,reason:'invalid_verified_webhook_or_cycle'};
  }
  const created=rawPaymentEntity.created_at;
  if (created!=null && (!Number.isSafeInteger(created)||created<=0)) {
    return {recorded:false,reason:'invalid_payment_created_at'};
  }
  const args=[
    subscription.id,subscription.customer_id,subscription.razorpay_subscription_id,
    rawPaymentEntity.id,eventId,rawPaymentEntity.amount,paidCount,created??null
  ];
  const r=await client.query(
    "INSERT INTO recurring_subscription_capture_observations "+
    "(subscription_id,customer_id,gateway_subscription_id,gateway_payment_id,"+
    "source_webhook_event_id,amount_paise,paid_count_at_event,gateway_created_at) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8::bigint) END) "+
    "ON CONFLICT (gateway_payment_id) DO NOTHING RETURNING id",
    args
  );
  if (r.rowCount===1) {
    return {recorded:true,observationId:r.rows[0].id,proofLevel:'signed_webhook_payment_entity'};
  }
  const previous=await client.query(
    "SELECT subscription_id,customer_id,gateway_subscription_id,amount_paise,"+
    "paid_count_at_event FROM recurring_subscription_capture_observations WHERE gateway_payment_id=$1",
    [rawPaymentEntity.id]
  );
  const p=previous.rows[0];
  if (!p || Number(p.subscription_id)!==Number(subscription.id) ||
      Number(p.customer_id)!==Number(subscription.customer_id) ||
      p.gateway_subscription_id!==subscription.razorpay_subscription_id ||
      Number(p.amount_paise)!==rawPaymentEntity.amount ||
      Number(p.paid_count_at_event)!==paidCount) {
    throw Error('recurring_capture_observation_payment_conflict');
  }
  return {recorded:false,reason:'already_observed',proofLevel:'signed_webhook_payment_entity'};
}

// Meta WhatsApp is the sole phone-messaging transport. Historical event keys remain stable.
import * as whatsapp from './whatsappService.js';
import * as otp from './whatsappOtpService.js';
import { getEffectivePaidThroughDate, getNowInIST, formatDateYMD, addDaysToYMD } from './subscriptionService.js';
export { normalizeIndianPhoneNumber } from './whatsappService.js';
export const queueNotification = whatsapp.queueWhatsAppNotification;
export const processNotificationOutbox = whatsapp.processWhatsAppOutbox;

export async function sendPhoneOtp(args,options) {
  try { return await otp.sendPhoneOtp(args,options); }
  catch(error) {
    return {success:false,error:error instanceof whatsapp.WhatsAppError?error.code:'otp_service_error',statusCode:error.statusCode || 503,message:'WhatsApp verification is unavailable. Please try again later.'};
  }
}
export async function verifyPhoneOtp(args,options) {
  try { return await otp.verifyPhoneOtp(args,options); }
  catch(error) {
    return {verified:false,error:error instanceof whatsapp.WhatsAppError?error.code:'otp_service_error',statusCode:error.statusCode || 503,message:'Unable to verify this WhatsApp code.'};
  }
}

// Consume only server-recorded captured-payment entitlement. An active status or
// payment reference alone is not proof of paid fulfillment. Accounting stays in
// the authoritative subscription service (including prepaid carry-forward days).
async function paidNotificationThroughDate(pool, subscription, today) {
  const notes = subscription?.notes;
  const hasCapturedPayment = [notes?.lastPaymentId, notes?.paymentId]
    .some(reference => typeof reference === 'string' && reference.trim().length > 0);
  if (!subscription || subscription.status !== 'active' || notes?.fulfillmentEntitled !== true ||
      notes.authType === 'mandate_only' || !hasCapturedPayment) return null;

  let paidThrough;
  try {
    paidThrough = await getEffectivePaidThroughDate(pool, subscription);
  } catch (error) {
    // Malformed legacy dates are ineligible; database failures must still surface.
    if (error instanceof RangeError) return null;
    throw error;
  }
  if (!paidThrough || addDaysToYMD(paidThrough, 0) !== paidThrough || paidThrough < today) return null;
  return paidThrough;
}

// Called after existing payment evidence validation. No billing decisions here.
export async function queuePaidSubscriptionActivation(pool,subscriptionId) {
  const {rows}=await pool.query(`SELECT s.*,c.phone FROM customer_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 AND s.status='active'`,[subscriptionId]);
  const s=rows[0],n=s?.notes;
  const today = formatDateYMD(getNowInIST());
  if (!s?.phone || !(await paidNotificationThroughDate(pool, s, today))) return {queued:false};
  return queueNotification(pool,{customerId:s.customer_id,phone:s.phone,templateKey:'SUBSCRIPTION_ACTIVATED',params:{productName:s.product_name,quantity:s.quantity,startDate:n.startDate},idempotencyKey:`sms_sub_activated_${s.id}`});
}

export async function queueBillingReminders(pool) {
  // Use the same effective entitlement as fulfillment, not the unextended raw note.
  const today = formatDateYMD(getNowInIST());
  const reminderDate = addDaysToYMD(today, 3);
  const {rows}=await pool.query(`SELECT s.*,c.phone FROM customer_subscriptions s JOIN customers c ON c.id=s.customer_id
    WHERE s.status='active' AND s.notes->'fulfillmentEntitled'='true'::jsonb`);
  let queued=0;
  for (const s of rows) {
    const paidThrough = await paidNotificationThroughDate(pool, s, today);
    if (!s.phone || paidThrough !== reminderDate) continue;
    const result=await queueNotification(pool,{customerId:s.customer_id,phone:s.phone,templateKey:'BILLING_REMINDER',params:{productName:s.product_name,dueDate:paidThrough},idempotencyKey:`billing_reminder_${s.id}_${paidThrough}`});
    if(result.queued) queued++;
  }
  return {queued};
}

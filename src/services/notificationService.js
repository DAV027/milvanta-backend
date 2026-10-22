// Meta WhatsApp is the sole phone-messaging transport. Historical event keys remain stable.
import * as whatsapp from './whatsappService.js';
import * as otp from './whatsappOtpService.js';
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

// Called after existing payment evidence validation. No billing decisions here.
export async function queuePaidSubscriptionActivation(pool,subscriptionId) {
  const {rows}=await pool.query(`SELECT s.*,c.phone FROM customer_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 AND s.status='active'`,[subscriptionId]);
  const s=rows[0],n=s?.notes;
  if (!s || !s.phone || !(n?.lastPaymentId || n?.paymentId) || n.fulfillmentEntitled===false || n.authType==='mandate_only') return {queued:false};
  return queueNotification(pool,{customerId:s.customer_id,phone:s.phone,templateKey:'SUBSCRIPTION_ACTIVATED',params:{productName:s.product_name,quantity:s.quantity,startDate:n.startDate},idempotencyKey:`sms_sub_activated_${s.id}`});
}

export async function queueBillingReminders(pool) {
  // Renewal reminders use existing authenticated entitlement notes; no changes to payment state.
  const {rows}=await pool.query(`SELECT s.*,c.phone FROM customer_subscriptions s JOIN customers c ON c.id=s.customer_id
    WHERE s.status='active' AND s.notes->>'paidThroughDate'=to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date+3,'YYYY-MM-DD')
      AND (s.notes->>'lastPaymentId' IS NOT NULL OR s.notes->>'paymentId' IS NOT NULL)
      AND COALESCE(s.notes->>'fulfillmentEntitled','true')<>'false' AND COALESCE(s.notes->>'authType','')<>'mandate_only'`);
  let queued=0;
  for (const s of rows) {
    const result=await queueNotification(pool,{customerId:s.customer_id,phone:s.phone,templateKey:'BILLING_REMINDER',params:{productName:s.product_name,dueDate:s.notes.paidThroughDate},idempotencyKey:`billing_reminder_${s.id}_${s.notes.paidThroughDate}`});
    if(result.queued) queued++;
  }
  return {queued};
}

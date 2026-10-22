import crypto from 'node:crypto';
import { acquireClient } from './subscriptionService.js';
import { normalizeIndianPhoneNumber, sendWhatsAppOtp, WhatsAppError } from './whatsappService.js';

function hashCode(code, salt, secret) {
  return crypto.createHmac('sha256',secret).update(`${salt}:${code}`).digest('hex');
}
function validateContext({ phone,customerId,sessionHash,pool }, env) {
  if (!pool) throw new WhatsAppError('database_not_configured');
  if (!customerId || !/^[a-f0-9]{64}$/.test(sessionHash || '')) throw new WhatsAppError('authentication_required',{ statusCode:401 });
  const normalized = normalizeIndianPhoneNumber(phone);
  if (!normalized) throw new WhatsAppError('invalid_phone_number',{ statusCode:400 });
  if ((env.WHATSAPP_OTP_HASH_SECRET || '').length < 32) throw new WhatsAppError('otp_not_configured');
  return normalized;
}

export async function sendPhoneOtp(context, options = {}) {
  const env = options.env || process.env;
  const phone = validateContext(context,env);
  const { client,release } = await acquireClient(context.pool);
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(32).toString('hex');
  const code = String(crypto.randomInt(0,1000000)).padStart(6,'0');
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`otp:${phone}`]);
    const { rows: customer } = await client.query('SELECT phone FROM customers WHERE id=$1 FOR UPDATE',[context.customerId]);
    if (normalizeIndianPhoneNumber(customer[0]?.phone) !== phone) throw new WhatsAppError('account_phone_mismatch',{statusCode:403});
    const { rows } = await client.query(`SELECT id FROM whatsapp_otp_challenges WHERE phone=$1 AND created_at>NOW()-INTERVAL '60 seconds' LIMIT 1`,[phone]);
    if (rows.length) throw new WhatsAppError('cooldown_active',{statusCode:429});
    await client.query(`UPDATE whatsapp_otp_challenges SET status='superseded' WHERE phone=$1 AND status IN ('pending','sending')`,[phone]);
    await client.query(`INSERT INTO whatsapp_otp_challenges(id,customer_id,session_hash,phone,otp_hash,salt,status,expires_at,ip_address)
      VALUES($1,$2,$3,$4,$5,$6,'sending',NOW()+INTERVAL '5 minutes',$7)`,[id,context.customerId,context.sessionHash,phone,hashCode(code,salt,env.WHATSAPP_OTP_HASH_SECRET),salt,context.ip || null]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { release(); }
  try {
    await sendWhatsAppOtp({ phone,code,...options });
    const result = await context.pool.query(`UPDATE whatsapp_otp_challenges SET status='pending' WHERE id=$1 AND status='sending' RETURNING id`,[id]);
    if (!result.rowCount) throw new WhatsAppError('otp_superseded');
    return { success:true,status:'pending',phone,cooldownSeconds:60,message:'Verification code accepted by WhatsApp. Check WhatsApp for delivery.' };
  } catch (error) {
    await context.pool.query(`UPDATE whatsapp_otp_challenges SET status='failed' WHERE id=$1 AND status='sending'`,[id]);
    throw error;
  }
}

export async function verifyPhoneOtp(context, options = {}) {
  const env = options.env || process.env;
  const phone = validateContext(context,env);
  const { client,release } = await acquireClient(context.pool);
  try {
    await client.query('BEGIN');
    // Same lock order as send: phone, customer, challenge.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`otp:${phone}`]);
    const { rows: customer } = await client.query('SELECT phone FROM customers WHERE id=$1 FOR UPDATE',[context.customerId]);
    if (normalizeIndianPhoneNumber(customer[0]?.phone) !== phone) throw new WhatsAppError('account_phone_mismatch',{statusCode:403});
    const { rows } = await client.query(`SELECT *,expires_at>NOW() AS unexpired FROM whatsapp_otp_challenges
      WHERE customer_id=$1 AND session_hash=$2 AND phone=$3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[context.customerId,context.sessionHash,phone]);
    const challenge = rows[0];
    let error;
    if (!challenge || challenge.status !== 'pending' || !challenge.unexpired) error='otp_expired_or_not_found';
    else if (challenge.attempts >= 5) error='max_attempts_exceeded';
    else {
      await client.query('UPDATE whatsapp_otp_challenges SET attempts=attempts+1 WHERE id=$1',[challenge.id]);
      const candidate = hashCode(String(context.code || ''),challenge.salt,env.WHATSAPP_OTP_HASH_SECRET);
      if (!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(challenge.otp_hash,'hex')) || !/^\d{6}$/.test(context.code || '')) error='incorrect_otp';
      else {
        await client.query(`UPDATE whatsapp_otp_challenges SET status='verified',verified_at=NOW() WHERE id=$1`,[challenge.id]);
        await client.query('UPDATE customers SET phone_verified_at=NOW() WHERE id=$1',[context.customerId]);
      }
    }
    await client.query('COMMIT');
    return error ? { verified:false,error,statusCode:error==='max_attempts_exceeded'?429:400,message:'Invalid or expired code. Please request a new code if needed.' } : { verified:true,phone,status:'approved' };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { release(); }
}

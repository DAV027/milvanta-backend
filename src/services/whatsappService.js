import crypto from 'node:crypto';
import { acquireClient } from './subscriptionService.js';
import { getEffectivePaidThroughDate } from './subscriptionService.js';
import { resolveWhatsAppTemplate, isApprovedTemplate } from './whatsappTemplates.js';

export function normalizeIndianPhoneNumber(input) {
  if (typeof input !== 'string' || !/^[+\d\s()-]+$/.test(input.trim())) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export class WhatsAppError extends Error {
  constructor(code, { retryable = false, uncertain = false, retryAfterMs = 0, statusCode = 503 } = {}) {
    super(code);
    Object.assign(this, { code, retryable, uncertain, retryAfterMs, statusCode });
  }
}

export async function sendWhatsAppTemplate({ phone, templateName, values, language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en', authentication = false, outboxId, env = process.env, fetchImpl, retries = 2, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (env.WHATSAPP_ENABLED !== 'true') throw new WhatsAppError('whatsapp_disabled');
  if (!/^v\d+\.0$/.test(env.WHATSAPP_GRAPH_API_VERSION || '') || !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || '') || !env.WHATSAPP_ACCESS_TOKEN) throw new WhatsAppError('whatsapp_not_configured');
  if (!/^[a-z0-9_]+$/.test(templateName || '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) throw new WhatsAppError('invalid_template');
  if (!isApprovedTemplate(templateName, language, env)) throw new WhatsAppError('template_not_approved');
  const recipient = normalizeIndianPhoneNumber(phone);
  if (!recipient) throw new WhatsAppError('invalid_phone_number', { statusCode: 400 });
  // Tests must explicitly inject a fake fetch. Never infer mock success from NODE_ENV.
  if (process.env.NODE_ENV === 'test' && !fetchImpl) throw new WhatsAppError('test_transport_required');
  const transport = fetchImpl || globalThis.fetch;
  const parameters = values.map(text => ({ type: 'text', text: String(text) }));
  const components = [{ type: 'body', parameters }];
  if (authentication) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [parameters[0]] });
  const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient.slice(1), type: 'template', template: { name: templateName, language: { code: language }, components } };
  if (outboxId) body.biz_opaque_callback_data = `mv:${outboxId}`;
  const maxRetries = Math.min(2, Math.max(0, Number(retries) || 0));
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response, data;
    try {
      response = await transport(`https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      data = await response.json();
    } catch {
      throw new WhatsAppError('send_outcome_unknown', { uncertain: true });
    } finally { clearTimeout(timeout); }
    if (response.ok) {
      if (!data.messages?.[0]?.id || typeof data.messages[0].id !== 'string') throw new WhatsAppError('ambiguous_provider_response', { uncertain: true });
      return { accepted: true, messageId: data.messages[0].id, status: 'accepted' };
    }
    const code = Number(data.error?.code) || response.status;
    // Explicit rejections may retry. 5xx outcomes can be ambiguous and need reconciliation.
    const retryable = response.status === 429 || [4, 17, 32, 613, 130429, 131048, 131056].includes(code);
    const retryHeader = response.headers.get('retry-after');
    const retryAfterMs = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now())) : 0;
    const delay = Math.max(Number.isFinite(retryAfterMs) ? retryAfterMs : 0, 1000 * 2 ** attempt);
    if (retryable && attempt < maxRetries && delay <= 30000) { await sleep(delay); continue; }
    throw new WhatsAppError(`meta_${code}`, { retryable, uncertain: response.status >= 500, retryAfterMs: delay, statusCode: 503 });
  }
}

export async function sendWhatsAppOtp({ phone, code, ...options }) {
  const template = resolveWhatsAppTemplate('AUTH_OTP', { code }, options.env || process.env);
  return sendWhatsAppTemplate({ ...options, phone, templateName: template.name, values: template.values, authentication: true });
}

export function verifyWhatsAppWebhookSignature({ rawBody, signature, appSecret = process.env.WHATSAPP_APP_SECRET }) {
  if (!appSecret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export async function getWhatsAppPreferences(pool, customerId) {
  const { rows } = await pool.query('SELECT * FROM whatsapp_notification_preferences WHERE customer_id=$1', [customerId]);
  return rows[0] || { consent: false, categories: ['orders','subscriptions','deliveries','billing'], language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' };
}

export async function setWhatsAppPreferences(pool, customer, { enabled, categories = ['orders','subscriptions','deliveries','billing'], language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' }) {
  if (typeof enabled !== 'boolean' || !Array.isArray(categories) || !categories.every(x => ['orders','subscriptions','deliveries','billing'].includes(x)) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) throw new WhatsAppError('invalid_preferences', { statusCode: 400 });
  const phone = normalizeIndianPhoneNumber(customer.phone);
  if (!phone || (enabled && !customer.phone_verified_at)) throw new WhatsAppError('verified_phone_required', { statusCode: 409 });
  await pool.query(`INSERT INTO whatsapp_notification_preferences(customer_id,phone,consent,consent_at,consent_source,opted_out_at,categories,language)
    VALUES($1,$2,$3,CASE WHEN $3 THEN NOW() END,'profile_explicit',CASE WHEN NOT $3 THEN NOW() END,$4::jsonb,$5)
    ON CONFLICT(customer_id) DO UPDATE SET phone=EXCLUDED.phone,consent=EXCLUDED.consent,
      consent_at=CASE WHEN EXCLUDED.consent THEN NOW() ELSE whatsapp_notification_preferences.consent_at END,
      consent_source='profile_explicit',opted_out_at=CASE WHEN NOT EXCLUDED.consent THEN NOW() END,
      categories=EXCLUDED.categories,language=EXCLUDED.language,updated_at=NOW()`, [customer.id,phone,enabled,JSON.stringify(categories),language]);
  return getWhatsAppPreferences(pool,customer.id);
}

async function hasConsent(pool, msg) {
  const { rows } = await pool.query(`SELECT p.* FROM whatsapp_notification_preferences p JOIN customers c ON c.id=p.customer_id
    WHERE p.customer_id=$1 AND p.phone=$2 AND p.consent=TRUE AND p.opted_out_at IS NULL
      AND c.phone_verified_at IS NOT NULL AND regexp_replace(c.phone,'[^0-9]','','g') IN ($3,$4)
      AND p.categories ? $5`, [msg.customer_id,msg.phone,msg.phone.slice(1),msg.phone.slice(3),msg.notification_category]);
  return rows[0] || null;
}

export async function queueWhatsAppNotification(pool, { customerId, phone, templateKey, params = {}, idempotencyKey, scheduledAt, deliveryOrderId }) {
  if (!pool) return { queued: false, error: 'database_not_available' };
  const normalized = normalizeIndianPhoneNumber(phone);
  if (!normalized || !customerId || !idempotencyKey) return { queued: false, error: 'invalid_notification' };
  const template = resolveWhatsAppTemplate(templateKey, params);
  const consent = await hasConsent(pool, { customer_id: customerId, phone: normalized, notification_category: template.category });
  if (!consent) return { queued: false, skipped: true, reason: 'whatsapp_consent_required' };
  if (!isApprovedTemplate(template.name, consent.language)) return { queued: false, error: 'template_not_approved' };
  const { rows } = await pool.query(`INSERT INTO notification_outbox(customer_id,phone,channel,template_name,message_body,idempotency_key,template_parameters,template_language,notification_category,scheduled_at,delivery_order_id)
    VALUES($1,$2,'whatsapp',$3,'',$4,$5::jsonb,$6,$7,COALESCE($8,NOW()),$9) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
  [customerId,normalized,template.name,idempotencyKey,JSON.stringify({ values: template.values }),consent.language,template.category,scheduledAt || null,deliveryOrderId || null]);
  return rows.length ? { queued: true, outboxId: rows[0].id } : { queued: false, duplicate: true };
}

async function deliveryEligible(pool, msg) {
  const deliveryTemplates = ['NEXT_DAY_REMINDER','OUT_FOR_DELIVERY','DELIVERY_COMPLETED','DELIVERY_FAILED'];
  const event = deliveryTemplates.find(key => msg.template_name === (process.env[`WHATSAPP_TEMPLATE_${key}`] || `milvanta_${key.toLowerCase()}`));
  if (!msg.delivery_order_id) return !event;
  const current = (await pool.query('SELECT status FROM subscription_delivery_orders WHERE id=$1', [msg.delivery_order_id])).rows[0];
  const expected = {OUT_FOR_DELIVERY:'out_for_delivery',DELIVERY_COMPLETED:'delivered',DELIVERY_FAILED:'failed'}[event];
  if (expected && current?.status !== expected) return false;
  // Completed/failed messages describe an actual past outcome, regardless of later subscription state.
  if (['DELIVERY_COMPLETED','DELIVERY_FAILED'].includes(event)) return true;
  const { rows } = await pool.query(`SELECT d.*,d.delivery_date::text AS target_delivery_date,s.status AS subscription_status,s.notes,s.cost_per_day_paise,s.total_amount_paise,s.created_at AS subscription_created_at
    FROM subscription_delivery_orders d JOIN customer_subscriptions s ON s.id=d.subscription_id WHERE d.id=$1
    AND NOT EXISTS(SELECT 1 FROM subscription_skipped_dates k WHERE k.subscription_id=s.id AND k.skip_date=d.delivery_date)
    AND NOT EXISTS(SELECT 1 FROM subscription_delivery_pauses p WHERE p.subscription_id=s.id AND p.resumed_at IS NULL AND p.pause_start_date<=d.delivery_date AND (p.pause_end_date IS NULL OR p.pause_end_date>=d.delivery_date))`, [msg.delivery_order_id]);
  const d = rows[0];
  if (!d || d.subscription_status !== 'active' || !(event==='OUT_FOR_DELIVERY' ? d.status==='out_for_delivery' : ['scheduled','packed'].includes(d.status))) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const date = d.target_delivery_date;
  if ((event==='NEXT_DAY_REMINDER' ? date<=today : date!==today) || !(d.notes?.lastPaymentId || d.notes?.paymentId) || d.notes?.fulfillmentEntitled === false || d.notes?.authType === 'mandate_only') return false;
  const paidThrough = await getEffectivePaidThroughDate(pool, { ...d, id: d.subscription_id, created_at: d.subscription_created_at });
  return Boolean(paidThrough && date <= paidThrough);
}

export async function processWhatsAppOutbox(pool, limit = 20, options = {}) {
  if (!pool || process.env.WHATSAPP_ENABLED !== 'true') return { processed: 0 };
  // Never automatically replay interrupted HTTP sends: Meta provides no send idempotency key.
  await pool.query(`UPDATE notification_outbox SET status='uncertain',provider_status='reconciliation_required',updated_at=NOW()
    WHERE channel='whatsapp' AND status='processing' AND claimed_at<NOW()-INTERVAL '5 minutes'`);
  const token = crypto.randomUUID();
  const { rows } = await pool.query(`WITH ready AS (
    SELECT id FROM notification_outbox WHERE channel='whatsapp' AND status='pending' AND attempts<5 AND scheduled_at<=NOW() AND next_attempt_at<=NOW()
    ORDER BY scheduled_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
    UPDATE notification_outbox n SET status='processing',attempts=attempts+1,claimed_at=NOW(),claim_token=$2,updated_at=NOW()
    FROM ready WHERE n.id=ready.id RETURNING n.*`, [Math.max(1,Math.min(100,Number(limit)||20)),token]);
  let processed = 0;
  for (const msg of rows) {
    try {
      const active = await pool.query(`UPDATE notification_outbox SET claimed_at=NOW() WHERE id=$1 AND claim_token=$2 AND status='processing' RETURNING id`, [msg.id,token]);
      if (!active.rowCount) continue;
      const consent = await hasConsent(pool,msg);
      if (!consent || consent.language !== msg.template_language || !(await deliveryEligible(pool,msg))) {
        await pool.query(`UPDATE notification_outbox SET status='cancelled',error_message='consent_or_delivery_ineligible',updated_at=NOW() WHERE id=$1 AND claim_token=$2 AND status='processing'`, [msg.id,token]);
        continue;
      }
      const result = await sendWhatsAppTemplate({ phone: msg.phone,templateName:msg.template_name,values:msg.template_parameters.values,language:msg.template_language,outboxId:msg.id,retries:0,...options });
      await pool.query(`UPDATE notification_outbox SET meta_message_id=COALESCE(meta_message_id,$3),
        status=CASE WHEN status IN ('processing','uncertain') THEN 'accepted' ELSE status END,
        provider_status=CASE WHEN status IN ('processing','uncertain') THEN 'accepted' ELSE provider_status END,updated_at=NOW()
        WHERE id=$1 AND claim_token=$2`, [msg.id,token,result.messageId]);
      processed++;
    } catch (error) {
      const status = error.uncertain || !(error instanceof WhatsAppError) ? 'uncertain' : error.retryable && msg.attempts < 5 ? 'pending' : 'failed';
      const delay = Math.max(error.retryAfterMs || 0, Math.min(3600000,30000 * 2 ** (msg.attempts-1)));
      const code = error instanceof WhatsAppError ? error.code : 'worker_error';
      await pool.query(`UPDATE notification_outbox SET status=$3,error_message=$4,failure_details=jsonb_build_object('code',$4::text),
        next_attempt_at=NOW()+($5::double precision*INTERVAL '1 millisecond'),updated_at=NOW() WHERE id=$1 AND claim_token=$2 AND status='processing'`, [msg.id,token,status,code,delay]);
    }
  }
  return { processed };
}

export async function handleWhatsAppWebhook(pool, payload, env = process.env) {
  if (!pool || !env.WHATSAPP_WABA_ID || !env.WHATSAPP_PHONE_NUMBER_ID) throw new WhatsAppError('webhook_not_configured');
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return { processed: 0 };
  const { client,release } = await acquireClient(pool);
  let processed = 0;
  try {
    await client.query('BEGIN');
    for (const entry of payload.entry) {
      if (String(entry.id) !== env.WHATSAPP_WABA_ID) continue;
      for (const change of entry.changes || []) {
        const value = change.value;
        if (change.field !== 'messages' || String(value?.metadata?.phone_number_id) !== env.WHATSAPP_PHONE_NUMBER_ID) continue;
        for (const event of [...(value.statuses || []),...(value.messages || [])]) {
          const type = event.status || 'incoming';
          if (!event.id || !/^\d+$/.test(String(event.timestamp)) || !['accepted','sent','delivered','read','failed','incoming'].includes(type)) continue;
          const eventAt = new Date(Number(event.timestamp)*1000);
          if (!Number.isFinite(eventAt.getTime())) continue;
          const opaque = /^mv:([1-9]\d{0,17})$/.exec(event.biz_opaque_callback_data || '');
          const key = crypto.createHash('sha256').update(`${event.id}|${type}|${event.timestamp}`).digest('hex');
          const saved = await client.query(`INSERT INTO whatsapp_webhook_events(event_key,message_id,event_type,event_at,outbox_id,error_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING event_key`, [key,event.id,type,eventAt,opaque?.[1] || null,event.errors?.[0]?.code ? String(event.errors[0].code) : null]);
          if (!saved.rowCount) continue;
          processed++;
          if (type === 'incoming') {
            const phone = normalizeIndianPhoneNumber(event.from);
            if (phone && ['STOP','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(String(event.text?.body || '').trim().toUpperCase())) {
              await client.query(`UPDATE whatsapp_notification_preferences SET consent=FALSE,opted_out_at=$2,updated_at=NOW() WHERE phone=$1 AND (consent_at IS NULL OR consent_at<=$2)`, [phone,eventAt]);
            }
          } else {
            const rank = { accepted:1,sent:2,failed:3,delivered:4,read:5 }[type];
            await client.query(`UPDATE notification_outbox SET status=$2,provider_status=$2,meta_message_id=COALESCE(meta_message_id,$1),
              sent_at=CASE WHEN $2 IN ('sent','delivered','read') THEN COALESCE(sent_at,$3) ELSE sent_at END,
              delivered_at=CASE WHEN $2 IN ('delivered','read') THEN COALESCE(delivered_at,$3) ELSE delivered_at END,
              read_at=CASE WHEN $2='read' THEN COALESCE(read_at,$3) ELSE read_at END,
              failure_details=CASE WHEN $2='failed' THEN jsonb_build_object('code',$6::text) ELSE failure_details END,updated_at=NOW()
              WHERE channel='whatsapp' AND (meta_message_id=$1 OR (id=$4 AND status IN ('processing','uncertain') AND meta_message_id IS NULL))
              AND COALESCE(CASE status WHEN 'accepted' THEN 1 WHEN 'sent' THEN 2 WHEN 'failed' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 ELSE 0 END,0)<$5`, [event.id,type,eventAt,opaque?.[1] || null,rank,event.errors?.[0]?.code ? String(event.errors[0].code) : null]);
          }
        }
      }
    }
    await client.query('COMMIT');
    return { processed };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { release(); }
}

// Read-only operational summary. Never return tokens, IDs, webhook secrets,
// phone numbers, OTP hashes, message content, or provider payloads.
import { WHATSAPP_TEMPLATES } from './whatsappTemplates.js';

const validId = value => /^\d+$/.test(String(value || ''));
const configured = value => typeof value === 'string' && value.trim().length > 0;
const statuses = ['pending', 'processing', 'accepted', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'uncertain'];

export function getWhatsAppReadiness(env = process.env) {
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
  const pairs = new Set(String(env.WHATSAPP_APPROVED_TEMPLATES || '')
    .split(',').map(pair => pair.trim()).filter(Boolean));
  // An allowlist is an operator assertion, not verification against Meta.
  const names = Object.entries(WHATSAPP_TEMPLATES).map(([key, template]) => ({
    key, name: env['WHATSAPP_TEMPLATE_' + key] || template.name
  }));
  const auth = names.find(row => row.key === 'AUTH_OTP');
  const fields = {
    accessToken: configured(env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: validId(env.WHATSAPP_PHONE_NUMBER_ID),
    wabaId: validId(env.WHATSAPP_WABA_ID),
    appSecret: configured(env.WHATSAPP_APP_SECRET),
    verifyToken: configured(env.WHATSAPP_VERIFY_TOKEN),
    otpHashSecret: typeof env.WHATSAPP_OTP_HASH_SECRET === 'string' &&
      env.WHATSAPP_OTP_HASH_SECRET.length >= 32
  };
  const templateCount = names.filter(row => pairs.has(row.name + ':' + language)).length;
  const authAllowlisted = pairs.has(auth.name + ':' + language);
  const localConfigurationComplete = Object.values(fields).every(Boolean) &&
    /^v\d+\.0$/.test(env.WHATSAPP_GRAPH_API_VERSION || '') && authAllowlisted;

  return {
    channel: 'whatsapp',
    readOnly: true,
    enabled: env.WHATSAPP_ENABLED === 'true',
    graphApiVersion: /^v\d+\.0$/.test(env.WHATSAPP_GRAPH_API_VERSION || '')
      ? env.WHATSAPP_GRAPH_API_VERSION : 'not_configured',
    locale: language,
    checks: fields,
    templates: {
      locallyAllowlisted: templateCount,
      totalExpected: names.length,
      authenticationLocallyAllowlisted: authAllowlisted
    },
    localConfigurationComplete,
    metaPhoneRegistered: 'not_checked',
    metaTemplateApproval: 'not_checked',
    liveDeliveryVerified: 'not_checked',
    guidance: 'Presence and allowlist checks are local only. Verify Meta registration, template approval, opt-in and signed delivery before enabling.'
  };
}

export async function getWhatsAppOutboxSummary(pool) {
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  if (!pool) return { available: false, reason: 'database_not_configured', counts };
  const exists = await pool.query(
    "SELECT to_regclass('public.notification_outbox') IS NOT NULL AS present"
  );
  if (!exists.rows[0]?.present) return { available: false, reason: 'outbox_migration_missing', counts };
  const { rows } = await pool.query(
    "SELECT status, COUNT(*)::int AS count FROM notification_outbox WHERE channel = 'whatsapp' GROUP BY status"
  );
  for (const row of rows) {
    if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.count) || 0;
  }
  return { available: true, counts };
}

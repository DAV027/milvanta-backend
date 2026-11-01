// Proposed schemas only. Deployment requires matching Meta-approved names AND locales.
const utility = (name, category, fields) => ({ name: `milvanta_${name}`, metaCategory: 'UTILITY', category, fields });
export const WHATSAPP_TEMPLATES = Object.freeze({
  AUTH_OTP: { name: 'milvanta_auth_otp', metaCategory: 'AUTHENTICATION', fields: ['code'] },
  ORDER_CONFIRMED: utility('order_confirmed', 'orders', ['orderNumber', 'amount', 'deliveryDate', 'orderLink']),
  SUBSCRIPTION_ACTIVATED: utility('subscription_activated', 'subscriptions', ['productName', 'quantity', 'startDate']),
  SUBSCRIPTION_PAUSED: utility('subscription_paused', 'subscriptions', ['productName', 'pauseDate']),
  SUBSCRIPTION_RESUMED: utility('subscription_resumed', 'subscriptions', ['productName', 'nextDate']),
  SUBSCRIPTION_CANCELLED: utility('subscription_cancelled', 'subscriptions', ['productName']),
  NEXT_DAY_REMINDER: utility('next_day_reminder', 'deliveries', ['quantity', 'productName']),
  OUT_FOR_DELIVERY: utility('out_for_delivery', 'deliveries', ['quantity', 'productName']),
  DELIVERY_COMPLETED: utility('delivery_completed', 'deliveries', ['quantity', 'productName', 'time']),
  DELIVERY_FAILED: utility('delivery_failed', 'deliveries', ['reason']),
  BILLING_ISSUE: utility('billing_reminder', 'billing', ['productName', 'dueDate']),
  BILLING_REMINDER: utility('billing_reminder', 'billing', ['productName', 'dueDate'])
});

export function resolveWhatsAppTemplate(key, params = {}, env = process.env) {
  const template = WHATSAPP_TEMPLATES[key];
  if (!template) throw new Error('unknown_whatsapp_template');
  const name = env[`WHATSAPP_TEMPLATE_${key}`] || template.name;
  const values = template.fields.map(field => {
    const value = String(params[field] ?? (['pauseDate','nextDate','startDate','deliveryDate','dueDate'].includes(field) ? 'See your Milvanta account' : ''));
    if (!value || value.length > 1024 || /[\r\n\t]/.test(value)) throw new Error('invalid_template_parameter');
    return value;
  });
  return { ...template, name, values };
}

export function isApprovedTemplate(name, language, env = process.env) {
  return String(env.WHATSAPP_APPROVED_TEMPLATES || '').split(',').map(x => x.trim()).includes(`${name}:${language}`);
}

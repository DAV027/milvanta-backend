/**
 * Milvanta daily delivery scheduler.
 * Deploy as a SEPARATE Cloudflare Worker, not the existing "milvanta"
 * storefront Worker. Fail closed until DELIVERY_CRON_ENABLED === 'true'.
 *
 * Cron: 45 14 * * * (UTC 14:45 / IST 20:15).
 * The Render backend authoritatively derives tomorrow's IST date, verifies
 * payment + delivery entitlement and excludes Test Mode dispatch.
 */
const CRON = '45 14 * * *';
const BACKEND_URL = 'https://milvanta-backend.onrender.com/api/v1/internal/deliveries/generate';

export async function executeDeliveryCron(env, { cron = CRON, fetchImpl = fetch } = {}) {
  if (env?.DELIVERY_CRON_ENABLED !== 'true') {
    return { status: 'disabled', requestAttempted: false };
  }
  if (cron !== CRON) {
    return { status: 'ignored_wrong_schedule', requestAttempted: false };
  }
  const secret = env?.DELIVERY_CRON_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || secret.trim() !== secret) {
    throw new Error('delivery_worker_secret_not_configured');
  }

  // Exactly one HTTP POST attempt per Cron invocation. Never retry a failed
  // response or an ambiguous timeout. Backend generation is idempotent.
  const response = await fetchImpl(BACKEND_URL, {
    method: 'POST',
    headers: { 'x-delivery-worker-secret': secret, accept: 'application/json' }
  });
  if (!response.ok) {
    // No raw gateway response: it could contain operational/customer details.
    throw new Error('delivery_generation_http_' + Number(response.status));
  }
  const result = await response.json();
  if (result?.success !== true || !/^\d{4}-\d{2}-\d{2}$/.test(result?.targetDate || '')) {
    throw new Error('invalid_delivery_generation_response');
  }
  return {
    status: 'complete',
    targetDate: result.targetDate,
    generatedCount: Number(result.generatedCount) || 0,
    skippedCount: Number(result.skippedCount) || 0,
    totalActiveSubscriptions: Number(result.totalActiveSubscriptions) || 0,
    requestAttempted: true
  };
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const outcome = await executeDeliveryCron(env, { cron: controller.cron });
        // Public-safe counts only; never log secret, customer data or tokens.
        console.log('milvanta_delivery_cron', outcome);
      } catch (error) {
        console.error('milvanta_delivery_cron_failed', error?.message || 'unknown_error');
        throw error;
      }
    })());
  }
};

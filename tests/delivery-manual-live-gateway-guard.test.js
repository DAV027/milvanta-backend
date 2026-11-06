import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateDailyDeliveries, previewDailyDeliveries } from '../src/services/deliveryEngine.js';
import { getEarliestPermittedDeliveryDateYMD } from '../src/services/deliveryCronPolicy.js';

const deliveryDate = getEarliestPermittedDeliveryDateYMD();
const modes = [
  { id: 51, customer_id: 1, status: 'active', notes: { keyMode: 'test', fulfillmentEntitled: true, paymentId: 'pay_test' } },
  { id: 52, customer_id: 1, status: 'active', notes: { fulfillmentEntitled: true, paymentId: 'pay_legacy' } },
  { id: 53, customer_id: 1, status: 'active', notes: { keyMode: 'unrecognized', fulfillmentEntitled: true, paymentId: 'pay_unknown' } }
];

function fakePool(active = modes) {
  const calls = [];
  const client = {
    async query(sql, params) {
      const query = String(sql);
      calls.push({ query, params });
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/.test(query)) return { rows: [], rowCount: 0 };
      if (query.includes('FROM customer_subscriptions cs') && query.includes("cs.status = 'active'")) {
        return { rows: active, rowCount: active.length };
      }
      throw new Error('Unexpected DB query (would bypass gateway-mode gate): ' + query.slice(0, 150));
    },
    release() {}
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('admin/manual generation skips Test Mode, unknown and absent keyMode with liveGatewayOnly true', async () => {
  const { pool, calls } = fakePool();
  const result = await generateDailyDeliveries(pool, deliveryDate, { rejectPastDates: true, liveGatewayOnly: true });
  assert.equal(result.success, true);
  assert.equal(result.generatedCount, 0);
  assert.equal(result.skippedCount, modes.length);
  assert.equal(result.totalActiveSubscriptions, modes.length);
  assert.ok(!calls.some(c => /INSERT INTO subscription_delivery_orders/.test(c.query)));
});

test('manual preview excludes the same modes without inserting anything', async () => {
  const { pool, calls } = fakePool();
  const result = await previewDailyDeliveries(pool, deliveryDate, { liveGatewayOnly: true });
  assert.equal(result.toGenerateCount, 0);
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.skippedBreakdown.gatewayModeNotLive, modes.length);
  assert.equal(result.excludedSubscriptions.length, modes.length);
  assert.ok(result.excludedSubscriptions.every(s => s.reason === 'gatewayModeNotLive'));
  assert.ok(!calls.some(c => /INSERT|UPDATE|DELETE/.test(c.query)));
});

test('production guard cannot be disabled by liveGatewayOnly:false in any engine entrypoint', async () => {
  // Use read-only static assurance, so this test never needs NODE_ENV mutation.
  const code = fs.readFileSync(new URL('../src/services/deliveryEngine.js', import.meta.url), 'utf8');
  assert.match(code, /process\.env\.NODE_ENV !== 'test' \|\| options\.liveGatewayOnly === true/g);
  assert.match(code, /if \(enforceLiveGatewayOnly\)/g);
  assert.doesNotMatch(code, /options\.liveGatewayOnly === false \?/);
});

test('manual admin route and all operational previews require live gateway evidence', () => {
  const code = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const routeStart = code.indexOf("app.post('/api/v1/operations/deliveries/generate'");
  const routeEnd = code.indexOf("app.post('/api/v1/operations/deliveries/:id/status'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(code.slice(routeStart, routeEnd),
    /generateDailyDeliveries\(pool, targetDate, \{ rejectPastDates: true, liveGatewayOnly: true \}\)/);
  assert.equal((code.match(/previewDailyDeliveries\(pool, targetDate, \{ liveGatewayOnly: true \}\)/g) || []).length, 3);
  assert.match(code, /generateDailyDeliveries\(pool, plan\.targetDate, \{ rejectPastDates: true, liveGatewayOnly: true \}\)/);
});

test('standalone scheduler cannot bypass production live-mode gate', () => {
  const source = fs.readFileSync(new URL('../scripts/daily-delivery-scheduler.js', import.meta.url), 'utf8');
  assert.match(source, /generateDailyDeliveries\(pool, plan\.targetDate, \{/);
  assert.match(source, /liveGatewayOnly: true/);
  assert.match(source, /getDeliveryCronTarget\(\)/);
  assert.match(source, /DELIVERY_SCHEDULER_ENABLED !== 'true'/);
  assert.doesNotMatch(source, /DELIVERY_SCHEDULER_ENABLED === 'false'/);
  // In production the engine itself hard-requires live mode for ALL callers.
  const code = fs.readFileSync(new URL('../src/services/deliveryEngine.js', import.meta.url), 'utf8');
  assert.match(code, /const enforceLiveGatewayOnly\s*=\s*process\.env\.NODE_ENV !== 'test' \|\| options\.liveGatewayOnly === true/);
});

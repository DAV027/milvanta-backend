import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const auditDoc = fs.readFileSync(new URL('../docs/SUBSCRIPTION_E2E_AUDIT_CORRECTIONS_2026-11-04.md', import.meta.url), 'utf8');
const webhookRoute = "app.post('/api/v1/payments/webhook',";
const browserCallbackRoute = "app.all('/api/v1/subscriptions/callback',";

test('Razorpay event webhook and browser return callback are distinct endpoints', () => {
  assert.equal(code.split(webhookRoute).length - 1, 1, 'signed payment webhook should have one defined route');
  assert.equal(code.split(browserCallbackRoute).length - 1, 1, 'browser callback should have one defined route');
  assert.match(auditDoc, /https:\/\/milvanta-backend\.onrender\.com\/api\/v1\/payments\/webhook/);
  assert.match(auditDoc, /\/api\/v1\/subscriptions\/callback.*not.*event webhook endpoint/i);
});

test('Razorpay event webhook requires raw-body HMAC SHA256 and unique event ID', () => {
  const start = code.indexOf(webhookRoute);
  assert.ok(start >= 0);
  const routeGuard = code.slice(start, start + 1800);
  assert.match(routeGuard, /process\.env\.RAZORPAY_WEBHOOK_SECRET/);
  assert.match(routeGuard, /request\.headers\['x-razorpay-signature'\]/);
  assert.match(routeGuard, /request\.rawBody/);
  assert.match(routeGuard, /crypto\.createHmac\('sha256', secret\)\.update\(request\.rawBody\)/);
  assert.match(routeGuard, /crypto\.timingSafeEqual/);
  assert.match(routeGuard, /request\.headers\['x-razorpay-event-id'\]/);
  assert.match(routeGuard, /missing_event_id/);
});

test('Razorpay event webhook records event-id deduplication before applying changes', () => {
  const start = code.indexOf(webhookRoute);
  const portion = code.slice(start, start + 7500);
  assert.match(portion, /INSERT INTO payment_webhook_events \(event_id\) VALUES \(\$1\) ON CONFLICT DO NOTHING/);
  assert.match(portion, /if \(seen\.rowCount\)/);
});

test('refund lifecycle is explicitly reconciled; no claim of automatic entitlement revocation', () => {
  const start = code.indexOf(webhookRoute);
  const portion = code.slice(start, start + 9500);
  assert.match(portion, /\['refund\.processed', 'refund\.failed'\]/);
  assert.match(portion, /UPDATE refund_requests/);
  assert.match(portion, /INSERT INTO refund_request_history/);
  assert.match(auditDoc, /not by themselves establish an automatic paid-through reduction/);
  assert.match(auditDoc, /full refunds.*partial refunds.*undelivered days/);
});

test('test-mode Razorpay gateway resource creation is not represented as a paid entitlement', () => {
  assert.match(auditDoc, /paid_count = 0/);
  assert.match(auditDoc, /NOT proof that all Razorpay deliveries completed/);
  assert.match(auditDoc, /genuine webhook/);
});

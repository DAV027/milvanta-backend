import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sendWhatsAppTemplate, verifyWhatsAppWebhookSignature, normalizeIndianPhoneNumber } from '../src/services/whatsappService.js';

process.env.NODE_ENV = 'test';
const env = { WHATSAPP_ENABLED: 'true', WHATSAPP_GRAPH_API_VERSION: 'v25.0', WHATSAPP_ACCESS_TOKEN: 'secret-token', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_APPROVED_TEMPLATES: 'milvanta_order_confirmed:en' };
const args = { phone: '9876543210', templateName: 'milvanta_order_confirmed', language: 'en', values: ['MV1', '100', '2026-10-23', 'https://milvanta.in/profile.html'], env };
test('strict Indian E.164 normalization', () => {
  assert.equal(normalizeIndianPhoneNumber('98765 43210'), '+919876543210');
  assert.equal(normalizeIndianPhoneNumber('+91-9876543210'), '+919876543210');
  assert.equal(normalizeIndianPhoneNumber('abc9876543210'), null);
});
test('exact raw bytes signature, no test bypass', () => {
  const rawBody = Buffer.from('{ "test": 1 }');
  const signature = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(rawBody).digest('hex');
  assert.equal(verifyWhatsAppWebhookSignature({ rawBody, signature, appSecret: 'app-secret' }), true);
  assert.equal(verifyWhatsAppWebhookSignature({ rawBody: Buffer.from('{"test":1}'), signature, appSecret: 'app-secret' }), false);
  assert.equal(verifyWhatsAppWebhookSignature({ rawBody, signature: '', appSecret: 'app-secret' }), false);
});
test('send accepted only with Meta message ID, HTTPS and sanitized payload', async () => {
  const result = await sendWhatsAppTemplate({ ...args, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://graph.facebook.com/v25.0/123/messages');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.to, '919876543210');
    assert.equal(body.type, 'template');
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 });
  } });
  assert.equal(result.accepted, true);
  assert.equal(result.messageId, 'wamid.test');
});
test('configuration, approvals, malformed success and auth fail closed', async () => {
  const noFetch = () => { throw Error('must not send'); };
  await assert.rejects(sendWhatsAppTemplate({ ...args, env: { ...env, WHATSAPP_ENABLED: 'false' }, fetchImpl: noFetch }), { code: 'whatsapp_disabled' });
  await assert.rejects(sendWhatsAppTemplate({ ...args, env: { ...env, WHATSAPP_APPROVED_TEMPLATES: '' }, fetchImpl: noFetch }), { code: 'template_not_approved' });
  await assert.rejects(sendWhatsAppTemplate({ ...args, fetchImpl: async () => new Response('{}') }), { code: 'ambiguous_provider_response' });
  await assert.rejects(sendWhatsAppTemplate({ ...args, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 190, message: 'secret-token' } }), { status: 401 }) }), e => e.code === 'meta_190' && !e.retryable && !e.message.includes('secret-token'));
});
test('rate limits use Retry-After, bounded retry; network timeouts never blindly retry', async () => {
  let calls = 0;
  const waits = [];
  await sendWhatsAppTemplate({ ...args, retries: 1, sleep: async ms => waits.push(ms), fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('{"error":{"code":130429}}', { status: 429, headers: { 'retry-after': '2' } }) : new Response('{"messages":[{"id":"wamid.retry"}]}');
  } });
  assert.equal(calls, 2);
  assert.ok(waits[0] >= 2000);
  calls = 0;
  await assert.rejects(sendWhatsAppTemplate({ ...args, fetchImpl: async () => { calls++; throw Error('network'); } }), { code: 'send_outcome_unknown' });
  assert.equal(calls, 1);
});

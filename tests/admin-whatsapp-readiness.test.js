import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getWhatsAppReadiness, getWhatsAppOutboxSummary } from '../src/services/whatsappAdminOverview.js';

const base = {
  WHATSAPP_ENABLED:'false',
  WHATSAPP_GRAPH_API_VERSION:'v25.0',
  WHATSAPP_TEMPLATE_LANGUAGE:'en',
  WHATSAPP_ACCESS_TOKEN:'super-secret-token-not-for-browser',
  WHATSAPP_PHONE_NUMBER_ID:'123456789',
  WHATSAPP_WABA_ID:'987654321',
  WHATSAPP_APP_SECRET:'private-meta-app-secret',
  WHATSAPP_VERIFY_TOKEN:'secret-webhook-token',
  WHATSAPP_OTP_HASH_SECRET:'a'.repeat(32),
  WHATSAPP_APPROVED_TEMPLATES:'milvanta_auth_otp:en,milvanta_order_confirmed:en'
};

test('readiness is informational and never leaks secret values or account identities', () => {
  const result = getWhatsAppReadiness(base);
  assert.equal(result.enabled, false);
  assert.equal(result.localConfigurationComplete, true);
  assert.equal(result.templates.authenticationLocallyAllowlisted, true);
  assert.equal(result.metaPhoneRegistered, 'not_checked');
  assert.equal(result.metaTemplateApproval, 'not_checked');
  assert.equal(result.liveDeliveryVerified, 'not_checked');
  assert.equal(result.readOnly, true);
  const json = JSON.stringify(result);
  for (const forbidden of [base.WHATSAPP_ACCESS_TOKEN,base.WHATSAPP_APP_SECRET,
    base.WHATSAPP_VERIFY_TOKEN,base.WHATSAPP_OTP_HASH_SECRET,
    base.WHATSAPP_PHONE_NUMBER_ID,base.WHATSAPP_WABA_ID]) {
    assert.equal(json.includes(forbidden), false, 'secret or ID must never appear');
  }
});

test('incomplete and misconfigured Meta credentials fail local readiness', () => {
  assert.equal(getWhatsAppReadiness({...base, WHATSAPP_ACCESS_TOKEN:''}).localConfigurationComplete, false);
  assert.equal(getWhatsAppReadiness({...base, WHATSAPP_PHONE_NUMBER_ID:'012x'}).checks.phoneNumberId, false);
  assert.equal(getWhatsAppReadiness({...base, WHATSAPP_OTP_HASH_SECRET:'short'}).checks.otpHashSecret, false);
  assert.equal(getWhatsAppReadiness({...base, WHATSAPP_APPROVED_TEMPLATES:''}).localConfigurationComplete, false);
  assert.equal(getWhatsAppReadiness({...base, WHATSAPP_TEMPLATE_LANGUAGE:'en_US'}).templates.authenticationLocallyAllowlisted, false);
  assert.equal(getWhatsAppReadiness({...base, WHATSAPP_ENABLED:'true'}).enabled, true);
});

test('queue summary handles missing database and unapplied migration', async () => {
  assert.deepEqual((await getWhatsAppOutboxSummary(null)).reason, 'database_not_configured');
  const stub={query:async sql=>{
    assert.match(sql,/to_regclass/);
    return {rows:[{present:false}]};
  }};
  assert.equal((await getWhatsAppOutboxSummary(stub)).reason,'outbox_migration_missing');
});

test('queue summary counts only WhatsApp rows, never returns recipients or body', async () => {
  let called=0;
  const stub={query:async sql=>{
    called++;
    if(called===1)return {rows:[{present:true}]};
    assert.match(sql,/WHERE channel = 'whatsapp'/);
    return {rows:[{status:'pending',count:4},{status:'delivered',count:2},
      {status:'uncertain',count:1},{status:'read',count:3},
      {status:'unrecognized_external',count:999,phone:'919876543210',body:'secret'}]};
  }};
  const result=await getWhatsAppOutboxSummary(stub);
  assert.equal(called,2);
  assert.equal(result.available,true);
  assert.equal(result.counts.pending,4);
  assert.equal(result.counts.delivered,2);
  assert.equal(result.counts.read,3);
  assert.equal(result.counts.uncertain,1);
  assert.equal(JSON.stringify(result).includes('919876543210'),false);
  assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('both admin artifacts include the same safe WhatsApp panel', () => {
  const primary=fs.readFileSync(new URL('../frontend/admin.html', import.meta.url),'utf8');
  const mirror=fs.readFileSync(new URL('../frontend/cloudflare-upload/admin.html', import.meta.url),'utf8');
  assert.equal(primary,mirror,'Cloudflare deployment mirror must stay in sync');
  for(const id of ['navBtnWhatsApp','whatsappSection','whatsappChecksList','btnWhatsAppRefresh']) {
    assert.match(primary,new RegExp('id="'+id+'"'));
  }
  assert.match(primary,/\/api\/v1\/admin\/whatsapp\/overview/);
  assert.match(primary,/textContent/);
  assert.doesNotMatch(primary,/id="whatsappSendButton"/);
});

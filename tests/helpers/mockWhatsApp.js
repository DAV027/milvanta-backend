// Test-only Graph transport. Never imports production credentials or opens a socket.
import crypto from 'node:crypto';
import { WHATSAPP_TEMPLATES } from '../../src/services/whatsappTemplates.js';
export function configureMockWhatsApp() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Explicit test environment required');
  Object.assign(process.env,{
    WHATSAPP_ENABLED:'true', WHATSAPP_GRAPH_API_VERSION:'v25.0',
    WHATSAPP_ACCESS_TOKEN:'test-only-meta-token', WHATSAPP_PHONE_NUMBER_ID:'123',
    WHATSAPP_WABA_ID:'456', WHATSAPP_APP_SECRET:'test-only-app-secret',
    WHATSAPP_VERIFY_TOKEN:'test-only-handshake',WHATSAPP_TEMPLATE_LANGUAGE:'en',
    WHATSAPP_OTP_HASH_SECRET:'test-only-hash-secret-at-least-32-characters',
    WHATSAPP_APPROVED_TEMPLATES:Object.values(WHATSAPP_TEMPLATES).map(t=>`${t.name}:en`).join(',')
  });
  const requests=[];
  const fetchImpl=async(url,options)=>{
    if(!url.startsWith('https://graph.facebook.com/')) throw new Error('Non-Meta transport forbidden');
    const body=JSON.parse(options.body); requests.push(body);
    return new Response(JSON.stringify({messages:[{id:`wamid.mock.${crypto.randomUUID()}`}]}));
  };
  return {fetchImpl,requests,get lastOtp(){return requests.findLast(x=>x.template.name==='milvanta_auth_otp')?.template.components[0].parameters[0].text;}};
}

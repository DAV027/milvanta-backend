/**
 * Read-only by default. Optional SINGLE Razorpay Test Mode subscription
 * creation requires a separate explicit operator opt-in.
 *
 * No access to Neon, Render DB, webhooks, emails, WhatsApp, or payments.
 * Never prints credentials, request headers, full provider response JSON,
 * or personal data. Never auto-retries a POST.
 *
 * PRE-FLIGHT ONLY:
 *  node scripts/razorpay-subscription-test-probe.mjs --plan-id plan_... --expected-amount-paise 315000
 *
 * OPTIONAL CREATE (only after separate approval):
 *  set ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE=YES_CREATE_ONE_TEST_SUBSCRIPTION
 *  node scripts/razorpay-subscription-test-probe.mjs --plan-id plan_... --expected-amount-paise 315000 --execute-one-test-create
 *
 * If POST succeeds, it creates a pending TEST gateway resource, not a paid
 * entitlement. Never authorize a payment/mandate from this diagnostic.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BASE_URL = 'https://api.razorpay.com/v1';
const CREATE_APPROVAL = 'YES_CREATE_ONE_TEST_SUBSCRIPTION';
const PLAN_ID_RE = /^plan_[A-Za-z0-9]{10,}$/;

function scrub(value, env={}) {
  let s = String(value ?? '').slice(0, 400);
  // Defense in depth against accidental secrets and customer PII in errors.
  for (const value of [env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET]) {
    if (typeof value === 'string' && value.length >= 4) s = s.split(value).join('[REDACTED]');
  }
  return s
    .replace(/(?:rzp_test_|rzp_live_)[A-Za-z0-9_\-]+/gi, '[REDACTED_KEY]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, '[REDACTED_AUTH]')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?91[-\s]?)?[6-9][0-9]{9}\b/g, '[REDACTED_PHONE]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]')
    .slice(0, 280);
}

function safeToken(value, pattern=/^[a-zA-Z_]{1,64}$/) {
  const v=String(value??'');
  return pattern.test(v)?v:null;
}

export function safeGatewayFailure(responseStatus, body, env={}) {
  const error = body && typeof body === 'object' ? body.error : null;
  return {
    httpStatus: responseStatus,
    code: safeToken(error?.code, /^[A-Z_]{1,64}$/),
    field: safeToken(error?.field, /^[a-zA-Z0-9_.-]{1,64}$/),
    reason: safeToken(error?.reason, /^[a-zA-Z0-9_\-]{1,64}$/),
    source: safeToken(error?.source, /^[a-zA-Z0-9_\-]{1,64}$/),
    step: safeToken(error?.step, /^[a-zA-Z0-9_\-]{1,64}$/),
    description: scrub(error?.description || body?.message || 'No description returned', env)
  };
}

export function parseProbeArgs(argv=[]) {
  const index=argv.indexOf('--plan-id');
  const amountIndex=argv.indexOf('--expected-amount-paise');
  if(index<0 || amountIndex<0 || index+1>=argv.length || amountIndex+1>=argv.length) {
    throw new Error('Provide --plan-id plan_... and --expected-amount-paise N (preflight-only by default).');
  }
  const planId=argv[index+1];
  const amountText=argv[amountIndex+1];
  if(!PLAN_ID_RE.test(planId)) throw new Error('Invalid Razorpay plan ID format.');
  if(!/^[0-9]+$/.test(amountText)) throw new Error('Invalid expected amount.');
  const expectedAmountPaise=Number(amountText);
  if(!Number.isSafeInteger(expectedAmountPaise)||expectedAmountPaise<100) {
    throw new Error('Expected plan amount must be an integer of at least 100 paise.');
  }
  return {planId,expectedAmountPaise,executeCreate:argv.includes('--execute-one-test-create')};
}

async function parseJsonQuiet(response) {
  try { return await response.json(); } catch { return null; }
}

export async function runRazorpaySubscriptionProbe({
  env=process.env,
  args=process.argv.slice(2),
  fetchImpl=fetch
}={}) {
  const {planId,expectedAmountPaise,executeCreate}=parseProbeArgs(args);
  const keyId=String(env.RAZORPAY_KEY_ID||'');
  const keySecret=String(env.RAZORPAY_KEY_SECRET||'');
  if(!keyId.startsWith('rzp_test_')||!keySecret||keyId!==keyId.trim()||keySecret!==keySecret.trim()) {
    throw new Error('Requires valid-format TEST key pair supplied in environment without surrounding whitespace; no request sent.');
  }
  if(executeCreate && env.ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE !== CREATE_APPROVAL) {
    throw new Error('POST is blocked. Separate explicit approval required. No request sent.');
  }
  const auth='Basic '+Buffer.from(keyId+':'+keySecret,'utf8').toString('base64');
  const headers={Authorization:auth,Accept:'application/json'};
  const baseReport={keyMode:'test',planId,expectedAmountPaise,postAttempted:false};
  let getResponse;
  try{
    getResponse=await fetchImpl(BASE_URL+'/plans/'+planId,{
      method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)
    });
  }catch{
    return {...baseReport,preflight:{status:'network_error'},diagnosis:'Stop: read-only plan fetch failed; verify network and test keys.'};
  }
  const plan=await parseJsonQuiet(getResponse);
  if(getResponse.status!==200) {
    return {...baseReport,preflight:{status:getResponse.status,error:safeGatewayFailure(getResponse.status,plan,env)},diagnosis:'Stop: plan could not be fetched using these TEST credentials.'};
  }
  const match=Boolean(plan && plan.id===planId && plan.period==='monthly' &&
    Number(plan.interval)===1 && plan.item?.currency==='INR' &&
    Number(plan.item?.amount)===expectedAmountPaise);
  const preflight={
    httpStatus:200,
    match,
    period:safeToken(plan?.period),
    interval:Number(plan?.interval),
    currency:safeToken(plan?.item?.currency,/^[A-Z]{3}$/),
    amountPaise:Number(plan?.item?.amount)
  };
  if(!match) {
    return {...baseReport,preflight,diagnosis:'Stop: plan attributes differ from expected monthly INR configuration.'};
  }
  if(!executeCreate) {
    return {...baseReport,preflight,diagnosis:'READ_ONLY_OK: No POST sent. Actual subscription creation remains unverified.'};
  }

  // EXACTLY ONE TEST MODE POST, no customer details, notes, mandates, or payment authorization.
  const requestBody={plan_id:planId,total_count:1,quantity:1,customer_notify:true};
  let postResponse;
  try{
    postResponse=await fetchImpl(BASE_URL+'/subscriptions',{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify(requestBody),redirect:'error',signal:AbortSignal.timeout(12000)
    });
  }catch{
    return {...baseReport,preflight,postAttempted:true,
      result:{status:'ambiguous_network_error'},
      diagnosis:'STOP: POST outcome unknown. Check Razorpay Test Mode subscriptions before any retry.'};
  }
  const body=await parseJsonQuiet(postResponse);
  if(postResponse.status<200||postResponse.status>=300) {
    return {...baseReport,preflight,postAttempted:true,
      result:{status:'rejected',error:safeGatewayFailure(postResponse.status,body,env)},
      diagnosis:'STOP: Record the redacted error field and description. Do not retry automatically.'};
  }
  const subId=String(body?.id||'');
  return {...baseReport,preflight,postAttempted:true,
    result:{status:'created_in_test_mode',subscriptionId:/^sub_[A-Za-z0-9]+$/.test(subId)?subId:null,
      gatewayState:safeToken(body?.status)},
    diagnosis:'TEST subscription resource created. DO NOT authorize any payment or mandate; reconcile it in Razorpay Test Mode.'};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  runRazorpaySubscriptionProbe().then(report=>{
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.postAttempted && report.result?.status==='rejected') process.exitCode=1;
  }).catch(()=>{
    // Never print provider errors, credentials, or stack traces from a diagnostic.
    process.stderr.write('Diagnostic refused to run. Check plan ID, amount, TEST credentials and explicit POST approval.\n');
    process.exitCode=1;
  });
}

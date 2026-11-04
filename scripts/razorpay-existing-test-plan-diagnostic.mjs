/**
 * Razorpay TEST-MODE diagnostic for one ALREADY-EXISTING Milvanta plan.
 *
 * Default: GET /v1/plans/:id ONLY. Makes no writes.
 * Explicit mode: --create-test-subscription-once creates ONE unattached,
 * TEST-MODE subscription on the validated existing plan. It does not
 * authorize a mandate, capture payment, or update Milvanta's database.
 *
 * Never log secrets, full provider errors, customer details, or auth headers.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySubscriptionGatewayError } from '../src/razorpaySubscriptionErrors.js';

const API = 'https://api.razorpay.com/v1';
const TEST_CREATE_FLAG = '--create-test-subscription-once';

export function parseArgs(argv) {
  const result = { create: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === TEST_CREATE_FLAG) {
      if (result.create) throw new Error('Duplicate create flag');
      result.create = true;
    } else if (arg === '--plan-id' || arg === '--expected-amount-paise') {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new Error('Missing parameter value');
      if (arg === '--plan-id' && result.planId) throw new Error('Duplicate plan ID');
      if (arg === '--expected-amount-paise' && result.expectedAmountPaise) throw new Error('Duplicate expected amount');
      if (arg === '--plan-id') result.planId = next;
      else result.expectedAmountPaise = Number(next);
    } else {
      throw new Error('Unrecognized diagnostic argument');
    }
  }
  if (!/^plan_[A-Za-z0-9]{14}$/.test(result.planId || '')) {
    throw new Error('A valid Razorpay plan ID is required');
  }
  if (!Number.isSafeInteger(result.expectedAmountPaise) || result.expectedAmountPaise < 100) {
    throw new Error('Expected amount must be a positive integer in paise');
  }
  return result;
}

export function lockOneAttempt({ keyId, planId }) {
  const fingerprint = createHash('sha256').update(keyId + ':' + planId).digest('hex').slice(0, 20);
  const lock = join(tmpdir(), 'milvanta-razorpay-test-create-' + fingerprint + '.lock');
  // Intentionally retain this file even if the API call times out. A retry
  // might otherwise create a second subscription when the first POST succeeded.
  writeFileSync(lock, 'Test Mode create attempt already made. Reconcile Razorpay before retrying.\n',
    { flag: 'wx', mode: 0o600 });
}

function knownField(field) {
  const allow = ['plan_id', 'total_count', 'quantity', 'customer_notify',
    'start_at', 'expire_by', 'notes', 'addons', 'offer_id'];
  return allow.includes(field) ? field : 'unknown';
}

async function decodeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function diagnoseExistingTestPlan({
  env = process.env,
  fetchImpl = fetch,
  lockAttempt = lockOneAttempt,
  planId,
  expectedAmountPaise,
  create = false
} = {}) {
  const keyId = String(env.RAZORPAY_KEY_ID || '');
  const secret = String(env.RAZORPAY_KEY_SECRET || '');
  if (!keyId.startsWith('rzp_test_') || !secret || keyId !== keyId.trim() || secret !== secret.trim()) {
    throw new Error('A clean Razorpay Test Mode key pair is required; no API request was sent');
  }
  if (!/^plan_[A-Za-z0-9]{14}$/.test(planId || '')) {
    throw new Error('Invalid plan ID; no API request was sent');
  }
  if (!Number.isSafeInteger(expectedAmountPaise) || expectedAmountPaise < 100) {
    throw new Error('Invalid expected amount; no API request was sent');
  }
  const authorization = 'Basic ' + Buffer.from(keyId + ':' + secret).toString('base64');
  const read = await fetchImpl(API + '/plans/' + encodeURIComponent(planId), {
    method: 'GET',
    headers: { Authorization: authorization, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const plan = await decodeJson(read);
  if (read.status !== 200) {
    return { mode: 'test', step: 'plan_read', status: read.status, result: 'PLAN_LOOKUP_FAILED', createAttempted: false };
  }
  if (plan?.id !== planId || plan?.period !== 'monthly' ||
      Number(plan?.interval) !== 1 || plan?.item?.currency !== 'INR' ||
      Number(plan?.item?.amount) !== expectedAmountPaise ||
      !String(plan?.item?.name || '').toLowerCase().includes('milvanta')) {
    return { mode: 'test', step: 'plan_validation', result: 'PLAN_MISMATCH', createAttempted: false };
  }
  if (!create) {
    return {
      mode: 'test', planId, monthlyAmountPaise: expectedAmountPaise,
      requestShape: { total_count: 1, quantity: 1, customer_notify: true, has_start_at: false, has_notes: false },
      result: 'READY_FOR_EXPLICIT_TEST', createAttempted: false
    };
  }
  // This side effect occurs ONLY after the explicit CLI flag and a validated
  // Test Mode GET. Never creates a second Razorpay plan or a payment mandate.
  lockAttempt({ keyId, planId });
  const payload = {
    plan_id: planId,
    total_count: 1,
    quantity: 1,
    customer_notify: true
  };
  const response = await fetchImpl(API + '/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const data = await decodeJson(response);
  if (response.status !== 200 && response.status !== 201) {
    return {
      mode: 'test', step: 'subscription_create', status: response.status,
      code: data?.error?.code === 'BAD_REQUEST_ERROR' ? 'BAD_REQUEST_ERROR' : 'unknown',
      reason: classifySubscriptionGatewayError({ error: data?.error }),
      field: knownField(data?.error?.field),
      result: 'REJECTED', createAttempted: true
    };
  }
  const subId = data?.id;
  return {
    mode: 'test', step: 'subscription_create', status: response.status,
    subscriptionId: /^sub_[A-Za-z0-9]{14}$/.test(subId || '') ? subId : 'REDACTED',
    subscriptionStatus: data?.status === 'created' ? 'created' : 'other',
    result: 'CREATED_TEST_SUBSCRIPTION', createAttempted: true,
    notice: 'Unattached Razorpay Test Mode subscription only. No mandate/payment or Milvanta subscription was created.'
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await diagnoseExistingTestPlan({ ...args });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.result === 'REJECTED' || report.result === 'PLAN_LOOKUP_FAILED' ||
        report.result === 'PLAN_MISMATCH') process.exitCode = 1;
  } catch {
    // Errors thrown by HTTP transports can embed sensitive request headers;
    // never print their messages, stack, or cause.
    process.stderr.write('Diagnostic stopped. Check Test Mode credentials, plan parameters, network access, or the local one-attempt lock. Do not repeat a create attempt without reconciliation.\n');
    process.exitCode = 1;
  }
}

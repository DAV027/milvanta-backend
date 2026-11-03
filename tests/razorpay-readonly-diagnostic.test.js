import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_ENDPOINTS, checkRazorpayReadAccess } from '../scripts/razorpay-readonly-diagnostic.mjs';

const env = { RAZORPAY_KEY_ID: 'rzp_test_fake_id', RAZORPAY_KEY_SECRET: 'fake_secret' };

test('read-only diagnostic calls exactly three GET endpoints and never mutates anything', async () => {
  const requests = [];
  const result = await checkRazorpayReadAccess({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method, accepts: options.headers.Accept });
      return { status: 200 };
    }
  });
  assert.deepEqual(READ_ENDPOINTS, ['orders', 'plans', 'subscriptions']);
  assert.deepEqual(requests.map(request => request.url), [
    'https://api.razorpay.com/v1/orders?count=1',
    'https://api.razorpay.com/v1/plans?count=1',
    'https://api.razorpay.com/v1/subscriptions?count=1'
  ]);
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.equal(result.keyMode, 'test');
  assert.match(result.diagnosis, /^READ_ACCESS_OK/);
  assert.ok(!JSON.stringify(result).includes('fake_secret'));
  assert.ok(!JSON.stringify(result).includes('rzp_test_fake_id'));
});

test('ordinary orders 401 is classified as credential rejection', async () => {
  const result = await checkRazorpayReadAccess({
    env,
    fetchImpl: async () => ({ status:401 })
  });
  assert.match(result.diagnosis, /^AUTH_REJECTED/);
});
test('plan rejection is diagnosed separately from ordinary API auth', async () => {
  let i = 0;
  const result = await checkRazorpayReadAccess({
    env,
    fetchImpl: async () => ({status:[200,401,403][i++]})
  });
  assert.match(result.diagnosis, /^PLAN_ACCESS_REJECTED/);
});
test('subscription read denial distinguished from plan read access', async () => {
  let i = 0;
  const result = await checkRazorpayReadAccess({
    env,
    fetchImpl: async () => ({status:[200,200,403][i++]})
  });
  assert.match(result.diagnosis, /^SUBSCRIPTION_ACCESS_REJECTED/);
});
test('missing key pair fails closed without any external requests', async () => {
  let count = 0;
  await assert.rejects(checkRazorpayReadAccess({
    env:{RAZORPAY_KEY_ID:'rzp_test_example'},
    fetchImpl:async()=>{count++;return {status:200}}
  }),/Missing Razorpay credentials/);
  assert.equal(count,0);
});
test('whitespace in configured key is detected without showing credentials', async () => {
  const result=await checkRazorpayReadAccess({
    env:{RAZORPAY_KEY_ID:env.RAZORPAY_KEY_ID+' ',RAZORPAY_KEY_SECRET:env.RAZORPAY_KEY_SECRET},
    fetchImpl:async()=>({status:200})
  });
  assert.equal(result.configurationWarnings.length,1);
  assert.ok(!JSON.stringify(result).includes('fake_secret'));
});
test('network errors are sanitized and do not return provider error details', async () => {
  const result=await checkRazorpayReadAccess({
    env,
    fetchImpl:async()=>{throw new Error('sensitive internal details');}
  });
  assert.equal(result.results[0].status,'network_error');
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});

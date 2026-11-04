import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProbeArgs,
  runRazorpaySubscriptionProbe,
  safeGatewayFailure
} from '../scripts/razorpay-subscription-test-probe.mjs';

const planId='plan_Tw2gBPDNylnx9v';
const args=['--plan-id',planId,'--expected-amount-paise','315000'];
const env={RAZORPAY_KEY_ID:'rzp_test_dummy_not_real',RAZORPAY_KEY_SECRET:'dummy_test_secret_not_real'};
const reply=(status,content)=>({status,json:async()=>content});
const validPlan={id:planId,period:'monthly',interval:1,item:{currency:'INR',amount:315000}};
const mockFetch=(calls,{getStatus=200,getBody=validPlan,postStatus=200,postBody={id:'sub_SyntheticTest1234',status:'created'}}={})=>
  async (url,options)=>{
    calls.push({url,method:options.method,body:options.body,authorization:options.headers.Authorization});
    if(options.method==='GET') return reply(getStatus,getBody);
    return reply(postStatus,postBody);
  };

test('argument validation refuses unknown or missing plan amounts',()=>{
  assert.deepEqual(parseProbeArgs(args),{planId,expectedAmountPaise:315000,executeCreate:false});
  assert.throws(()=>parseProbeArgs(['--plan-id','bogus','--expected-amount-paise','315000']),/plan ID/);
  assert.throws(()=>parseProbeArgs(['--plan-id',planId,'--expected-amount-paise','0']),/at least 100/);
});

test('default mode performs exactly one read-only GET and no subscription POST',async()=>{
  const calls=[];
  const output=await runRazorpaySubscriptionProbe({env,args,fetchImpl:mockFetch(calls)});
  assert.equal(output.preflight.match,true);
  assert.equal(output.postAttempted,false);
  assert.match(output.diagnosis,/READ_ONLY_OK/);
  assert.deepEqual(calls.map(c=>c.method),['GET']);
  assert.equal(calls[0].url,'https://api.razorpay.com/v1/plans/'+planId);
  assert.ok(!JSON.stringify(output).includes('dummy_test_secret'));
  assert.ok(!JSON.stringify(output).includes('rzp_test_dummy'));
});

test('write opt-in flag without separate approval fails before even the GET request',async()=>{
  const calls=[];
  await assert.rejects(
    runRazorpaySubscriptionProbe({env,args:[...args,'--execute-one-test-create'],fetchImpl:mockFetch(calls)}),
    /POST is blocked/
  );
  assert.equal(calls.length,0);
});

test('live keys are rejected before network access even when POST approval is set',async()=>{
  const calls=[];
  await assert.rejects(
    runRazorpaySubscriptionProbe({
      env:{...env,RAZORPAY_KEY_ID:'rzp_live_something',ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE:'YES_CREATE_ONE_TEST_SUBSCRIPTION'},
      args:[...args,'--execute-one-test-create'],fetchImpl:mockFetch(calls)
    }),
    /TEST key pair/
  );
  assert.equal(calls.length,0);
});

test('missing or mismatched plan attributes fail closed with no POST',async()=>{
  const calls=[];
  const report=await runRazorpaySubscriptionProbe({
    env:{...env,ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE:'YES_CREATE_ONE_TEST_SUBSCRIPTION'},
    args:[...args,'--execute-one-test-create'],
    fetchImpl:mockFetch(calls,{getBody:{...validPlan,item:{currency:'INR',amount:496000}}})
  });
  assert.equal(report.preflight.match,false);
  assert.deepEqual(calls.map(c=>c.method),['GET']);
});

test('authorized opt-in makes exactly one minimal POST to TEST subscriptions',async()=>{
  const calls=[];
  const report=await runRazorpaySubscriptionProbe({
    env:{...env,ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE:'YES_CREATE_ONE_TEST_SUBSCRIPTION'},
    args:[...args,'--execute-one-test-create'],fetchImpl:mockFetch(calls)
  });
  assert.deepEqual(calls.map(c=>c.method),['GET','POST']);
  assert.equal(calls[1].url,'https://api.razorpay.com/v1/subscriptions');
  assert.deepEqual(JSON.parse(calls[1].body),{
    plan_id:planId,total_count:1,quantity:1,customer_notify:true
  });
  assert.equal(report.result.status,'created_in_test_mode');
  assert.equal(report.result.subscriptionId,'sub_SyntheticTest1234');
  assert.ok(!JSON.stringify(report).includes(env.RAZORPAY_KEY_SECRET));
});

test('rejected POST retains useful diagnostic field without secrets or PII',async()=>{
  const calls=[];
  const report=await runRazorpaySubscriptionProbe({
    env:{...env,ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE:'YES_CREATE_ONE_TEST_SUBSCRIPTION'},
    args:[...args,'--execute-one-test-create'],
    fetchImpl:mockFetch(calls,{
      postStatus:400,
      postBody:{error:{
        code:'BAD_REQUEST_ERROR',field:'customer_notify',reason:'input_validation_failed',
        source:'business',step:'NA',
        description:'Invalid customer_notify for person@example.com 9876543210 with '+env.RAZORPAY_KEY_SECRET
      }}
    })
  });
  assert.equal(report.postAttempted,true);
  assert.equal(report.result.error.httpStatus,400);
  assert.equal(report.result.error.field,'customer_notify');
  assert.equal(report.result.error.reason,'input_validation_failed');
  const output=JSON.stringify(report);
  for(const secret of ['dummy_test_secret_not_real','person@example.com','9876543210']) {
    assert.ok(!output.includes(secret));
  }
  assert.deepEqual(calls.map(c=>c.method),['GET','POST']);
});

test('unknown POST outcome prevents automatic retries',async()=>{
  const calls=[];
  const f=async(url,opts)=>{
    calls.push({url,method:opts.method});
    if(opts.method==='GET')return reply(200,validPlan);
    throw new Error('Could not tell whether the gateway accepted the subscription');
  };
  const report=await runRazorpaySubscriptionProbe({
    env:{...env,ALLOW_RAZORPAY_TEST_SUBSCRIPTION_CREATE:'YES_CREATE_ONE_TEST_SUBSCRIPTION'},
    args:[...args,'--execute-one-test-create'],fetchImpl:f
  });
  assert.deepEqual(calls.map(x=>x.method),['GET','POST']);
  assert.equal(report.result.status,'ambiguous_network_error');
  assert.match(report.diagnosis,/before any retry/);
});

test('read-only GET failures include only sanitized response information',async()=>{
  const calls=[];
  const report=await runRazorpaySubscriptionProbe({
    env,args,fetchImpl:mockFetch(calls,{
      getStatus:401,
      getBody:{error:{code:'BAD_REQUEST_ERROR',description:'Authentication failed',field:null}}
    })
  });
  assert.equal(report.preflight.status,401);
  assert.deepEqual(calls.map(x=>x.method),['GET']);
  assert.ok(!JSON.stringify(report).includes(env.RAZORPAY_KEY_SECRET));
});

test('sanitizer does not return arbitrary field values',()=>{
  const err=safeGatewayFailure(400,{error:{
    code:'BAD_REQUEST_ERROR',field:'customer@example.com',reason:'bad input 123',description:env.RAZORPAY_KEY_ID
  }},env);
  assert.equal(err.field,null);
  assert.equal(err.reason,null);
  assert.ok(!JSON.stringify(err).includes(env.RAZORPAY_KEY_ID));
});

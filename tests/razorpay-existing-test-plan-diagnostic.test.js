import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, diagnoseExistingTestPlan
} from '../scripts/razorpay-existing-test-plan-diagnostic.mjs';

const planId = 'plan_AbCdEfGhIjKlMn';
const env = { RAZORPAY_KEY_ID: 'rzp_test_example_only', RAZORPAY_KEY_SECRET: 'fake_example_secret' };
const plan = {
  id: planId, period: 'monthly', interval: 1,
  item: { name: 'Milvanta Cow Milk (1 Litre)', amount: 315000, currency: 'INR' }
};
const fakeResponse = (status, payload) => ({ status, json: async () => payload });

test('parse arguments requires a valid Razorpay plan ID and safe amount', () => {
  const args=parseArgs(['--plan-id',planId,'--expected-amount-paise','315000']);
  assert.deepEqual(args,{create:false,planId,expectedAmountPaise:315000});
  assert.throws(()=>parseArgs(['--plan-id',planId]),/expected amount/i);
  assert.throws(()=>parseArgs(['--plan-id',planId,'--expected-amount-paise','315000','--unknown']),/unrecognized/i);
  assert.equal(parseArgs(['--plan-id',planId,'--expected-amount-paise','315000','--create-test-subscription-once']).create,true);
});

test('default mode uses ONLY GET on existing Test Mode plan without any writes', async () => {
  const calls = [];
  const result = await diagnoseExistingTestPlan({
    env, planId, expectedAmountPaise:315000,
    fetchImpl:async (url,options)=>{
      calls.push({url,method:options.method});
      return fakeResponse(200,plan);
    },
    lockAttempt:()=>{throw new Error('lock not expected')}
  });
  assert.equal(result.result,'READY_FOR_EXPLICIT_TEST');
  assert.equal(result.createAttempted,false);
  assert.deepEqual(calls,[{url:'https://api.razorpay.com/v1/plans/'+planId,method:'GET'}]);
  assert.ok(!JSON.stringify(result).includes(env.RAZORPAY_KEY_SECRET));
});

test('explicit Test Mode create checks plan via GET then sends a MINIMAL documented payload', async () => {
  const calls=[];
  let locks=0;
  const result=await diagnoseExistingTestPlan({
    env,planId,expectedAmountPaise:315000,create:true,
    lockAttempt:()=>{locks++;},
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      if(options.method==='GET') return fakeResponse(200,plan);
      return fakeResponse(200,{id:'sub_AbCdEfGhIjKlMn',status:'created'});
    }
  });
  assert.equal(locks,1);
  assert.deepEqual(calls.map(c=>c.options.method),['GET','POST']);
  assert.equal(calls[1].url,'https://api.razorpay.com/v1/subscriptions');
  assert.deepEqual(JSON.parse(calls[1].options.body),{
    plan_id:planId,total_count:1,quantity:1,customer_notify:true
  });
  assert.equal(result.subscriptionId,'sub_AbCdEfGhIjKlMn');
  assert.equal(result.subscriptionStatus,'created');
  assert.equal(result.result,'CREATED_TEST_SUBSCRIPTION');
});

test('live keys and incomplete keys are rejected BEFORE the GET', async () => {
  let requests=0;
  for(const badEnv of [
    {RAZORPAY_KEY_ID:'rzp_live_example',RAZORPAY_KEY_SECRET:'fake'},
    {RAZORPAY_KEY_ID:'rzp_test_example'},
    {RAZORPAY_KEY_ID:'rzp_test_example',RAZORPAY_KEY_SECRET:' fake'}
  ]) {
    await assert.rejects(diagnoseExistingTestPlan({
      env:badEnv, planId,expectedAmountPaise:315000,create:true,
      fetchImpl:async()=>{requests++;return fakeResponse(200,plan);}
    }),/Test Mode/);
  }
  assert.equal(requests,0);
});

test('plan ID, name, amount, period or currency mismatch stops BEFORE POST', async () => {
  for(const modified of [
    {...plan,id:'plan_AbCdEfGhIjKlMx'},
    {...plan,item:{...plan.item,name:'Other Store'}},
    {...plan,item:{...plan.item,amount:315001}},
    {...plan,period:'weekly'},
    {...plan,item:{...plan.item,currency:'USD'}}
  ]) {
    let posts=0,locks=0;
    const result=await diagnoseExistingTestPlan({
      env,planId,expectedAmountPaise:315000,create:true,
      fetchImpl:async(_,options)=>{
        if(options.method==='POST')posts++;
        return fakeResponse(200,modified);
      },
      lockAttempt:()=>{locks++;}
    });
    assert.equal(result.result,'PLAN_MISMATCH');
    assert.equal(posts,0);
    assert.equal(locks,0);
  }
});

test('400 gateway error is classified without exposing original reason or request secrets', async () => {
  const arbitrary='Sensitive user user@example.com token rzp_test_secret';
  const result=await diagnoseExistingTestPlan({
    env,planId,expectedAmountPaise:315000,create:true,
    lockAttempt:()=>{},
    fetchImpl:async(_,opts)=>opts.method==='GET'
      ? fakeResponse(200,plan)
      : fakeResponse(400,{error:{code:'BAD_REQUEST_ERROR',description:arbitrary,field:'unknown_key',reason:arbitrary}})
  });
  assert.deepEqual({
    status:result.status,code:result.code,reason:result.reason,field:result.field,result:result.result
  },{status:400,code:'BAD_REQUEST_ERROR',reason:'unclassified',field:'unknown',result:'REJECTED'});
  assert.ok(!JSON.stringify(result).includes('example.com'));
  assert.ok(!JSON.stringify(result).includes(env.RAZORPAY_KEY_SECRET));
});

test('400 documented plan issue returns only the allowlisted known reason and field', async () => {
  const result=await diagnoseExistingTestPlan({
    env,planId,expectedAmountPaise:315000,create:true,
    lockAttempt:()=>{},
    fetchImpl:async(_,opts)=>opts.method==='GET'
      ? fakeResponse(200,plan)
      : fakeResponse(400,{error:{code:'BAD_REQUEST_ERROR',description:'The id provided does not exist',field:'plan_id'}})
  });
  assert.equal(result.reason,'plan_reference_rejected');
  assert.equal(result.field,'plan_id');
});

test('a local attempt lock is requested before any POST and GET errors make no writes', async () => {
  let posts=0,locks=0;
  const result=await diagnoseExistingTestPlan({
    env,planId,expectedAmountPaise:315000,create:true,
    lockAttempt:()=>{locks++},
    fetchImpl:async(_,opts)=>{
      if(opts.method==='POST')posts++;
      return fakeResponse(403,{error:{code:'BAD_REQUEST_ERROR',description:'never print this'}});
    }
  });
  assert.equal(result.result,'PLAN_LOOKUP_FAILED');
  assert.equal(posts,0);
  assert.equal(locks,0);
});

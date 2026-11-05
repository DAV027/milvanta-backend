import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { executeDeliveryCron } from '../workers/milvanta-delivery-cron/index.mjs';

const secret='fixture_only_secure_random_000000000000000000000';
const goodResponse={
  ok:true,status:200,
  async json() {
    return {success:true,targetDate:'2026-11-06',generatedCount:0,skippedCount:2,totalActiveSubscriptions:2};
  }
};

test('Cloudflare Worker is disabled by default and makes zero requests', async()=>{
  let calls=0;
  const v=await executeDeliveryCron({}, {fetchImpl:async()=>{calls++;return goodResponse;}});
  assert.equal(v.status,'disabled');
  assert.equal(v.requestAttempted,false);
  assert.equal(calls,0);
});

test('Cloudflare Worker ignores a wrong schedule without a backend request', async()=>{
  let calls=0;
  const v=await executeDeliveryCron({DELIVERY_CRON_ENABLED:'true',DELIVERY_CRON_SECRET:secret}, {
    cron:'* * * * *',fetchImpl:async()=>{calls++;return goodResponse;}
  });
  assert.equal(v.status,'ignored_wrong_schedule');
  assert.equal(calls,0);
});

test('Cloudflare Worker refuses missing and short secret before any backend request',async()=>{
  let calls=0;
  for(const provided of [undefined,'x','x'.repeat(31),'y'.repeat(513)]) {
    await assert.rejects(
      executeDeliveryCron({DELIVERY_CRON_ENABLED:'true',DELIVERY_CRON_SECRET:provided},{
        fetchImpl:async()=>{calls++;return goodResponse;}
      }),/delivery_worker_secret_not_configured/
    );
  }
  assert.equal(calls,0);
});

test('enabled Cron sends exactly one signed HTTPS POST and returns only safe counts',async()=>{
  const calls=[];
  const v=await executeDeliveryCron({DELIVERY_CRON_ENABLED:'true',DELIVERY_CRON_SECRET:secret},{
    cron:'45 14 * * *',
    fetchImpl:async(url,opts)=>{calls.push({url,opts});return goodResponse;}
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://milvanta-backend.onrender.com/api/v1/internal/deliveries/generate');
  assert.equal(calls[0].opts.method,'POST');
  assert.equal(calls[0].opts.headers['x-delivery-worker-secret'],secret);
  assert.deepEqual(v,{status:'complete',targetDate:'2026-11-06',generatedCount:0,skippedCount:2,totalActiveSubscriptions:2,requestAttempted:true});
  assert.ok(!JSON.stringify(v).includes(secret));
});

test('Cloudflare Worker rejects unsuccessful HTTP response and never retries',async()=>{
  let calls=0;
  await assert.rejects(executeDeliveryCron({DELIVERY_CRON_ENABLED:'true',DELIVERY_CRON_SECRET:secret},{
    fetchImpl:async()=>{calls++;return {ok:false,status:503};}
  }),/delivery_generation_http_503/);
  assert.equal(calls,1);
});

test('Cloudflare Worker refuses invalid success response without retrying',async()=>{
  let calls=0;
  await assert.rejects(executeDeliveryCron({DELIVERY_CRON_ENABLED:'true',DELIVERY_CRON_SECRET:secret},{
    fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>({success:false,customer:{phone:'PRIVATE'}})};}
  }),/invalid_delivery_generation_response/);
  assert.equal(calls,1);
});

test('Cloudflare Worker fetch handler exposes no manual delivery trigger',async()=>{
  const response=await worker.fetch();
  assert.equal(response.status,404);
  assert.equal(await response.text(),'Not found');
});

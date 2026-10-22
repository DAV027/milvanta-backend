import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDisposableTestSchema,cleanupDisposableTestSchema } from './helpers/testDbGuard.js';
import { sendPhoneOtp,verifyPhoneOtp } from '../src/services/whatsappOtpService.js';
import { WHATSAPP_TEMPLATES } from '../src/services/whatsappTemplates.js';
import { setWhatsAppPreferences,queueWhatsAppNotification,processWhatsAppOutbox,handleWhatsAppWebhook } from '../src/services/whatsappService.js';
import { queuePaidSubscriptionActivation } from '../src/services/notificationService.js';
import { processNotificationOutbox,queueNotification } from '../src/services/notificationService.js';
import { generateDailyDeliveries,reminderScheduledAt } from '../src/services/deliveryEngine.js';
process.env.NODE_ENV='test';
process.env.RAZORPAY_WEBHOOK_SECRET='test-only-razorpay-signing-secret';
process.env.RAZORPAY_KEY_ID='rzp_test_whatsapp_mock';
process.env.RAZORPAY_KEY_SECRET='test-only-razorpay-api-secret';
Object.assign(process.env,{ WHATSAPP_ENABLED:'true',WHATSAPP_GRAPH_API_VERSION:'v25.0',WHATSAPP_ACCESS_TOKEN:'mock-token',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_WABA_ID:'456',WHATSAPP_TEMPLATE_LANGUAGE:'en',WHATSAPP_OTP_HASH_SECRET:'test-only-hmac-secret-at-least-32-characters',WHATSAPP_APP_SECRET:'test-app-secret',WHATSAPP_VERIFY_TOKEN:'verify-test',WHATSAPP_APPROVED_TEMPLATES:Object.values(WHATSAPP_TEMPLATES).map(t=>t.name+':en').join(',') });
let setup,pool,customer,sessionHash=crypto.createHash('sha256').update('session-A').digest('hex'),lastCode;
const mockedFetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(body.template.name==='milvanta_auth_otp') {
    lastCode=body.template.components[0].parameters[0].text;
    assert.match(lastCode,/^\d{6}$/);
    assert.equal(body.template.components[1].parameters[0].text,lastCode);
  }
  return new Response(JSON.stringify({messages:[{id:`wamid.${crypto.randomUUID()}`}]}));
};
const ctx=()=>({phone:customer.phone,customerId:customer.id,sessionHash,pool});
before(async()=>{
  setup=await setupDisposableTestSchema();pool=setup.pool;
  const {rows}=await pool.query(`INSERT INTO customers(full_name,email,phone,password_salt,password_hash) VALUES('WA Test','wa@test.invalid','9876543210','salt','hash') RETURNING *`);
  customer=rows[0];
});
after(async()=>{if(setup) await cleanupDisposableTestSchema(pool,setup.schemaName);});
async function clearOtp(){ await pool.query('DELETE FROM whatsapp_otp_challenges'); }
test('durable OTP: hashed at rest, bound to account/session, single use and correct timestamp',async()=>{
  await sendPhoneOtp(ctx(),{fetchImpl:mockedFetch});
  const {rows}=await pool.query('SELECT * FROM whatsapp_otp_challenges');
  assert.notEqual(rows[0].otp_hash,lastCode);
  assert.equal(JSON.stringify(rows).includes(`"${lastCode}"`),false);
  assert.ok(new Date(rows[0].expires_at)-new Date(rows[0].created_at)<=300001);
  assert.equal((await verifyPhoneOtp({...ctx(),sessionHash:'b'.repeat(64),code:lastCode})).verified,false);
  await assert.rejects(verifyPhoneOtp({...ctx(),customerId:customer.id+100,code:lastCode}),{code:'account_phone_mismatch'});
  assert.equal((await verifyPhoneOtp({...ctx(),code:lastCode})).verified,true);
  assert.equal((await verifyPhoneOtp({...ctx(),code:lastCode})).verified,false);
  const result=await pool.query('SELECT phone_verified_at FROM customers WHERE id=$1',[customer.id]);assert.ok(result.rows[0].phone_verified_at);
  customer.phone_verified_at=result.rows[0].phone_verified_at;
});
test('OTP cooldown serialized across concurrent requests, expiry and supersession',async()=>{
  await clearOtp();
  const results=await Promise.allSettled([sendPhoneOtp(ctx(),{fetchImpl:mockedFetch}),sendPhoneOtp(ctx(),{fetchImpl:mockedFetch})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'cooldown_active');
  await pool.query(`UPDATE whatsapp_otp_challenges SET expires_at=NOW()-INTERVAL '1 second'`);
  assert.equal((await verifyPhoneOtp({...ctx(),code:lastCode})).verified,false);
  await pool.query(`UPDATE whatsapp_otp_challenges SET created_at=NOW()-INTERVAL '61 seconds'`);
  const oldCode=lastCode;
  await sendPhoneOtp(ctx(),{fetchImpl:mockedFetch});
  const {rows}=await pool.query(`SELECT status FROM whatsapp_otp_challenges ORDER BY created_at`);
  assert.equal(rows[0].status,'superseded');
  // A superseded code cannot verify the newest challenge unless cryptographically regenerated identically.
  if(oldCode!==lastCode) assert.equal((await verifyPhoneOtp({...ctx(),code:oldCode})).verified,false);
});
test('five attempts lock challenge, failed sends never become usable',async()=>{
  await clearOtp();await sendPhoneOtp(ctx(),{fetchImpl:mockedFetch});
  const wrong=lastCode==='000000'?'999999':'000000';
  for(let i=0;i<5;i++) assert.equal((await verifyPhoneOtp({...ctx(),code:wrong})).verified,false);
  assert.equal((await verifyPhoneOtp({...ctx(),code:lastCode})).error,'max_attempts_exceeded');
  await clearOtp();
  await assert.rejects(sendPhoneOtp(ctx(),{fetchImpl:async()=>new Response('{"error":{"code":190}}',{status:401})}),{code:'meta_190'});
  assert.equal((await verifyPhoneOtp({...ctx(),code:lastCode})).verified,false);
});
const notification=(key)=>({customerId:customer.id,phone:customer.phone,templateKey:'ORDER_CONFIRMED',params:{orderNumber:'MV1',amount:'100',deliveryDate:'2026-10-23',orderLink:'https://milvanta.in/profile.html'},idempotencyKey:key});
test('explicit consent and idempotent order outbox; concurrent workers send once; accepted != delivered',async()=>{
  assert.equal((await queueWhatsAppNotification(pool,notification('order-1'))).queued,false);
  await setWhatsAppPreferences(pool,customer,{enabled:true});
  assert.equal((await queueWhatsAppNotification(pool,notification('order-1'))).queued,true);
  assert.equal((await queueWhatsAppNotification(pool,notification('order-1'))).duplicate,true);
  let sends=0;
  const fetchImpl=async(...args)=>{sends++;return mockedFetch(...args);};
  await Promise.all([processWhatsAppOutbox(pool,10,{fetchImpl}),processWhatsAppOutbox(pool,10,{fetchImpl})]);
  assert.equal(sends,1);
  const {rows}=await pool.query("SELECT * FROM notification_outbox WHERE idempotency_key='order-1'");
  assert.equal(rows[0].status,'accepted');assert.equal(rows[0].delivered_at,null);
});
test('historical SMS rows and event keys are preserved without processing or replay',async()=>{
  await pool.query(`INSERT INTO notification_outbox(customer_id,phone,channel,template_name,message_body,idempotency_key,status)
    VALUES($1,$2,'sms','HISTORICAL','Historical audit text','legacy-payment-event','pending')`,[customer.id,customer.phone]);
  assert.equal((await queueNotification(pool,notification('legacy-payment-event'))).duplicate,true);
  const before=(await pool.query("SELECT * FROM notification_outbox WHERE idempotency_key='legacy-payment-event'")).rows[0];
  let sends=0;
  await processNotificationOutbox(pool,100,{fetchImpl:async()=>{sends++;throw Error('No pending WhatsApp messages expected');}});
  const after=(await pool.query("SELECT * FROM notification_outbox WHERE idempotency_key='legacy-payment-event'")).rows[0];
  assert.equal(sends,0);assert.deepEqual(after,before);
});
function event(status,id,timestamp,extra={}){return {object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},statuses:[{status,id,timestamp:String(timestamp),...extra}]}}]}]};}
test('webhooks deduplicate, never regress read status, reconcile callback before response, opt-out',async()=>{
  const {rows}=await pool.query("SELECT * FROM notification_outbox WHERE idempotency_key='order-1'");const m=rows[0];
  assert.equal((await handleWhatsAppWebhook(pool,event('read',m.meta_message_id,1000))).processed,1);
  assert.equal((await handleWhatsAppWebhook(pool,event('read',m.meta_message_id,1000))).processed,0);
  await handleWhatsAppWebhook(pool,event('sent',m.meta_message_id,999));await handleWhatsAppWebhook(pool,event('failed',m.meta_message_id,1001));
  assert.equal((await pool.query('SELECT status FROM notification_outbox WHERE id=$1',[m.id])).rows[0].status,'read');
  const q=await queueWhatsAppNotification(pool,notification('callback-first'));
  await processWhatsAppOutbox(pool,10,{fetchImpl:async()=>{
    await handleWhatsAppWebhook(pool,event('delivered','wamid.early',1100,{biz_opaque_callback_data:`mv:${q.outboxId}`}));
    return new Response('{"messages":[{"id":"wamid.early"}]}');
  }});
  assert.equal((await pool.query('SELECT status FROM notification_outbox WHERE id=$1',[q.outboxId])).rows[0].status,'delivered');
  const payload={object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:'in.stop',from:'919876543210',timestamp:String(Math.floor(Date.now()/1000)+1),text:{body:'STOP'}}]}}]}]};
  await handleWhatsAppWebhook(pool,payload);
  assert.equal((await queueWhatsAppNotification(pool,notification('opted-out'))).queued,false);
});
test('consent rechecked before sending; rate retry scheduling, unknown outcome, abandoned claim recovery',async()=>{
  await setWhatsAppPreferences(pool,customer,{enabled:true});
  await queueWhatsAppNotification(pool,notification('consent-recheck'));
  await setWhatsAppPreferences(pool,customer,{enabled:false});
  const noSend=()=>{throw Error('must not send');};await processWhatsAppOutbox(pool,10,{fetchImpl:noSend});
  assert.equal((await pool.query("SELECT status FROM notification_outbox WHERE idempotency_key='consent-recheck'")).rows[0].status,'cancelled');
  await setWhatsAppPreferences(pool,customer,{enabled:true});
  await queueWhatsAppNotification(pool,notification('rate-limit'));
  await processWhatsAppOutbox(pool,10,{fetchImpl:async()=>new Response('{"error":{"code":130429}}',{status:429,headers:{'retry-after':'120'}})});
  let m=(await pool.query("SELECT * FROM notification_outbox WHERE idempotency_key='rate-limit'")).rows[0];
  assert.equal(m.status,'pending');assert.ok(new Date(m.next_attempt_at)>Date.now()+110000);
  await queueWhatsAppNotification(pool,notification('uncertain'));
  await processWhatsAppOutbox(pool,10,{fetchImpl:async()=>{throw Error('timeout');}});
  assert.equal((await pool.query("SELECT status FROM notification_outbox WHERE idempotency_key='uncertain'")).rows[0].status,'uncertain');
  await pool.query("UPDATE notification_outbox SET status='processing',claimed_at=NOW()-INTERVAL '6 minutes' WHERE idempotency_key='rate-limit'");
  await processWhatsAppOutbox(pool,10,{fetchImpl:noSend});
  assert.equal((await pool.query("SELECT status FROM notification_outbox WHERE idempotency_key='rate-limit'")).rows[0].status,'uncertain');
});
test('activation requires paid entitlement, duplicate event keys shared between checkout/webhook',async()=>{
  const p=await pool.query("INSERT INTO products(name,category,price_paise,selling_unit,image_url) VALUES('Milk','Milk',10000,'1 Litre','assets/milk.jpg') RETURNING id");
  const {rows}=await pool.query(`INSERT INTO customer_subscriptions(customer_id,plan_type,product_id,product_name,quantity,cost_per_day_paise,total_amount_paise,status,notes) VALUES($1,'daily',$2,'Milk','1 Litre',10000,300000,'active','{}') RETURNING id`,[customer.id,p.rows[0].id]);const id=rows[0].id;
  assert.equal((await queuePaidSubscriptionActivation(pool,id)).queued,false);
  await pool.query(`UPDATE customer_subscriptions SET notes='{"lastPaymentId":"pay_valid","fulfillmentEntitled":true,"startDate":"2026-10-23"}' WHERE id=$1`,[id]);
  assert.equal((await queuePaidSubscriptionActivation(pool,id)).queued,true);
  assert.equal((await queuePaidSubscriptionActivation(pool,id)).duplicate,true);
});
test('delivery reminders scheduled in IST and recheck skip, pause, vacation and unpaid state',async()=>{
  assert.equal(reminderScheduledAt('2026-10-23').toISOString(),'2026-10-22T15:30:00.000Z');
  const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date(Date.now()+86400000));
  const paidThrough=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date(Date.now()+30*86400000));
  const product=(await pool.query('SELECT id FROM products LIMIT 1')).rows[0].id;
  const ids=[];
  for(const mode of ['eligible','skip','pause','vacation','unpaid']) {
    const notes={startDate:tomorrow,paidThroughDate:paidThrough,lastPaymentId:'pay_valid',fulfillmentEntitled:true};
    if(mode==='unpaid') delete notes.lastPaymentId;
    const {rows}=await pool.query(`INSERT INTO customer_subscriptions(customer_id,plan_type,product_id,product_name,quantity,cost_per_day_paise,total_amount_paise,status,notes) VALUES($1,'daily',$2,'Milk','1 Litre',10000,300000,'active',$3) RETURNING id`,[customer.id,product,notes]);const id=rows[0].id;ids.push(id);
    if(mode==='skip') await pool.query('INSERT INTO subscription_skipped_dates(subscription_id,customer_id,skip_date) VALUES($1,$2,$3)',[id,customer.id,tomorrow]);
    if(['pause','vacation'].includes(mode)) await pool.query('INSERT INTO subscription_delivery_pauses(subscription_id,customer_id,pause_start_date,pause_end_date) VALUES($1,$2,$3,$4)',[id,customer.id,tomorrow,mode==='vacation'?paidThrough:null]);
  }
  await generateDailyDeliveries(pool,tomorrow);
  const {rows}=await pool.query('SELECT subscription_id FROM subscription_delivery_orders WHERE subscription_id=ANY($1::bigint[])',[ids]);
  assert.deepEqual(rows.map(x=>x.subscription_id),[ids[0]]);
  const msg=(await pool.query("SELECT * FROM notification_outbox WHERE idempotency_key=$1",[`sms_reminder_${ids[0]}_${tomorrow}`])).rows[0];
  assert.ok(msg.delivery_order_id);
  await pool.query('INSERT INTO subscription_skipped_dates(subscription_id,customer_id,skip_date) VALUES($1,$2,$3)',[ids[0],customer.id,tomorrow]);
  await pool.query("UPDATE notification_outbox SET scheduled_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[msg.id]);
  await processWhatsAppOutbox(pool,100,{fetchImpl:mockedFetch});
  assert.equal((await pool.query('SELECT status FROM notification_outbox WHERE id=$1',[msg.id])).rows[0].status,'cancelled');
  await pool.query("UPDATE subscription_delivery_orders SET status='delivered' WHERE id=$1",[msg.delivery_order_id]);
  const stale=await queueWhatsAppNotification(pool,{customerId:customer.id,phone:customer.phone,templateKey:'OUT_FOR_DELIVERY',params:{quantity:'1 Litre',productName:'Milk'},idempotencyKey:'stale-ofd',deliveryOrderId:msg.delivery_order_id});
  await processWhatsAppOutbox(pool,100,{fetchImpl:mockedFetch});
  assert.equal((await pool.query('SELECT status FROM notification_outbox WHERE id=$1',[stale.outboxId])).rows[0].status,'cancelled');
});
test('API signup/login/phone OTP session binding, preferences and signed webhook regressions',async()=>{
  const {app,pool:appPool,razorpay}=await import('../src/server.js');
  app.whatsappFetch=mockedFetch;
  try {
    const signup=await app.inject({method:'POST',url:'/api/v1/auth/signup',payload:{name:'WA API Tester',email:'wa-api@test.invalid',phone:'9988776655',password:'Test-password-123'}});
    assert.equal(signup.statusCode,201,signup.body);
    const token=signup.json().token, headers={authorization:`Bearer ${token}`};
    const unauth=await app.inject({method:'POST',url:'/api/v1/auth/phone/send-otp',payload:{phone:'9988776655'}});assert.equal(unauth.statusCode,401);
    const send=await app.inject({method:'POST',url:'/api/v1/auth/phone/send-otp',headers,payload:{phone:'9988776655'}});assert.equal(send.statusCode,200,send.body);assert.equal(send.json().code,undefined);
    const verify=await app.inject({method:'POST',url:'/api/v1/auth/phone/verify-otp',headers,payload:{phone:'9988776655',code:lastCode}});assert.equal(verify.json().verified,true,verify.body);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'wa-api@test.invalid',password:'Test-password-123'}});assert.equal(login.statusCode,200);
    const prefs=await app.inject({method:'PATCH',url:'/api/v1/customers/notifications/preferences',headers,payload:{enabled:true}});assert.equal(prefs.json().consent,true,prefs.body);
    const challenge=await app.inject({url:'/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=12345'});assert.equal(challenge.body,'12345');
    const raw='{ "object": "whatsapp_business_account", "entry": [] }';
    const signature='sha256='+crypto.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
    const valid=await app.inject({method:'POST',url:'/api/v1/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature},payload:raw});assert.equal(valid.statusCode,200,valid.body);
    const invalid=await app.inject({method:'POST',url:'/api/v1/webhooks/whatsapp',headers:{'content-type':'application/json','x-hub-signature-256':signature},payload:raw+' '});assert.equal(invalid.statusCode,403);
    const invalidRazorpay=await app.inject({method:'POST',url:'/api/v1/payments/webhook',payload:{event:'payment.captured'}});assert.equal(invalidRazorpay.statusCode,400);
    const customerId=signup.json().customer.id;
    const productId=(await pool.query('SELECT id FROM products LIMIT 1')).rows[0].id;
    const {rows:subs}=await pool.query(`INSERT INTO customer_subscriptions(customer_id,plan_type,product_id,product_name,quantity,cost_per_day_paise,total_amount_paise,status,razorpay_subscription_id,notes) VALUES($1,'daily',$2,'Milk','1 Litre',10000,300000,'pending_payment','sub_wa_api','{}') RETURNING id`,[customerId,productId]);
    const webhook={event:'subscription.activated',payload:{subscription:{entity:{id:'sub_wa_api',status:'active',paid_count:1,current_start:Math.floor(Date.now()/1000),current_end:Math.floor(Date.now()/1000)+30*86400}},payment:{entity:{id:'pay_wa_api',status:'captured',subscription_id:'sub_wa_api',created_at:Math.floor(Date.now()/1000)}}}};
    const rbody=JSON.stringify(webhook),rsig=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(rbody).digest('hex');
    const rheaders={'content-type':'application/json','x-razorpay-signature':rsig,'x-razorpay-event-id':'evt_wa_activation'};
    const activation=await app.inject({method:'POST',url:'/api/v1/payments/webhook',headers:rheaders,payload:rbody});assert.equal(activation.statusCode,200,activation.body);
    const duplicate=await app.inject({method:'POST',url:'/api/v1/payments/webhook',headers:rheaders,payload:rbody});assert.equal(duplicate.json().duplicate,true);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM notification_outbox WHERE idempotency_key=$1',[`sms_sub_activated_${subs[0].id}`])).rows[0].count),1);
    const {rows:orders}=await pool.query(`INSERT INTO customer_orders(order_number,customer_id,idempotency_key,address,items,subtotal_paise,total_paise,razorpay_order_id) VALUES('MV-WA-ATOMIC',$1,'wa-order','{}','[]',10000,10000,'order_wa_atomic') RETURNING id`,[customerId]);
    await pool.query(`INSERT INTO payment_orders(razorpay_order_id,customer_order_id,amount_paise,currency,items,status) VALUES('order_wa_atomic',$1,10000,'INR','[]','created')`,[orders[0].id]);
    await pool.query(`CREATE FUNCTION reject_whatsapp_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.channel='whatsapp' THEN RAISE EXCEPTION 'injected outbox failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_whatsapp_test_insert BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION reject_whatsapp_test_insert()`);
    const obody=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_wa_atomic',order_id:'order_wa_atomic',status:'captured',amount:10000,currency:'INR'}}}});
    const oheaders={'content-type':'application/json','x-razorpay-event-id':'evt_wa_order_atomic','x-razorpay-signature':crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(obody).digest('hex')};
    const failure=await app.inject({method:'POST',url:'/api/v1/payments/webhook',headers:oheaders,payload:obody});assert.equal(failure.statusCode,500,'A rolled back payment must never be acknowledged');
    assert.equal((await pool.query("SELECT status FROM payment_orders WHERE razorpay_order_id='order_wa_atomic'")).rows[0].status,'created');
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM payment_webhook_events WHERE event_id='evt_wa_order_atomic'")).rows[0].count),0);
    await pool.query('DROP TRIGGER reject_whatsapp_test_insert ON notification_outbox');
    const retry=await app.inject({method:'POST',url:'/api/v1/payments/webhook',headers:oheaders,payload:obody});assert.equal(retry.statusCode,200,retry.body);
    const repeat=await app.inject({method:'POST',url:'/api/v1/payments/webhook',headers:{...oheaders,'x-razorpay-event-id':'evt_wa_order_duplicate'},payload:obody});assert.equal(repeat.statusCode,200,repeat.body);
    razorpay.orders.fetch=async()=>({id:'order_wa_atomic',amount:10000});
    razorpay.payments.fetch=async()=>({id:'pay_wa_atomic',order_id:'order_wa_atomic',amount:10000,currency:'INR',status:'captured'});
    const checkout=await app.inject({method:'POST',url:'/api/v1/payments/verify',headers,payload:{razorpay_order_id:'order_wa_atomic',razorpay_payment_id:'pay_wa_atomic',razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_wa_atomic|pay_wa_atomic').digest('hex')}});
    assert.equal(checkout.statusCode,200,checkout.body);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM notification_outbox WHERE idempotency_key=$1',[`sms_order_paid_${orders[0].id}`])).rows[0].count),1);
  } finally {await app.close();await appPool.end();}
});

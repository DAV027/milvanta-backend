import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { classifySubscriptionGatewayError } from '../src/razorpaySubscriptionErrors.js';
import { renderCustomerOrderEmail } from '../src/emailTemplateRenderers.js';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const email = fs.readFileSync(new URL('../src/email.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function emailHelpers() {
  const start = email.indexOf('export function publicEmailImageUrl(');
  // Anchor the helper range to the next exported renderer wrapper rather than
  // a mutable comment heading, so currency validation changes remain testable.
  const end = email.indexOf('/**\n * Generate Customer Order Confirmation Email HTML', start);
  assert.ok(start >= 0 && end > start, 'email helpers must be present');
  const script = email.slice(start, end).replaceAll('export function', 'function') +
    '\n;globalThis.helpers = { publicEmailImageUrl, validOrderReceiptFinancials };';
  const context = vm.createContext({});
  vm.runInContext(script, context);
  return context.helpers;
}

const validOrder = {
  id: 6,
  order_number: 'MV-20261103-000006',
  subtotal_paise: 154900,
  delivery_charge_paise: 5000,
  total_paise: 159900,
  created_at: '2026-11-03T15:22:32.591Z'
};

test('customer receipt receives trusted financials from locked order row', () => {
  assert.match(server, /SELECT id, customer_id, order_number, address, items, subtotal_paise, delivery_charge_paise, total_paise, created_at, payment_status, order_status, reservation_expires_at FROM customer_orders WHERE id = \$1 FOR UPDATE/);
  assert.match(server, /enqueueOrderPaidOutbox\(client, \{[\s\S]*?order,[\s\S]*?customer,[\s\S]*?address: orderAddress/);
});

test('receipt rejects absent, zero or contradictory financial fields', () => {
  const { validOrderReceiptFinancials } = emailHelpers();
  assert.equal(validOrderReceiptFinancials(validOrder), true);
  assert.equal(validOrderReceiptFinancials({...validOrder, subtotal_paise:null}), false);
  assert.equal(validOrderReceiptFinancials({...validOrder, total_paise:undefined}), false);
  assert.equal(validOrderReceiptFinancials({...validOrder, subtotal_paise:0, delivery_charge_paise:0,total_paise:0}), false);
  assert.equal(validOrderReceiptFinancials({...validOrder, total_paise:159800}), false);
  assert.equal(validOrderReceiptFinancials({...validOrder, delivery_charge_paise:0,total_paise:154900}), true);
  assert.match(email, /if \(!validOrderReceiptFinancials\(order\)\)/);
});

test('order products carry images from product catalog and emails use HTTPS URLs', () => {
  assert.match(server, /SELECT id, name, category, price_paise, selling_unit, image_url, stock_quantity, reserved_stock FROM products/);
  assert.match(server, /imageUrl: product\.image_url/);
  const { publicEmailImageUrl } = emailHelpers();
  assert.equal(publicEmailImageUrl('assets/milvanta-curd.jpg'), 'https://milvanta.in/assets/milvanta-curd.jpg');
  assert.equal(publicEmailImageUrl('/assets/milvanta-cow-ghee.jpg'), 'https://milvanta.in/assets/milvanta-cow-ghee.jpg');
  assert.equal(publicEmailImageUrl('javascript:alert(1)'), '');
  assert.equal(publicEmailImageUrl('assets/../secret.txt'), '');
});

test('customer confirmation renders ₹1,549 subtotal, ₹50 delivery and ₹1,599 paid', () => {
  // Exercise the real branded renderer, not a string-evaluated copy of its implementation.
  const html = renderCustomerOrderEmail({
    order:validOrder,
    customer:{name:'Customer'},
    address:{name:'Customer',city:'Hyderabad',pincode:'500081'},
    paymentId:'pay_test_receipt',
    items:[
      {name:'Pot Curd',unit:'200 g',quantity:1,unitPricePaise:4900,lineTotalPaise:4900,imageUrl:'assets/milvanta-curd.jpg'},
      {name:'Pure Cow Ghee',unit:'500 g',quantity:1,unitPricePaise:150000,lineTotalPaise:150000,imageUrl:'assets/milvanta-cow-ghee.jpg'}
    ]
  });
  assert.match(html,/Items Subtotal[\s\S]*?₹1,549/);
  assert.match(html,/Cold-Chain Delivery Charges[\s\S]*?₹50/);
  assert.match(html,/Milvanta Order Total[\s\S]*?₹1,599/);
  assert.match(html,/Any separate Razorpay convenience charges shown at checkout/);
  assert.match(html,/https:\/\/milvanta.in\/assets\/milvanta-curd.jpg/);
  assert.match(html,/https:\/\/milvanta.in\/assets\/milvanta-cow-ghee.jpg/);
});

test('Razorpay 401 is diagnostic, actionable and never leaks provider response to browser', () => {
  assert.match(server, /subscriptionCreationStage = 'subscription_create'/);
  assert.match(server, /subscriptionCreationStage = 'database_persistence'/);
  assert.match(server, /\[401, 403\]\.includes\(gatewayStatus\)/);
  assert.match(server, /razorpay_subscription_access_denied/);
  assert.match(server, /subscription_requires_reconciliation/);
  assert.doesNotMatch(server, /subscription_creation_failed', message: err\.message/);
});


test('actual outbox function enqueues correct customer and admin amounts; missing values fail closed', async () => {
  const helperStart = email.indexOf('export function publicEmailImageUrl(');
  const helperEnd = email.indexOf('/**\n * Generate Customer Order Confirmation Email HTML', helperStart);
  const outboxStart = email.indexOf('export async function enqueueOrderPaidOutbox(');
  const outboxEnd = email.indexOf('/**\n * Enqueue transactional email outbox records for a confirmed milk subscription', outboxStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && outboxStart >= 0 && outboxEnd > outboxStart);

  const recordedErrors = [];
  const context = vm.createContext({
    process: {env: {ADMIN_EMAIL:'admin@milvanta.test'}},
    console: {error:(...messages)=>recordedErrors.push(messages)}
  });
  vm.runInContext(
    email.slice(helperStart,helperEnd).replaceAll('export function','function') + '\n' +
    email.slice(outboxStart,outboxEnd).replace('export async function','async function') +
    '\n;globalThis.enqueuePaid = enqueueOrderPaidOutbox;',
    context
  );

  const statements = [];
  const client = {
    query: async (sql,args) => {
      statements.push({sql,args});
      return {rows:[{id:statements.length,event_key:args[0],status:'pending'}]};
    }
  };
  const payload = {
    order:validOrder,
    customer:{email:'buyer@milvanta.test',name:'Sample Customer'},
    address:{house:'Unit 1',city:'Hyderabad'},
    items:[{name:'Pot Curd',quantity:1,unitPricePaise:4900,lineTotalPaise:4900}],
    paymentId:'pay_example_mock'
  };

  const enqueued = await context.enqueuePaid(client,payload);
  assert.equal(enqueued.length,2);
  assert.equal(statements.length,2);
  assert.ok(statements.every(statement => /INSERT INTO email_outbox/.test(statement.sql)));
  for (const statement of statements) {
    const saved = JSON.parse(statement.args[4]);
    assert.equal(saved.order.subtotal_paise,154900);
    assert.equal(saved.order.delivery_charge_paise,5000);
    assert.equal(saved.order.total_paise,159900);
    assert.equal(saved.paymentId,'pay_example_mock');
  }

  const skipped = await context.enqueuePaid(client,{
    ...payload,
    order:{...validOrder,total_paise:undefined}
  });
  assert.equal(skipped.length,0);
  assert.equal(statements.length,2,'invalid receipt must not enqueue any emails');
  assert.equal(recordedErrors.length,1);
});


test('gateway error handler classifies auth, persistence and upstream failures without leaking secrets', () => {
  const start = server.indexOf('    const gatewayStatus = Number(err?.statusCode || err?.status || err?.response?.status || 0);');
  const end = server.indexOf('\n  } finally {\n    if (checkoutClient) checkoutClient.release();\n  }\n});\n\n// Derive authoritative subscription start date', start);
  assert.ok(start >= 0 && end > start, 'Subscription catch handler must exist');
  const cases = [
    {stage:'plan_create', err:{statusCode:401,error:'Unauthorized',message:'a secret to hide'}, status:503, code:'razorpay_subscription_access_denied'},
    {stage:'subscription_create',err:{statusCode:403,error:{code:'FORBIDDEN'}},status:503,code:'razorpay_subscription_access_denied'},
    {stage:'subscription_create',err:{statusCode:400,error:{code:'BAD_REQUEST_ERROR',description:'The requested URL was not found on the server.'}},status:503,code:'razorpay_subscription_setup_rejected'},
    {stage:'database_persistence',err:{code:'23505',message:'private database error'},status:503,code:'subscription_requires_reconciliation'},
    {stage:'plan_create',err:{statusCode:500,message:'private upstream error'},status:502,code:'subscription_creation_failed'}
  ];
  for (const entry of cases) {
    const logs = [];
    const context = vm.createContext({
      err:entry.err,
      subscriptionCreationStage:entry.stage,
      razorpayPlanCreated: entry.stage === 'subscription_create',
      classifySubscriptionGatewayError,
      process:{env:{RAZORPAY_KEY_ID:'rzp_test_not_a_real_credential'}},
      request:{log:{error:(value)=>logs.push(value)}},
      reply:{code:(status)=>({send:(body)=>({status,body})})}
    });
    const result = vm.runInContext('(function(){\n' + server.slice(start,end) + '\n})()',context);
    assert.equal(result.status,entry.status);
    assert.equal(result.body.error,entry.code);
    assert.ok(!JSON.stringify(result.body).includes('private'));
    assert.ok(!JSON.stringify(result.body).includes('secret'));
    assert.equal(logs[0].keyMode,'test');
    assert.equal(logs[0].stage,entry.stage);
    assert.ok(['unclassified','subscription_endpoint_unavailable'].includes(logs[0].gatewayReason));
    assert.equal(logs[0].planCreated,entry.stage === 'subscription_create');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const email = fs.readFileSync(new URL('../src/email.js', import.meta.url), 'utf8');

function emailHelpers() {
  const start = email.indexOf('export function publicEmailImageUrl(');
  const end = email.indexOf('/**\n * Format currency helper', start);
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
  const start = email.indexOf('export function buildCustomerOrderEmail(');
  const end = email.indexOf('/**\n * Generate Admin Order Notification Email HTML', start);
  assert.ok(start >= 0 && end > start);
  const { publicEmailImageUrl } = emailHelpers();
  const context = vm.createContext({
    publicEmailImageUrl,
    escapeHtml: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    formatInr: (value, isPaise = false) => {
      const number = isPaise ? Math.round(Number(value) / 100) : Number(value);
      return '₹' + number.toLocaleString('en-IN');
    }
  });
  vm.runInContext(email.slice(start, end).replace('export function', 'function') + '\n;globalThis.build = buildCustomerOrderEmail;', context);
  const html = context.build({
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
  assert.match(html,/Total Paid[\s\S]*?₹1,599/);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../frontend/js/checkout.js', import.meta.url), 'utf8');
const cloudflareCopy = fs.readFileSync(new URL('../frontend/cloudflare-upload/js/checkout.js', import.meta.url), 'utf8');
const checkoutHtml = fs.readFileSync(new URL('../frontend/checkout.html', import.meta.url), 'utf8');

function cartGuard(cart) {
  const start = source.indexOf('  function priorOrderItemsDiffer(');
  const end = source.indexOf('  async function offerSeparateNewCartPayment(', start);
  assert.ok(start !== -1 && end > start, 'Expected the pure cart comparison helpers');
  const context = vm.createContext({
    state: {cart},
    canonicalCheckoutProductName: name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  });
  vm.runInContext(source.slice(start, end) +
    '\n;globalThis.guard = {different: priorOrderItemsDiffer, separate: previousPaymentCanBeSeparated};', context);
  return context.guard;
}

const earlierPaidOrder = {
  order_number: 'MV-20261103-000005',
  payment_status: 'paid',
  order_status: 'payment_review',
  items: [{name:'Buffalo Milk',quantity:1}]
};

test('new cart can be separated from a captured prior order under review', () => {
  const guard = cartGuard([{name:'Pot Curd',quantity:1},{name:'Pure Cow Ghee',quantity:1}]);
  assert.equal(guard.different(earlierPaidOrder), true);
  assert.equal(guard.separate(earlierPaidOrder), true);
});

test('same item and quantity cannot be retried as a new payment', () => {
  const guard = cartGuard([{name:'Buffalo Milk',quantity:1}]);
  assert.equal(guard.different(earlierPaidOrder), false);
  assert.equal(guard.separate(earlierPaidOrder), false);
});

test('different quantity is distinct and item ordering does not affect comparison', () => {
  const guard = cartGuard([{name:'Buffalo Milk',quantity:2}]);
  assert.equal(guard.different(earlierPaidOrder), true);
  const reordered = cartGuard([{name:'Pure Cow Ghee',quantity:1},{name:'Pot Curd',quantity:1}]);
  assert.equal(reordered.different({...earlierPaidOrder, items:[
    {name:'Pot Curd',quantity:1},{name:'Pure Cow Ghee',quantity:1}
  ]}), false);
});

test('uncertain, unpaid, expired or malformed prior orders must not be bypassed', () => {
  const guard = cartGuard([{name:'Pot Curd',quantity:1}]);
  for (const patch of [
    {payment_status:'pending'},
    {payment_status:'expired',order_status:'cancelled'},
    {payment_status:'paid',order_status:'placed'},
    {items:[]},
    {items:[{name:'',quantity:1}]}
  ]) assert.equal(guard.separate({...earlierPaidOrder,...patch}), false);
});

test('recovery needs authenticated original order and preserves payment reference', () => {
  assert.match(source, /async function offerSeparateNewCartPayment\(pending\)/);
  assert.match(source, /previousPaymentCanBeSeparated\(original\)/);
  assert.match(source, /milvanta-prior-payment-review-/);
  assert.match(source, /state.checkoutKey = newCheckoutKey\(\)/);
  assert.match(source, /continueDifferentOrderBtn/);
  assert.match(source, /if \(pendingOrderPayment\) return await reconcilePendingOrderPayment\(pendingOrderPayment\)/);
  assert.equal(source, cloudflareCopy);
  assert.match(checkoutHtml, /20261103-distinct-cart-recovery-3/);
});

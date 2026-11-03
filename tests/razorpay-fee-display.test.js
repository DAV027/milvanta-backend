import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('frontend/checkout.html');
const script = read('frontend/js/checkout.js');
const server = read('src/server.js');

test('checkout displays order total separately from Razorpay convenience fees', () => {
  assert.match(html, /Milvanta order total/);
  assert.match(html, /Razorpay convenience fee \(if applicable\)/);
  assert.match(html, /shown in Razorpay before you confirm payment/i);
  assert.match(script, /checkoutRazorpayFeeNotice/);
  assert.match(script, /Razorpay will display its exact final payable amount before you authorize payment/);
});
test('Razorpay order remains tied to server-authoritative Milvanta amount, with no fee added twice', () => {
  assert.match(script, /if \(serverAmount !== totalAmountPaise\)/);
  assert.match(script, /amount: serverAmount > 0 \? serverAmount : totalAmountPaise/);
  assert.doesNotMatch(script, /currentTotal\s*\*\s*1\.0236/);
});
test('verified Razorpay fee is disclosed only after server returns authenticated payment breakdown', () => {
  assert.match(server, /paymentBreakdown: paymentBreakdown\.matched/);
  assert.match(script, /verifiedPaymentBreakdown = verifyRes\.paymentBreakdown \|\| null/);
  assert.match(script, /successRazorpayChargeReceipt/);
  assert.match(script, /chargedPaise === orderPaise \+ feePaise/);
  assert.match(server, /razorpayCustomerFeeTaxPaise: paymentBreakdown\.customerFeePaise > 0/);
  assert.match(script, /hasVerifiedTax = hasVerifiedCharges/);
  assert.match(script, /GST on Razorpay fee:/);
});
test('primary and Cloudflare upload checkout assets have binary parity', () => {
  assert.equal(html, read('frontend/cloudflare-upload/checkout.html'));
  assert.equal(script, read('frontend/cloudflare-upload/js/checkout.js'));
  assert.match(html, /checkout\.js\?v=20261103-payment-fee-transparency-2/);
});

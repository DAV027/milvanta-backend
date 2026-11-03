import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRazorpayOrderAmount } from '../src/paymentAmount.js';

const captured = (o = {}) => ({
  amount: 12000, fee: 284, tax: 43, currency: 'INR',
  status: 'captured', refund_status: null, amount_refunded: 0, ...o
});

test('exact ₹120 payment is accepted without convenience fee', () => {
  assert.deepEqual(verifyRazorpayOrderAmount(12000, captured()), {
    matched: true, orderAmountPaise: 12000, customerFeePaise: 0
  });
});
test('captured ₹122.84 is accepted only with authentic ₹2.84 fee breakdown', () => {
  assert.deepEqual(verifyRazorpayOrderAmount(12000, captured({amount: 12284})), {
    matched: true, orderAmountPaise: 12000, customerFeePaise: 284
  });
});
test('never accept unexplained overpayment, even exactly 2.36 percent', () => {
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284, fee:null})).matched, false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284, fee:283})).matched, false);
});
test('reject different total, underpayment, non-INR or excessive fee', () => {
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12001,fee:284})).matched, false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:11999})).matched, false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284,currency:'USD'})).matched, false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:24000,fee:12000})).matched, false);
});
test('never accept a surcharge before capture or after full refund', () => {
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284,status:'authorized'})).matched, false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284,refund_status:'full'})).matched, false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284,amount_refunded:12284})).matched, false);
});
test('reject invalid tax metadata', () => {
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284,tax:300})).matched,false);
  assert.equal(verifyRazorpayOrderAmount(12000, captured({amount:12284,tax:-2})).matched,false);
});

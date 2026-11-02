import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-level guardrails only; release requires browser and disposable-DB
// integration tests with real HTTP 401, 200, and Razorpay callback mocks.
const read = path => readFileSync(path, 'utf8');
const checkout = read('frontend/js/checkout.js');
const backend = read('src/server.js');

describe('Milvanta checkout auth and payment recovery safety', () => {
  it('preserves byte-for-byte Cloudflare checkout parity', () => {
    assert.equal(checkout, read('frontend/cloudflare-upload/js/checkout.js'));
  });

  it('requires live /auth/me verification, never cached customer profile alone', () => {
    const start = checkout.indexOf('async function checkAuthAndInit()');
    const end = checkout.indexOf('// Show login required gate', start);
    assert.ok(start >= 0 && end > start);
    const init = checkout.slice(start, end);
    assert.match(init, /const data = await api\('\/api\/v1\/auth\/me'\)/);
    assert.doesNotMatch(init, /customerData = parsed/);
    assert.doesNotMatch(init, /savedUser/);
    assert.match(init, /if \(!authToken\)/);
    assert.match(init, /if \(error.status === 401\)/);
    assert.match(init, /showLoginRequired\(\)/);
  });

  it('returns a typed 401 to the UI and clears stale browser user state', () => {
    assert.match(checkout, /if \(res.status === 401\) \{/);
    assert.match(checkout, /localStorage.removeItem\('milvanta-user'\)/);
    assert.match(checkout, /error.status = res.status/);
    assert.match(checkout, /Your login has expired/);
  });

  it('verifies current session and identity again before opening Razorpay', () => {
    const start = checkout.indexOf('async function executeOrderPayment()');
    const startGateway = checkout.indexOf('await ensureRazorpayScript()', start);
    const authCall = checkout.indexOf("await api('/api/v1/auth/me')", start);
    assert.ok(authCall > start && authCall < startGateway);
    assert.match(checkout.slice(start, startGateway), /verifiedCustomer.id/);
  });

  it('never opens gateway in direct-placement mode or on a mismatched price', () => {
    assert.match(checkout, /if \(order\?\.directMode/);
    assert.match(checkout, /serverAmount !== totalAmountPaise/);
    assert.match(checkout, /no payment was started/i);
  });

  it('preserves unconfirmed Razorpay callbacks and routes retry to status check', () => {
    assert.match(checkout, /PENDING_ORDER_PAYMENT_KEY/);
    assert.match(checkout, /sessionStorage.setItem\(PENDING_ORDER_PAYMENT_KEY/);
    assert.match(checkout, /if \(pendingOrderPayment\) return await reconcilePendingOrderPayment/);
    assert.match(checkout, /Check Payment Status \(no new charge\)/);
    assert.match(checkout, /verifyRes.status !== 'captured'/);
    assert.match(checkout, /GET PAYMENT SAFETY NONEXISTENT|\/api\/v1\/orders\//);
  });

  it('does not create orders with unavailable payment config in production', () => {
    assert.match(backend, /process.env.NODE_ENV === 'production' && \(!razorpay/);
    assert.match(backend, /payments_not_configured/);
  });
});

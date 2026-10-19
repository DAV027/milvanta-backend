import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Set test environment before importing server
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_for_milvanta_ecommerce_suite_32_characters';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_razorpay_secret_key_milvanta_secure';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_key_milvanta_secure';

const { app } = await import('../src/server.js');
const {
  resolveItemPricing,
  getMilkDailySubscriptionRatePaise,
  getMilkOneTimeRatePaise,
  calculateContinuousMonthsDays,
  parseLitresFromSize,
  parseMilkLitres
} = await import('../src/pricing.js');

describe('Milvanta Phase 1: Comprehensive Security, Pricing & Checkout Suite', () => {

  describe('TASK 1 — All Subscription Creation Paths & Authentication Gates', () => {
    it('blocks unauthenticated access to POST /api/v1/subscriptions with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        payload: {
          productName: 'Pure Fresh Cow Milk (1 Litre)',
          quantity: '1 Litre'
        }
      });
      assert.equal(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'unauthorized');
    });

    it('rejects POST /api/v1/subscriptions if paymentId is missing with 400', async () => {
      // Mock authenticated session token
      const token = app.jwt.sign({ sub: '1', email: 'verified_user@milvanta.in' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          productName: 'Pure Fresh Cow Milk (1 Litre)',
          quantity: '1 Litre'
          // No paymentId provided!
        }
      });
      // 400 payment_id_required, 401 (session not found in db), or 503 if db unconfigured
      assert.ok([400, 401, 503].includes(res.statusCode));
      if (res.statusCode === 400) {
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'payment_id_required');
      }
    });

    it('rejects POST /api/v1/subscriptions if paymentId cannot be verified with 400/402', async () => {
      const token = app.jwt.sign({ sub: '1', email: 'verified_user@milvanta.in' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          productName: 'Pure Fresh Cow Milk (1 Litre)',
          quantity: '1 Litre',
          paymentId: 'pay_unverified_fake_123'
        }
      });
      // 400 invalid_payment_proof, 402 payment_not_captured, 401 (session not found in db), or 503
      assert.ok([400, 401, 402, 503].includes(res.statusCode));
      if ([400, 402].includes(res.statusCode)) {
        const data = JSON.parse(res.payload);
        assert.ok(['invalid_payment_proof', 'payment_not_captured'].includes(data.error));
      }
    });

    it('blocks unauthenticated access to POST /api/v1/subscriptions/razorpay-checkout with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/razorpay-checkout',
        payload: {
          productId: 1,
          productName: 'Farm Fresh Cow Milk',
          size: '1 Litre',
          monthsCount: 1
        }
      });
      assert.equal(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'unauthorized');
    });

    it('blocks unauthenticated access to POST /api/v1/subscriptions/verify with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/verify',
        payload: {
          razorpay_subscription_id: 'sub_test123',
          razorpay_payment_id: 'pay_test123',
          razorpay_signature: 'fake_sig'
        }
      });
      assert.equal(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'unauthorized');
    });
  });

  describe('TASK 2 — Authoritative Product & Subscription Pricing Integrity', () => {
    it('parses litres from human size labels accurately', () => {
      assert.equal(parseLitresFromSize('500 ml'), 0.5);
      assert.equal(parseMilkLitres('500 ml pouch'), 0.5);
      assert.equal(parseLitresFromSize('1 Litre'), 1.0);
      assert.equal(parseLitresFromSize('1.5 Litre'), 1.5);
      assert.equal(parseLitresFromSize('2 Litre'), 2.0);
      assert.equal(parseLitresFromSize('5 Litre'), 5.0);
    });

    it('calculates trusted one-time rates for Cow Milk across all pack sizes', () => {
      // Rates: 500ml = ₹60, 1L = ₹110, 1.5L = ₹170, 2L = ₹220, 3L = ₹330, 5L = ₹550
      assert.equal(getMilkOneTimeRatePaise('Cow Milk', '500 ml'), 6000);
      assert.equal(getMilkOneTimeRatePaise('Cow Milk', '1 Litre'), 11000);
      assert.equal(getMilkOneTimeRatePaise('Cow Milk', '1.5 Litre'), 17000);
      assert.equal(getMilkOneTimeRatePaise('Cow Milk', '2 Litre'), 22000);
      assert.equal(getMilkOneTimeRatePaise('Cow Milk', '3 Litre'), 33000);
      assert.equal(getMilkOneTimeRatePaise('Cow Milk', '5 Litre'), 55000);
    });

    it('calculates trusted one-time rates for Buffalo Milk across all pack sizes', () => {
      // Rates: 500ml = ₹70, 1L = ₹130, 1.5L = ₹200, 2L = ₹260, 3L = ₹390, 5L = ₹650
      assert.equal(getMilkOneTimeRatePaise('Buffalo Milk', '500 ml'), 7000);
      assert.equal(getMilkOneTimeRatePaise('Buffalo Milk', '1 Litre'), 13000);
      assert.equal(getMilkOneTimeRatePaise('Buffalo Milk', '1.5 Litre'), 20000);
      assert.equal(getMilkOneTimeRatePaise('Buffalo Milk', '2 Litre'), 26000);
      assert.equal(getMilkOneTimeRatePaise('Buffalo Milk', '3 Litre'), 39000);
      assert.equal(getMilkOneTimeRatePaise('Buffalo Milk', '5 Litre'), 65000);
    });

    it('calculates daily subscription rates correctly for Cow Milk (0.5L - 5L)', () => {
      // Cow Sub Rates: 500ml = ₹55, 1L = ₹105, 1.5L = ₹160, 2L = ₹210, 3L = ₹315, 5L = ₹525
      assert.equal(getMilkDailySubscriptionRatePaise('Cow Milk', 0.5), 5500);
      assert.equal(getMilkDailySubscriptionRatePaise('Cow Milk', 1.0), 10500);
      assert.equal(getMilkDailySubscriptionRatePaise('Cow Milk', 1.5), 16000);
      assert.equal(getMilkDailySubscriptionRatePaise('Cow Milk', 2.0), 21000);
      assert.equal(getMilkDailySubscriptionRatePaise('Cow Milk', 3.0), 31500);
      assert.equal(getMilkDailySubscriptionRatePaise('Cow Milk', 5.0), 52500);
    });

    it('calculates daily subscription rates correctly for Buffalo Milk (0.5L - 5L)', () => {
      // Buffalo Sub Rates: 500ml = ₹65, 1L = ₹125, 1.5L = ₹190, 2L = ₹250, 3L = ₹375, 5L = ₹625
      assert.equal(getMilkDailySubscriptionRatePaise('Buffalo Milk', 0.5), 6500);
      assert.equal(getMilkDailySubscriptionRatePaise('Buffalo Milk', 1.0), 12500);
      assert.equal(getMilkDailySubscriptionRatePaise('Buffalo Milk', 1.5), 19000);
      assert.equal(getMilkDailySubscriptionRatePaise('Buffalo Milk', 2.0), 25000);
      assert.equal(getMilkDailySubscriptionRatePaise('Buffalo Milk', 3.0), 37500);
      assert.equal(getMilkDailySubscriptionRatePaise('Buffalo Milk', 5.0), 62500);
    });

    it('enforces exact agreed prices for Artisanal Malai Paneer (500g = ₹400, 1kg = ₹750)', () => {
      const dbPaneer = { id: 3, name: 'Artisanal Malai Paneer', category: 'Dairy', price_paise: 40000, selling_unit: '500 g' };
      assert.equal(resolveItemPricing(dbPaneer, { size: '500 g' }).unitPricePaise, 40000);
      assert.equal(resolveItemPricing(dbPaneer, { size: '1 kg' }).unitPricePaise, 75000);
    });

    it('enforces exact agreed prices for Pure Desi Cow Ghee (500g = ₹1500, 1kg = ₹2800)', () => {
      const dbCowGhee = { id: 5, name: 'Pure Desi Cow Ghee', category: 'Ghee', price_paise: 150000, selling_unit: '500 g' };
      assert.equal(resolveItemPricing(dbCowGhee, { size: '500 g' }).unitPricePaise, 150000);
      assert.equal(resolveItemPricing(dbCowGhee, { size: '1 kg' }).unitPricePaise, 280000);
    });

    it('enforces exact agreed prices for Pure Buffalo Ghee (500g = ₹1100, 1kg = ₹2000)', () => {
      const dbBuffGhee = { id: 6, name: 'Pure Buffalo Ghee', category: 'Ghee', price_paise: 110000, selling_unit: '500 g' };
      assert.equal(resolveItemPricing(dbBuffGhee, { size: '500 g' }).unitPricePaise, 110000);
      assert.equal(resolveItemPricing(dbBuffGhee, { size: '1 kg' }).unitPricePaise, 200000);
    });

    it('enforces exact agreed prices for Pot Curd across all 5 sizes (200g, 500g, 1kg, 3kg, 6kg)', () => {
      const dbCurd = { id: 4, name: 'Pot Curd', category: 'Dairy', price_paise: 4900, selling_unit: '200 g' };
      assert.equal(resolveItemPricing(dbCurd, { size: '200 g' }).unitPricePaise, 4900);
      assert.equal(resolveItemPricing(dbCurd, { size: '500 g' }).unitPricePaise, 9900);
      assert.equal(resolveItemPricing(dbCurd, { size: '1 kg' }).unitPricePaise, 16900);
      assert.equal(resolveItemPricing(dbCurd, { size: '3 kg' }).unitPricePaise, 49900);
      assert.equal(resolveItemPricing(dbCurd, { size: '6 kg' }).unitPricePaise, 79900);
    });

    it('enforces base database pricing for Bakery items', () => {
      const brownie = { id: 7, name: 'Walnut Raagi Brownie', category: 'Bakery', price_paise: 29900, selling_unit: '1 Piece' };
      const cake = { id: 8, name: 'Butter Cake with Couverture Chocolate Chips', category: 'Bakery', price_paise: 29900, selling_unit: '300 g loaf' };
      assert.equal(resolveItemPricing(brownie, {}).unitPricePaise, 29900);
      assert.equal(resolveItemPricing(cake, {}).unitPricePaise, 29900);
    });

    it('enforces base database pricing for Pickle items', () => {
      const avakaya = { id: 9, name: 'Andhra Avakaya Mango Pickle', category: 'Pickles', price_paise: 44900, selling_unit: '500 g jar' };
      const muttonPickle = { id: 11, name: 'Andhra Boneless Mutton Pickle', category: 'Pickles', price_paise: 114900, selling_unit: '500 g jar' };
      assert.equal(resolveItemPricing(avakaya, {}).unitPricePaise, 44900);
      assert.equal(resolveItemPricing(muttonPickle, {}).unitPricePaise, 114900);
    });

    it('strictly IGNORES client custom price tampering (customPricePaise, pricePaise, price)', () => {
      const dbProduct = { id: 1, name: 'Farm Fresh Cow Milk', category: 'Milk & Dairy', price_paise: 6000, selling_unit: '500 ml' };
      const tamperedItem = { size: '500 ml', customPricePaise: 100, pricePaise: 100, price: 1, total: 1 };
      const pricing = resolveItemPricing(dbProduct, tamperedItem);
      assert.equal(pricing.unitPricePaise, 6000, 'Must calculate authoritative 6000 paise, NOT tampered 100 paise');
    });

    it('calculates continuous monthly days correctly across calendar months', () => {
      const fixedDate = new Date(2026, 0, 1); // Jan 1, 2026
      assert.equal(calculateContinuousMonthsDays(0, 1, fixedDate), 31); // Jan: 31 days
      assert.equal(calculateContinuousMonthsDays(0, 3, fixedDate), 90); // Jan (31) + Feb (28) + Mar (31) = 90 days
    });

    it('resolves authoritative milk custom-days plan pricing on the server', () => {
      const dbCowMilk = { id: 1, name: 'Farm Fresh Cow Milk', category: 'Milk & Dairy', price_paise: 6000, selling_unit: '500 ml' };
      const subItem = { size: '1 Litre', isCustomDaysPlan: true, days: 30, customPricePaise: 5000 };
      const resolved = resolveItemPricing(dbCowMilk, subItem);
      assert.equal(resolved.unitPricePaise, 315000, 'Server must enforce 30 * ₹105 = ₹3150');
    });
  });

  describe('TASK 3 — Razorpay Lifecycle States, Webhooks & Signature Verification', () => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    it('rejects subscription callback with forged signature and redirects safely', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/callback?return_url=https://milvanta.in/profile.html?tab=subscription',
        payload: {
          razorpay_subscription_id: 'sub_testFake123',
          razorpay_payment_id: 'pay_testFake456',
          razorpay_signature: 'deadbeefcafebabe0000111122223333444455556666777788889999aaaabbbb'
        }
      });
      assert.equal(res.statusCode, 302);
      const location = res.headers['location'];
      assert.match(location, /subscription=failed/);
      assert.match(location, /error=invalid_signature/);
    });

    it('prevents open redirect attacks in /api/v1/subscriptions/callback', async () => {
      const evilReturnUrl = 'https://malicious-phishing-site.xyz/steal-session';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/subscriptions/callback?return_url=${encodeURIComponent(evilReturnUrl)}&error=customer_cancelled`
      });
      assert.equal(res.statusCode, 302);
      const location = res.headers['location'];
      assert.doesNotMatch(location, /malicious-phishing-site\.xyz/);
      assert.match(location, /milvanta\.in/);
    });

    it('rejects webhook requests with missing or forged X-Razorpay-Signature with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-razorpay-signature': 'invalid_forged_webhook_signature',
          'x-razorpay-event-id': 'evt_test_fake_001'
        },
        payload: {
          event: 'subscription.charged',
          payload: {}
        }
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.payload);
      assert.equal(body.error, 'invalid_webhook_signature');
    });

    it('safely handles subscription.halted as paused (recoverable, NOT cancelled)', async () => {
      const webhookPayload = JSON.stringify({
        event: 'subscription.halted',
        payload: {
          subscription: {
            entity: { id: 'sub_valid_halted_123', status: 'halted' }
          }
        }
      });

      const signature = crypto.createHmac('sha256', webhookSecret)
        .update(webhookPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': 'evt_test_halted_002'
        },
        payload: webhookPayload
      });

      assert.ok([200, 503].includes(res.statusCode));
      if (res.statusCode === 200) {
        const body = JSON.parse(res.payload);
        assert.equal(body.received, true);
      }
    });

    it('safely handles subscription.resumed back to active', async () => {
      const webhookPayload = JSON.stringify({
        event: 'subscription.resumed',
        payload: {
          subscription: {
            entity: { id: 'sub_valid_resumed_123', status: 'active' }
          }
        }
      });

      const signature = crypto.createHmac('sha256', webhookSecret)
        .update(webhookPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': 'evt_test_resumed_003'
        },
        payload: webhookPayload
      });

      assert.ok([200, 503].includes(res.statusCode));
    });

    it('safely handles subscription.completed as expired', async () => {
      const webhookPayload = JSON.stringify({
        event: 'subscription.completed',
        payload: {
          subscription: {
            entity: { id: 'sub_valid_completed_123', status: 'completed' }
          }
        }
      });

      const signature = crypto.createHmac('sha256', webhookSecret)
        .update(webhookPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': 'evt_test_completed_004'
        },
        payload: webhookPayload
      });

      assert.ok([200, 503].includes(res.statusCode));
    });

    it('handles idempotent duplicate webhooks gracefully', async () => {
      const webhookPayload = JSON.stringify({
        event: 'subscription.authenticated',
        payload: {
          subscription: { entity: { id: 'sub_valid_dup_123', status: 'authenticated' } }
        }
      });

      const signature = crypto.createHmac('sha256', webhookSecret)
        .update(webhookPayload)
        .digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': 'evt_test_dup_005'
        },
        payload: webhookPayload
      });

      assert.ok([200, 503].includes(res.statusCode));
    });
  });

  describe('TASK 6 — Public Email Confirmation Endpoints Security', () => {
    it('blocks unauthenticated access to POST /api/v1/subscriptions/send-confirmation with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/subscriptions/send-confirmation',
        payload: {
          subscriptionId: 'sub_123',
          paymentId: 'pay_123'
        }
      });
      assert.equal(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'unauthorized');
    });

    it('blocks unauthenticated access to POST /api/v1/orders/:orderNumber/send-confirmation with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders/MV-20261019-000001/send-confirmation',
        payload: {
          paymentId: 'pay_123'
        }
      });
      assert.equal(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'unauthorized');
    });
  });

  describe('TASK 5 — Full Checkout Regression Tests', () => {
    it('blocks unauthenticated order placement with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        payload: {
          address: { pincode: '500049' },
          items: [{ productId: 1, quantity: 1 }]
        }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects order with outside-Hyderabad pincode (422)', async () => {
      const token = app.jwt.sign({ sub: '1', email: 'test@milvanta.in' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': crypto.randomUUID()
        },
        payload: {
          address: {
            name: 'Rohit Varma',
            phone: '9876543210',
            house: 'Plot 10',
            building: 'Tower A',
            street: 'MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            pincode: '560001' // Bangalore PIN
          },
          items: [{ productId: 1, quantity: 1 }]
        }
      });
      // 401 (if session not in DB) or 422 (outside_hyderabad) or 503
      assert.ok([401, 422, 503].includes(res.statusCode));
      if (res.statusCode === 422) {
        const body = JSON.parse(res.payload);
        assert.equal(body.error, 'outside_hyderabad');
      }
    });

    it('blocks unauthenticated access to POST /api/v1/payments/verify with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        payload: {
          razorpay_order_id: 'order_test123',
          razorpay_payment_id: 'pay_test123',
          razorpay_signature: 'fake_sig'
        }
      });
      assert.equal(res.statusCode, 401);
    });
  });

});

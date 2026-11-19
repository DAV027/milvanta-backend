import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_startup_ops_test_secret_32_chars_long';
process.env.ADMIN_API_KEY = 'milvanta_disposable_test_admin_key_ops';
process.env.RAZORPAY_KEY_ID = 'rzp_test_disposable_dummy_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_disposable_dummy_secret';

const fixture = await setupDisposableTestSchema();
const { app, razorpay } = await import('../src/server.js');
const pool = fixture.pool;

// Mock Razorpay gateway calls in test environment to prevent real live network calls
if (razorpay) {
  if (razorpay.orders) {
    razorpay.orders.create = async (params) => ({
      id: 'order_mock_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14),
      amount: params.amount,
      currency: params.currency || 'INR',
      status: 'created',
      created_at: Math.floor(Date.now() / 1000)
    });
  }
  if (razorpay.subscriptions) {
    razorpay.subscriptions.create = async (params) => ({
      id: 'sub_mock_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14),
      plan_id: params.plan_id,
      status: 'created',
      quantity: 1,
      total_count: params.total_count || 1,
      paid_count: 0
    });
  }
  if (razorpay.plans) {
    razorpay.plans.create = async (params) => ({
      id: 'plan_mock_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14),
      period: params.period,
      interval: params.interval,
      item: params.item
    });
  }
}

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

let adminCustomer, adminToken;
let customerA, tokenA;
let customerB, tokenB;

const validAddressA = {
  name: 'Customer A',
  phone: '9999900002',
  house: 'Flat 402',
  building: 'Green Towers',
  street: 'Hitech City Main Rd',
  city: 'Hyderabad',
  state: 'Telangana',
  pincode: '500081'
};

const validAddressB = {
  name: 'Customer B',
  phone: '9999900003',
  house: 'Villa 12',
  building: 'Sunrise Enclave',
  street: 'Kondapur Main Rd',
  city: 'Hyderabad',
  state: 'Telangana',
  pincode: '500084'
};

async function createCustomer(fullName, email, phone, isAdmin = false) {
  const res = await pool.query(
    `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, is_admin)
     VALUES ($1, $2, $3, 'salt', 'hash', $4)
     RETURNING id, full_name, email, phone, is_admin`,
    [fullName, email, phone, isAdmin]
  );
  const user = res.rows[0];
  const token = app.jwt.sign({ sub: String(user.id), email: user.email, is_admin: isAdmin, jti: crypto.randomUUID() });
  await pool.query(
    `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '2 hours')`,
    [hash(token), user.id, hash('csrf-' + user.id)]
  );
  return { user, token };
}

before(async () => {
  await app.ready();
  adminCustomer = await createCustomer('Admin Owner', 'owner-ops@milvanta.test', '9999900001', true);
  adminToken = adminCustomer.token;

  customerA = await createCustomer('Customer A', 'customer-a@milvanta.test', '9999900002', false);
  tokenA = customerA.token;

  customerB = await createCustomer('Customer B', 'customer-b@milvanta.test', '9999900003', false);
  tokenB = customerB.token;

  // Insert standard Fresh Milk products if not present
  await pool.query(`
    INSERT INTO products (id, name, category, price_paise, selling_unit, stock_quantity, reserved_stock, active)
    VALUES 
      (101, 'Cow Milk', 'Fresh Milk', 6000, '500 ml', 1000, 0, TRUE),
      (102, 'Buffalo Milk', 'Fresh Milk', 7000, '500 ml', 1000, 0, TRUE)
    ON CONFLICT (id) DO UPDATE SET
      stock_quantity = 1000,
      reserved_stock = 0,
      active = TRUE;
  `);
});

after(async () => {
  await app.close().catch(() => {});
  await cleanupDisposableTestSchema(fixture.pool, fixture.schemaName);
});

describe('1. Milk Capacity Management & Authorization Guards', () => {
  it('rejects unauthenticated requests to /api/v1/admin/milk-capacity with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/milk-capacity?date=2026-11-25' });
    assert.equal(res.statusCode, 401);
  });

  it('rejects non-admin customer requests to /api/v1/admin/milk-capacity with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/milk-capacity?date=2026-11-25',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.equal(res.statusCode, 403);
  });

  it('allows authorized admin to read daily milk capacity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/milk-capacity?date=2026-11-25',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.capacity.cow);
    assert.ok(body.capacity.buffalo);
    assert.equal(body.capacity.cow.availableLitres, 100); // baseline default
    assert.equal(body.capacity.buffalo.availableLitres, 80); // baseline default
  });

  it('allows authorized admin to set date-specific capacity overrides', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        deliveryDate: '2026-11-25',
        cowLitres: 15.0,
        buffaloLitres: 12.0,
        notes: 'Morning test delivery supply'
      }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);

    // Verify GET now returns override
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/milk-capacity?date=2026-11-25',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const cap = getRes.json().capacity;
    assert.equal(cap.cow.availableLitres, 15.0);
    assert.equal(cap.cow.source, 'override');
    assert.equal(cap.buffalo.availableLitres, 12.0);
    assert.equal(cap.buffalo.source, 'override');
  });

  it('allows authorized admin to update baseline defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/defaults',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { cowLitres: 120.0, buffaloLitres: 95.0 }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    // On non-overridden date (e.g. 2026-11-28), baseline defaults reflect new values
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/milk-capacity?date=2026-11-28',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const cap = getRes.json().capacity;
    assert.equal(cap.cow.availableLitres, 120.0);
    assert.equal(cap.cow.source, 'default');
    assert.equal(cap.buffalo.availableLitres, 95.0);
  });

  it('provides public read-only milk capacity for storefront checkout', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/milk-capacity/available?date=2026-11-25'
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.capacity.cow.availableLitres, 15.0);
  });
});

describe('2. Out-of-Stock One-Time Purchase Attempt & Capacity Limits', () => {
  const targetDate = '2026-12-01';

  before(async () => {
    // Set tight override capacity for targetDate: Cow Milk = 2.0 Litres
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: targetDate, cowLitres: 2.0, buffaloLitres: 2.0, notes: 'Tight test capacity' }
    });
  });

  it('rejects one-time order exceeding remaining daily milk capacity with HTTP 409', async () => {
    // Attempt to order 3 x 1 Litre Cow Milk (3.0L > 2.0L available)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        idempotencyKey: crypto.randomUUID(),
        deliveryDate: targetDate,
        items: [
          { productId: 101, name: 'Cow Milk (1 Litre)', quantity: 3, unitPricePaise: 11000, size: '1 Litre' }
        ],
        address: validAddressA
      }
    });

    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.equal(body.error, 'insufficient_capacity');
    assert.match(body.message, /capacity exceeded|exceeds remaining/i);
  });

  it('succeeds when order is within available capacity and decrements remaining capacity', async () => {
    // Order 1 x 1 Litre Cow Milk (1.0L <= 2.0L available)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        idempotencyKey: crypto.randomUUID(),
        deliveryDate: targetDate,
        items: [
          { productId: 101, name: 'Cow Milk (1 Litre)', quantity: 1, unitPricePaise: 11000, size: '1 Litre' }
        ],
        address: validAddressA
      }
    });

    assert.equal(res.statusCode, 201);
    const orderNumber = res.json().orderNumber;
    assert.ok(orderNumber);

    // Check remaining capacity: was 2.0L, now 1.0L remaining
    const capRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/milk-capacity?date=${targetDate}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const cowCap = capRes.json().capacity.cow;
    assert.equal(cowCap.remainingLitres, 1.0);
    assert.equal(cowCap.committedOneTime, 1.0);
  });

  it('rejects subsequent order attempting to purchase more than remaining capacity', async () => {
    // 1.0L remaining. Attempt to order 2 x 1 Litre Cow Milk.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: {
        idempotencyKey: crypto.randomUUID(),
        deliveryDate: targetDate,
        items: [
          { productId: 101, name: 'Cow Milk (1 Litre)', quantity: 2, unitPricePaise: 11000, size: '1 Litre' }
        ],
        address: validAddressB
      }
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'insufficient_capacity');
  });
});

describe('3. Concurrency Protection: Two Simultaneous Customers Competing for Last Available Capacity', () => {
  const raceDate = '2026-12-05';

  before(async () => {
    // Set daily capacity for raceDate to exactly 1.0 Litre Cow Milk
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: raceDate, cowLitres: 1.0, buffaloLitres: 10.0, notes: 'Concurrency test slot' }
    });
  });

  it('serializes concurrent checkout requests with transactional advisory lock: exactly one succeeds, one gets 409', async () => {
    const orderPayloadA = {
      idempotencyKey: crypto.randomUUID(),
      deliveryDate: raceDate,
      items: [{ productId: 101, name: 'Cow Milk', quantity: 1, unitPricePaise: 11000, size: '1 Litre' }],
      address: validAddressA
    };

    const orderPayloadB = {
      idempotencyKey: crypto.randomUUID(),
      deliveryDate: raceDate,
      items: [{ productId: 101, name: 'Cow Milk', quantity: 1, unitPricePaise: 11000, size: '1 Litre' }],
      address: validAddressB
    };

    // Fire both requests simultaneously
    const [resA, resB] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/orders', headers: { Authorization: `Bearer ${tokenA}` }, payload: orderPayloadA }),
      app.inject({ method: 'POST', url: '/api/v1/orders', headers: { Authorization: `Bearer ${tokenB}` }, payload: orderPayloadB })
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(statuses, [201, 409], 'Exactly one customer must receive 201 Created and one must receive 409 Conflict');

    // Confirm remaining capacity on raceDate is exactly 0.0 Litre (no negative oversell)
    const capRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/milk-capacity?date=${raceDate}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const cowCap = capRes.json().capacity.cow;
    assert.equal(cowCap.remainingLitres, 0.0);
    assert.equal(cowCap.committedOneTime, 1.0);
  });
});

describe('4. Subscription Capacity Validation & Safety of Existing Orders', () => {
  it('rejects subscription creation when capacity on start date is exhausted', async () => {
    const { getTomorrowDeliveryDateYMD } = await import('../src/services/deliveryEngine.js');
    const targetSubDate = getTomorrowDeliveryDateYMD();

    // Set 0 capacity override for targetSubDate
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: targetSubDate, cowLitres: 0.0, buffaloLitres: 0.0, notes: 'Zero capacity day' }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/subscriptions/razorpay-checkout',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        productId: 101,
        productName: 'Cow Milk',
        size: '1 Litre',
        monthsCount: 1,
        startOffset: 0
      }
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'insufficient_capacity');
  });

  it('ensures changing daily capacity does not alter or corrupt existing confirmed orders', async () => {
    const safeDate = '2026-12-15';
    // 1. Set initial capacity to 10L
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: safeDate, cowLitres: 10.0, buffaloLitres: 10.0 }
    });

    // 2. Customer orders 2L
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        idempotencyKey: crypto.randomUUID(),
        deliveryDate: safeDate,
        items: [{ productId: 101, name: 'Cow Milk', quantity: 2, unitPricePaise: 11000, size: '1 Litre' }],
        address: validAddressA
      }
    });
    assert.equal(orderRes.statusCode, 201);
    const orderNumber = orderRes.json().orderNumber;

    // 3. Admin alters capacity down to 1.0L on that date
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: safeDate, cowLitres: 1.0, buffaloLitres: 1.0, notes: 'Supply shortage adjustment' }
    });

    // 4. Verify existing order remains confirmed and intact
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderNumber}`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.json().order.order_number, orderNumber);
    assert.equal(verifyRes.json().order.delivery_date, safeDate);
  });
});

describe('5. Subscription Lifecycle: Pause, Resume, Cancellation, Renewal', () => {
  let subId;

  before(async () => {
    // Seed an active customer_subscription for Customer A
    const q = await pool.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_id, product_name, frequency, time_slot,
        quantity, quantity_num, cost_per_day_paise, status, next_delivery
      ) VALUES (
        $1, 101, 'Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
        '1 Litre', 1, 10500, 'active', 'Tomorrow, 6:00 AM'
      ) RETURNING id
    `, [customerA.user.id]);
    subId = q.rows[0].id;
  });

  it('pauses an active subscription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/subscriptions/${subId}/pause`,
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { pauseStartDate: '2026-11-20', pauseEndDate: '2026-11-25' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const check = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [subId]);
    assert.equal(check.rows[0].status, 'paused');
  });

  it('resumes a paused subscription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/subscriptions/${subId}/resume`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const check = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [subId]);
    assert.equal(check.rows[0].status, 'active');
  });

  it('calculates refund eligibility and cancels subscription', async () => {
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subscriptions/${subId}/cancel`,
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { reason: 'Relocating to another city' }
    });
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.json().success, true);

    const check = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [subId]);
    assert.equal(check.rows[0].status, 'cancelled');
  });
});

describe('6. Customer Refund Request & Admin Review Pipeline', () => {
  let paidOrderId, paidOrderNumber, razorpayOrderId, razorpayPaymentId;

  before(async () => {
    paidOrderNumber = 'MV-REFUND-FLOW-' + Date.now();
    razorpayOrderId = 'order_test_rf_' + Date.now();
    razorpayPaymentId = 'pay_test_rf_' + Date.now();

    const q = await pool.query(`
      INSERT INTO customer_orders (
        order_number, customer_id, idempotency_key, address, items,
        subtotal_paise, delivery_charge_paise, total_paise, order_status, payment_status,
        razorpay_order_id, delivery_date
      ) VALUES (
        $1, $2, $3, '{"city":"Hyderabad","street":"Banjara Hills","pincode":"500034"}',
        '[{"productId":101,"name":"Cow Milk (1 Litre)","quantity":1,"pricePaise":11000,"size":"1 Litre"}]',
        11000, 0, 11000, 'delivered', 'paid', $4, '2026-11-20'
      ) RETURNING id
    `, [paidOrderNumber, customerA.user.id, crypto.randomUUID(), razorpayOrderId]);
    paidOrderId = q.rows[0].id;

    await pool.query(`
      INSERT INTO payment_orders (
        razorpay_order_id, razorpay_payment_id, customer_order_id,
        amount_paise, currency, items, status
      ) VALUES (
        $1, $2, $3,
        11000, 'INR', '[{"productId":101,"name":"Cow Milk (1 Litre)","quantity":1,"pricePaise":11000}]', 'captured'
      )
    `, [razorpayOrderId, razorpayPaymentId, paidOrderId]);
  });

  it('checks refund eligibility for customer order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${paidOrderNumber}/refund-eligibility`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.eligible, true);
    assert.equal(body.maxRefundablePaise, 11000);
  });

  it('submits a customer refund request with reason and generates #MV-REFUND- reference', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${paidOrderNumber}/refund-request`,
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        reasonCategory: 'quality_issue',
        notes: 'Pouch packaging was leaking on arrival',
        itemIndices: [0]
      }
    });

    assert.ok(res.statusCode === 200 || res.statusCode === 201);
    const body = res.json();
    assert.equal(body.success, true);
    const refNum = body.refundRequest?.requestNumber || body.refundRequestNumber;
    assert.match(refNum, /^REF-ORD-|^MV-REFUND-/);

    // Order API now reflects pending refund status
    const orderRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${paidOrderNumber}`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.equal(orderRes.statusCode, 200);
    assert.equal(orderRes.json().order.refund_status, 'pending');
    assert.equal(orderRes.json().order.refund_request_number, refNum);
  });

  it('prevents duplicate refund request for the same order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${paidOrderNumber}/refund-request`,
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        reasonCategory: 'quality_issue',
        notes: 'Second attempt should fail'
      }
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().error || res.json().message, /eligible|balance|existing|already/i);
  });

  it('admin reviews refund queue and processes rejection with audit record', async () => {
    // 1. Admin lists refunds
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/refunds?status=pending',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(listRes.statusCode, 200);
    const list = listRes.json().requests || listRes.json().refunds || [];
    const item = list.find(r => r.orderNumber === paidOrderNumber);
    assert.ok(item, 'Refund must appear in admin queue');

    // 2. Admin rejects refund with reason
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/refunds/${item.id}/reject`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { adminNotes: 'Delivery verified intact via proof photo' }
    });
    assert.equal(rejectRes.statusCode, 200);
    assert.equal(rejectRes.json().success, true);

    // 3. Customer order reflects rejected status
    const orderRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${paidOrderNumber}`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.equal(orderRes.json().order.refund_status, 'rejected');
  });
});

describe('7. Frontend File Synchronization & Cloudflare Mirror Parity', () => {
  const files = [
    'admin.html',
    'checkout.html',
    'index.html',
    'profile.html',
    'js/checkout.js',
    'js/profile.js',
    'js/script.js'
  ];

  it('verifies all frontend files are 100% byte-for-byte identical with cloudflare-upload mirror', () => {
    for (const f of files) {
      const live = fs.readFileSync(`frontend/${f}`, 'utf8');
      const mirror = fs.readFileSync(`frontend/cloudflare-upload/${f}`, 'utf8');
      assert.equal(live, mirror, `Parity mismatch in file: ${f}`);
    }
  });

  it('verifies Cloudflare upload zip archives exist and contain packed files', () => {
    assert.ok(fs.existsSync('milvanta-cloudflare-upload.zip'));
    assert.ok(fs.existsSync('frontend/milvanta-cloudflare-upload.zip'));
    const statRoot = fs.statSync('milvanta-cloudflare-upload.zip');
    const statFrontend = fs.statSync('frontend/milvanta-cloudflare-upload.zip');
    assert.ok(statRoot.size > 1000000);
    assert.equal(statRoot.size, statFrontend.size);
  });

  it('verifies storefront only exposes Pure Fresh Milk and hides other product categories', () => {
    const indexHtml = fs.readFileSync('frontend/index.html', 'utf8');
    const scriptJs = fs.readFileSync('frontend/js/script.js', 'utf8');

    // Navigation exposes Fresh Milk
    assert.match(indexHtml, /data-category-nav="Fresh Milk"/);
    // Old categories are removed from navigation
    for (const cat of ['Dairy Products', 'Baking Essentials', 'Healthy Living', 'Indian Pickles']) {
      assert.doesNotMatch(indexHtml, new RegExp(`data-category-nav="${cat}"`));
    }

    // script.js enforces milk-only catalog
    assert.match(scriptJs, /MILK_ONLY_STOREFRONT = true/);
    assert.match(scriptJs, /btn-milk-buy-once/);
    assert.match(scriptJs, /btn-milk-sub/);
  });
});

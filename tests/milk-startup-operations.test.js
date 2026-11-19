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

  it('blocks customer checkout when baseline capacity is unconfirmed', async () => {
    // Reset is_confirmed to false on defaults for testing unconfirmed block
    await pool.query('UPDATE milk_capacity_defaults SET is_confirmed = FALSE');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        idempotencyKey: crypto.randomUUID(),
        deliveryDate: '2026-11-29',
        items: [{ productId: 101, name: 'Cow Milk (1 Litre)', quantity: 1, unitPricePaise: 11000, size: '1 Litre' }],
        address: validAddressA
      }
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'unconfirmed_capacity');
  });

  it('allows authorized admin to explicitly confirm baseline capacity and unlocks sales', async () => {
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/confirm',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(confirmRes.json().success, true);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/milk-capacity/available?date=2026-11-29'
    });
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.json().cow.isConfirmed, true);
    assert.equal(getRes.json().cow.isAvailable, true);
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

  it('rejects subscription creation when capacity is exhausted on Day 15 of 30-day plan', async () => {
    const { getTomorrowDeliveryDateYMD } = await import('../src/services/deliveryEngine.js');
    const startYMD = getTomorrowDeliveryDateYMD();

    // Calculate Day 15
    const [y, m, d] = startYMD.split('-').map(Number);
    const day15Dt = new Date(Date.UTC(y, m - 1, d + 14));
    const day15YMD = day15Dt.toISOString().slice(0, 10);

    // Day 15 has an override of 0.0 Litres
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: day15YMD, cowLitres: 0.0, buffaloLitres: 0.0, notes: 'Day 15 maintenance shutdown' }
    });

    // Make sure start date has plenty of capacity
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: startYMD, cowLitres: 50.0, buffaloLitres: 50.0 }
    });

    // Attempt to purchase 30-day subscription (1 month)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/subscriptions/razorpay-checkout',
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: {
        productId: 101,
        productName: 'Cow Milk',
        size: '1 Litre',
        monthsCount: 1,
        startOffset: 0
      }
    });

    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.equal(body.error, 'insufficient_capacity');
    assert.equal(body.exhaustedDate, day15YMD);
  });

  it('deduplicates capacity calculation when both generated delivery orders and ungenerated subscriptions exist for target date', async () => {
    const testDate = '2026-12-20';

    // Set capacity override for testDate: 50L Cow
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: testDate, cowLitres: 50.0, buffaloLitres: 50.0 }
    });

    // Create 2 active subscriptions in database: sub1 and sub2 (each 2 Litres)
    const sub1 = await pool.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_id, product_name, frequency, time_slot,
        quantity, quantity_num, cost_per_day_paise, status, next_delivery,
        notes
      ) VALUES (
        $1, 101, 'Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
        '2 Litre', 2, 21000, 'active', '2026-12-20, 6:00 AM',
        $2::jsonb
      ) RETURNING id
    `, [customerA.user.id, JSON.stringify({ startDate: '2026-12-01', endDate: '2026-12-31' })]);

    const sub2 = await pool.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_id, product_name, frequency, time_slot,
        quantity, quantity_num, cost_per_day_paise, status, next_delivery,
        notes
      ) VALUES (
        $1, 101, 'Cow Milk', 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
        '3 Litre', 3, 31500, 'active', '2026-12-20, 6:00 AM',
        $2::jsonb
      ) RETURNING id
    `, [customerB.user.id, JSON.stringify({ startDate: '2026-12-01', endDate: '2026-12-31' })]);

    const sub1Id = sub1.rows[0].id;

    // Generate a delivery order ONLY for sub1 on testDate (e.g. ops pre-generated it)
    await pool.query(`
      INSERT INTO subscription_delivery_orders (
        delivery_order_number, subscription_id, customer_id, delivery_date,
        product_id, product_name, quantity, quantity_num, status, delivery_address
      ) VALUES (
        'MV-DO-TEST-DEDUP-1', $1, $2, $3, 101, 'Cow Milk', '2 Litre', 2, 'scheduled', '{"street":"Test St"}'::jsonb
      )
    `, [sub1Id, customerA.user.id, testDate]);

    // Sub1 has a generated delivery order (2L).
    // Sub2 has NO generated order yet, but is an active ungenerated subscription (3L).
    // Total committed should be exactly 2L + 3L = 5L.
    const { getMilkCapacity } = await import('../src/services/milkCapacityService.js');
    const cap = await getMilkCapacity(pool, testDate);

    assert.equal(cap.cow.subscriptionLitres, 5.0, 'Must accurately sum generated order (2L) and ungenerated subscription (3L) to exactly 5L');
    assert.equal(cap.cow.remainingLitres, 45.0, 'Remaining should be 50L - 5L = 45L');
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

  it('rejects resuming a paused subscription when upcoming delivery date capacity is full', async () => {
    // 1. Pause subscription again
    await app.inject({
      method: 'POST',
      url: `/api/v1/subscriptions/${subId}/pause`,
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { pauseStartDate: '2026-11-20', pauseEndDate: '2026-11-25' }
    });

    // 2. Set capacity on the post-resume delivery date to 0.0 Litres
    const { getNowInIST, formatDateYMD } = await import('../src/services/subscriptionService.js');
    const istNow = getNowInIST();
    const resumeTargetDate = istNow.getHours() >= 20
      ? formatDateYMD(new Date(istNow.getTime() + 2 * 86400000))
      : formatDateYMD(new Date(istNow.getTime() + 86400000));

    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: resumeTargetDate, cowLitres: 0.0, buffaloLitres: 0.0, notes: 'Full date' }
    });

    // 3. Attempt to resume
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/subscriptions/${subId}/resume`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'insufficient_capacity_to_resume');

    // 4. Restore capacity on post-resume delivery date
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: resumeTargetDate, cowLitres: 50.0, buffaloLitres: 50.0, notes: 'Restored capacity' }
    });
  });

  it('resumes a paused subscription when capacity is available', async () => {
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

describe('5B. Advanced Reservation Concurrency, Cross-Date Safety & Resumption Competition', () => {
  it('prevents overbooking when two concurrent subscription purchases compete for remaining capacity', async () => {
    const { checkSubscriptionCapacity } = await import('../src/services/milkCapacityService.js');
    const testStartDate = '2026-12-10';

    // Set confirmed capacity for cow milk to 40L baseline
    await pool.query('UPDATE milk_capacity_defaults SET is_confirmed = TRUE, daily_litres = 40');

    const client1 = await pool.connect();
    const client2 = await pool.connect();
    let client1Result = null;
    let client2Result = null;
    let client1Error = null;
    let client2Error = null;

    try {
      // Simulate two concurrent checkouts, each requesting 30L/day for 3 days
      const p1 = (async () => {
        try {
          await client1.query('BEGIN');
          client1Result = await checkSubscriptionCapacity(client1, {
            startDate: testStartDate,
            durationDays: 3,
            milkType: 'cow',
            litresPerDay: 30
          });
          // Commit reservation
          await client1.query(`
            INSERT INTO customer_subscriptions (
              customer_id, product_name, quantity, quantity_num, cost_per_day_paise, status, next_delivery, notes
            ) VALUES (
              $1, 'Pure Fresh Cow Milk', '30 Litre', 30, 315000, 'active', 'Tomorrow, 6:00 AM',
              $2::jsonb
            )
          `, [customerA.user.id, JSON.stringify({ startDate: testStartDate, days: 3, paidThroughDate: '2026-12-12' })]);
          await client1.query('COMMIT');
        } catch (e) {
          await client1.query('ROLLBACK').catch(() => {});
          client1Error = e;
        }
      })();

      const p2 = (async () => {
        try {
          await client2.query('BEGIN');
          client2Result = await checkSubscriptionCapacity(client2, {
            startDate: testStartDate,
            durationDays: 3,
            milkType: 'cow',
            litresPerDay: 30
          });
          await client2.query(`
            INSERT INTO customer_subscriptions (
              customer_id, product_name, quantity, quantity_num, cost_per_day_paise, status, next_delivery, notes
            ) VALUES (
              $1, 'Pure Fresh Cow Milk', '30 Litre', 30, 315000, 'active', 'Tomorrow, 6:00 AM',
              $2::jsonb
            )
          `, [customerB.user.id, JSON.stringify({ startDate: testStartDate, days: 3, paidThroughDate: '2026-12-12' })]);
          await client2.query('COMMIT');
        } catch (e) {
          await client2.query('ROLLBACK').catch(() => {});
          client2Error = e;
        }
      })();

      await Promise.all([p1, p2]);

      // Exactly one must succeed and one must fail with INSUFFICIENT_CAPACITY
      const successCount = (client1Result?.ok ? 1 : 0) + (client2Result?.ok ? 1 : 0);
      assert.equal(successCount, 1, 'Exactly one concurrent subscription purchase must win the capacity');
      const winningError = client1Error || client2Error;
      assert.ok(winningError, 'The competing checkout must receive an error');
      assert.equal(winningError.code, 'INSUFFICIENT_CAPACITY');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('resumed subscription competes transactionally with a new order and prevents overbooking', async () => {
    const testDate = '2027-02-01';

    // Set capacity to 30L for testDate
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/milk-capacity/overrides',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { deliveryDate: testDate, cowLitres: 30.0, buffaloLitres: 30.0, notes: 'Competition test' }
    });

    // 1. Create a paused 10L subscription for Customer B
    const subQ = await pool.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_name, quantity, quantity_num, cost_per_day_paise, status, next_delivery, notes
      ) VALUES (
        $1, 'Pure Fresh Cow Milk', '10 Litre', 10, 105000, 'paused', '2027-02-01, 6:00 AM – 7:00 AM',
        $2::jsonb
      ) RETURNING id
    `, [customerB.user.id, JSON.stringify({ startDate: testDate, days: 1, paidThroughDate: testDate })]);
    const competingSubId = subQ.rows[0].id;

    // 2. Customer A places a one-time order for 22 Litres (leaving only 8L remaining, which is < 10L)
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: {
        address: validAddressA,
        deliveryDate: testDate,
        items: [{ productId: 101, name: 'Pure Fresh Cow Milk', quantity: 22, unitPricePaise: 11000, size: '1 Litre' }],
        idempotencyKey: crypto.randomUUID()
      }
    });
    assert.equal(orderRes.statusCode, 201, 'Order for 22L should succeed');

    // 3. Customer B attempts to resume the 10L subscription on testDate
    const resumeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subscriptions/${competingSubId}/resume`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });

    // Must be rejected because only 8L remains (requires 10L)
    assert.equal(resumeRes.statusCode, 409);
    assert.equal(resumeRes.json().error, 'insufficient_capacity_to_resume');
  });

  it('temporary pending-authorization reservations hold capacity across delivery start and final day', async () => {
    const { getMilkCapacity } = await import('../src/services/milkCapacityService.js');
    const day1YMD = '2027-01-15';
    const day2YMD = '2027-01-16';
    const day3YMD = '2027-01-17';
    const day4YMD = '2027-01-18';

    // Set baseline capacity of 100L
    await pool.query('UPDATE milk_capacity_defaults SET is_confirmed = TRUE, daily_litres = 100');

    // Insert a pending_authorization subscription for 3 days starting 2027-01-15 (duration = 3 days, 15L/day)
    const pendingQ = await pool.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_name, quantity, quantity_num, cost_per_day_paise, status, next_delivery, notes, created_at
      ) VALUES (
        $1, 'Pure Fresh Cow Milk', '15 Litre', 15, 157500, 'pending_authorization', 'Tomorrow, 6:00 AM',
        $2::jsonb, NOW()
      ) RETURNING id
    `, [customerA.user.id, JSON.stringify({ startDate: day1YMD, days: 3 })]);
    const pendingId = pendingQ.rows[0].id;

    try {
      // Day 1 (start date): must hold 15L reservation
      const cap1 = await getMilkCapacity(pool, day1YMD);
      assert.equal(cap1.cow.subscriptionLitres, 15.0);
      assert.equal(cap1.cow.remainingLitres, 85.0);

      // Day 2 (middle date): must hold 15L reservation
      const cap2 = await getMilkCapacity(pool, day2YMD);
      assert.equal(cap2.cow.subscriptionLitres, 15.0);
      assert.equal(cap2.cow.remainingLitres, 85.0);

      // Day 3 (final delivery day): must hold 15L reservation
      const cap3 = await getMilkCapacity(pool, day3YMD);
      assert.equal(cap3.cow.subscriptionLitres, 15.0);
      assert.equal(cap3.cow.remainingLitres, 85.0);

      // Day 4 (beyond final day): must NOT hold reservation
      const cap4 = await getMilkCapacity(pool, day4YMD);
      assert.equal(cap4.cow.subscriptionLitres, 0.0);
      assert.equal(cap4.cow.remainingLitres, 100.0);
    } finally {
      await pool.query('DELETE FROM customer_subscriptions WHERE id = $1', [pendingId]);
    }
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

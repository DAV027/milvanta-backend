/**
 * MILVANTA — PostgreSQL Concurrency & Delivery Integration Test Suite
 * 
 * Tests actual PostgreSQL service functions:
 * - skipDeliveryDate()
 * - unskipDeliveryDate()
 * - getSubscriptionCalendar()
 * - setVacation()
 * - resumeSubscription()
 * 
 * Verifies real PostgreSQL transactions, constraint enforcement, and concurrency safety.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import {
  skipDeliveryDate,
  unskipDeliveryDate,
  getSubscriptionCalendar,
  setVacation,
  resumeSubscription,
  formatDateYMD
} from '../src/services/subscriptionService.js';

describe('Milvanta Real PostgreSQL Delivery Calendar & Concurrency Integration Suite', () => {
  let setup;
  let pool;
  let schemaName;

  let customerId;
  let subscriptionId;

  // Generate test dates relative to today in IST
  const getFutureYMD = (daysAhead) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return formatDateYMD(d);
  };

  before(async () => {
    assertTestDatabaseConfigured();
    setup = await setupDisposableTestSchema();
    pool = setup.pool;
    schemaName = setup.schemaName;

    console.log(`\n========================================================================`);
    console.log(`[PostgreSQL Integration] Connected to '${setup.connectedDb}' on port ${setup.serverPort}`);
    console.log(`[PostgreSQL Integration] Disposable schema: '${schemaName}'`);
    console.log(`========================================================================\n`);

    // 1. Seed Customer
    const custRes = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash)
       VALUES ('Integration Test Customer', 'test.calendar.integration@milvanta.in', '+919876543299', 'salt', 'hash')
       RETURNING id`
    );
    customerId = custRes.rows[0].id;

    // 2. Seed Customer Address
    await pool.query(
      `INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
       VALUES ($1, 'fp_test_123', 'Integration Test Customer', '+919876543299', 'Plot 99', 'Milvanta Enclave', 'Jubilee Hills Road 36', 'Near Hub', 'Hyderabad', 'Telangana', '500081', true)`,
      [customerId]
    );

    // 3. Seed Paid, Active Customer Subscription
    const subRes = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, plan_type, product_id, product_name, quantity, cost_per_day_paise, total_amount_paise,
         status, notes, created_at, updated_at
       ) VALUES (
         $1, 'daily', 1, 'Buffalo Milk', '1 Litre', 9000, 270000,
         'active', $2::jsonb, NOW(), NOW()
       ) RETURNING id`,
      [
        customerId,
        JSON.stringify({
          fulfillmentEntitled: true,
          paidThroughDate: '2026-12-31',
          startDate: '2026-10-01',
          paidCount: 3,
          months: 3
        })
      ]
    );
    subscriptionId = subRes.rows[0].id;
  });

  after(async () => {
    if (setup) {
      await cleanupDisposableTestSchema(setup);
      console.log(`[PostgreSQL Integration] Cleaned up disposable schema: '${schemaName}'`);
    }
  });

  // -------------------------------------------------------------------------
  // Test A — Single Skip
  // -------------------------------------------------------------------------
  it('Test A — Single Skip: records skip, adds 1 positive billing adjustment, cancels order, reports skipped in calendar', async () => {
    const testDate = getFutureYMD(4);

    // Seed scheduled order
    await pool.query(
      `INSERT INTO subscription_delivery_orders (
         delivery_order_number, subscription_id, customer_id, delivery_date, product_name, quantity, status, delivery_address
       ) VALUES ($1, $2, $3, $4, 'Buffalo Milk', '1 Litre', 'scheduled', '{"city":"Hyderabad"}'::jsonb)`,
      [`ORD-TEST-A-${Date.now()}`, subscriptionId, customerId, testDate]
    );

    const skipRes = await skipDeliveryDate(pool, {
      subscriptionId,
      customerId,
      skipDate: testDate,
      reason: 'Out of town for festival'
    });

    assert.strictEqual(skipRes.success, true);
    assert.strictEqual(skipRes.alreadySkipped, false);

    // 1. Verify skip record
    const { rows: skipRows } = await pool.query(
      'SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(skipRows.length, 1);
    assert.strictEqual(skipRows[0].reason, 'Out of town for festival');

    // 2. Verify positive billing adjustment
    const { rows: adjRows } = await pool.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND notes LIKE $2',
      [subscriptionId, `%${testDate}%`]
    );
    assert.strictEqual(adjRows.length, 1);
    assert.strictEqual(adjRows[0].adjustment_type, 'extension');
    assert.strictEqual(adjRows[0].days_count, 1);
    assert.strictEqual(adjRows[0].amount_paise, 9000);

    // 3. Verify cancelled delivery order
    const { rows: ordRows } = await pool.query(
      'SELECT * FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(ordRows.length, 1);
    assert.strictEqual(ordRows[0].status, 'cancelled');
    assert.strictEqual(ordRows[0].failed_reason, 'Delivery date skipped by customer');

    // 4. Verify calendar reports status = 'skipped'
    const cal = await getSubscriptionCalendar(pool, {
      subscriptionId,
      customerId,
      year: new Date(testDate).getFullYear(),
      month: new Date(testDate).getMonth()
    });
    const day = cal.days.find(d => d.date === testDate);
    assert.ok(day);
    assert.strictEqual(day.status, 'skipped');
    assert.strictEqual(day.detail, 'Out of town for festival');
  });

  // -------------------------------------------------------------------------
  // Test B — Duplicate Skip
  // -------------------------------------------------------------------------
  it('Test B — Duplicate Skip: calling skip 3 times for same date creates exactly 1 adjustment and reports alreadySkipped', async () => {
    const testDate = getFutureYMD(5);

    await pool.query(
      `INSERT INTO subscription_delivery_orders (
         delivery_order_number, subscription_id, customer_id, delivery_date, product_name, quantity, status, delivery_address
       ) VALUES ($1, $2, $3, $4, 'Buffalo Milk', '1 Litre', 'scheduled', '{"city":"Hyderabad"}'::jsonb)`,
      [`ORD-TEST-B-${Date.now()}`, subscriptionId, customerId, testDate]
    );

    const call1 = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate, reason: 'Duplicate test 1' });
    const call2 = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate, reason: 'Duplicate test 2' });
    const call3 = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate, reason: 'Duplicate test 3' });

    assert.strictEqual(call1.success, true);
    assert.strictEqual(call1.alreadySkipped, false);

    assert.strictEqual(call2.success, true);
    assert.strictEqual(call2.alreadySkipped, true, 'Call 2 must report alreadySkipped');

    assert.strictEqual(call3.success, true);
    assert.strictEqual(call3.alreadySkipped, true, 'Call 3 must report alreadySkipped');

    // Verify database state: strictly 1 skip record and 1 adjustment
    const { rows: skipRows } = await pool.query(
      'SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(skipRows.length, 1);

    const { rows: adjRows } = await pool.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND notes LIKE $2',
      [subscriptionId, `%${testDate}%`]
    );
    assert.strictEqual(adjRows.length, 1, 'Must create strictly 1 positive adjustment for date B');
    assert.strictEqual(adjRows[0].days_count, 1);
  });

  // -------------------------------------------------------------------------
  // Test C — Concurrent Skip
  // -------------------------------------------------------------------------
  it('Test C — Concurrent Skip: 5 simultaneous connections execute skip; exactly 1 positive adjustment recorded with no duplicates', async () => {
    const testDate = getFutureYMD(6);

    await pool.query(
      `INSERT INTO subscription_delivery_orders (
         delivery_order_number, subscription_id, customer_id, delivery_date, product_name, quantity, status, delivery_address
       ) VALUES ($1, $2, $3, $4, 'Buffalo Milk', '1 Litre', 'scheduled', '{"city":"Hyderabad"}'::jsonb)`,
      [`ORD-TEST-C-${Date.now()}`, subscriptionId, customerId, testDate]
    );

    // Acquire 5 separate physical PostgreSQL connections
    const clients = await Promise.all([
      pool.connect(),
      pool.connect(),
      pool.connect(),
      pool.connect(),
      pool.connect()
    ]);

    let results;
    try {
      // Execute 5 simultaneous skip requests concurrently
      results = await Promise.all(
        clients.map((client, idx) =>
          skipDeliveryDate(client, {
            subscriptionId,
            customerId,
            skipDate: testDate,
            reason: `Concurrent skip attempt ${idx + 1}`
          })
        )
      );
    } finally {
      clients.forEach(c => c.release());
    }

    // Every call must succeed safely
    for (const r of results) {
      assert.strictEqual(r.success, true);
    }

    // Exactly one connection must have performed the initial insert
    const newlySkippedCount = results.filter(r => r.alreadySkipped === false).length;
    const alreadySkippedCount = results.filter(r => r.alreadySkipped === true).length;

    assert.strictEqual(newlySkippedCount, 1, 'Exactly 1 concurrent request must report newly skipped');
    assert.strictEqual(alreadySkippedCount, 4, 'Exactly 4 concurrent requests must report alreadySkipped');

    // Database state checks: strictly 1 row in skipped dates, 1 adjustment, 1 event
    const { rows: skipRows } = await pool.query(
      'SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(skipRows.length, 1, 'Strictly 1 skip row in database');

    const { rows: adjRows } = await pool.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND notes LIKE $2',
      [subscriptionId, `%${testDate}%`]
    );
    assert.strictEqual(adjRows.length, 1, 'Strictly 1 billing adjustment for concurrent date');
    assert.strictEqual(adjRows[0].days_count, 1);

    const { rows: eventRows } = await pool.query(
      `SELECT * FROM subscription_events WHERE subscription_id = $1 AND event_type = 'delivery_date_skipped' AND payload->>'skipDate' = $2`,
      [subscriptionId, testDate]
    );
    assert.strictEqual(eventRows.length, 1, 'Strictly 1 domain event for concurrent date');
  });

  // -------------------------------------------------------------------------
  // Test D — Unskip
  // -------------------------------------------------------------------------
  it('Test D — Unskip: resumes skipped date, removes skip row, records 1 negative adjustment, restores order to scheduled', async () => {
    // Unskip the date from Test A
    const testDate = getFutureYMD(4);

    const unskipRes = await unskipDeliveryDate(pool, {
      subscriptionId,
      customerId,
      skipDate: testDate
    });

    assert.strictEqual(unskipRes.success, true);
    assert.strictEqual(unskipRes.alreadyUnskipped, false);

    // 1. Verify skip record is removed
    const { rows: skipRows } = await pool.query(
      'SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(skipRows.length, 0, 'Skip record must be deleted');

    // 2. Verify negative billing adjustment
    const { rows: adjRows } = await pool.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND notes LIKE $2 ORDER BY id DESC',
      [subscriptionId, `%${testDate}%`]
    );
    assert.strictEqual(adjRows.length, 2, 'Must have 1 positive and 1 negative adjustment');
    assert.strictEqual(adjRows[0].days_count, -1, 'Latest adjustment must be -1 day');
    assert.strictEqual(adjRows[0].amount_paise, -9000);

    // 3. Verify delivery order restored to scheduled
    const { rows: ordRows } = await pool.query(
      'SELECT * FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(ordRows.length, 1);
    assert.strictEqual(ordRows[0].status, 'scheduled', 'Order must be restored to scheduled');
    assert.strictEqual(ordRows[0].failed_reason, null);

    // 4. Verify calendar reports status = 'scheduled'
    const cal = await getSubscriptionCalendar(pool, {
      subscriptionId,
      customerId,
      year: new Date(testDate).getFullYear(),
      month: new Date(testDate).getMonth()
    });
    const day = cal.days.find(d => d.date === testDate);
    assert.ok(day);
    assert.strictEqual(day.status, 'scheduled');
  });

  // -------------------------------------------------------------------------
  // Test E — Duplicate and Concurrent Unskip
  // -------------------------------------------------------------------------
  it('Test E — Duplicate and Concurrent Unskip: 5 simultaneous connections execute unskip; exactly 1 negative adjustment recorded with no duplicates', async () => {
    // Unskip the date from Test C (currently skipped)
    const testDate = getFutureYMD(6);

    const clients = await Promise.all([
      pool.connect(),
      pool.connect(),
      pool.connect(),
      pool.connect(),
      pool.connect()
    ]);

    let results;
    try {
      results = await Promise.all(
        clients.map((client) =>
          unskipDeliveryDate(client, {
            subscriptionId,
            customerId,
            skipDate: testDate
          })
        )
      );
    } finally {
      clients.forEach(c => c.release());
    }

    for (const r of results) {
      assert.strictEqual(r.success, true);
    }

    const newlyUnskippedCount = results.filter(r => r.alreadyUnskipped === false).length;
    const alreadyUnskippedCount = results.filter(r => r.alreadyUnskipped === true).length;

    assert.strictEqual(newlyUnskippedCount, 1, 'Exactly 1 concurrent unskip should remove the row');
    assert.strictEqual(alreadyUnskippedCount, 4, 'Exactly 4 concurrent unskips should report alreadyUnskipped');

    // Repeated sequential call
    const repeatUnskip = await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate });
    assert.strictEqual(repeatUnskip.success, true);
    assert.strictEqual(repeatUnskip.alreadyUnskipped, true);

    // Database verification: exactly 1 positive and 1 negative adjustment
    const { rows: adjRows } = await pool.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND notes LIKE $2',
      [subscriptionId, `%${testDate}%`]
    );
    assert.strictEqual(adjRows.length, 2);
    const sumDays = adjRows.reduce((acc, r) => acc + r.days_count, 0);
    assert.strictEqual(sumDays, 0, 'Net billing adjustment must be zero');

    // Order must be restored
    const { rows: ordRows } = await pool.query(
      'SELECT * FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(ordRows[0].status, 'scheduled');
    assert.strictEqual(ordRows[0].failed_reason, null);
  });

  // -------------------------------------------------------------------------
  // Test F — Full Cycle
  // -------------------------------------------------------------------------
  it('Test F — Full Cycle: Skip -> Unskip -> Skip -> Unskip achieves zero net billing and exactly 2 positive / 2 negative adjustments', async () => {
    const testDate = getFutureYMD(7);

    await pool.query(
      `INSERT INTO subscription_delivery_orders (
         delivery_order_number, subscription_id, customer_id, delivery_date, product_name, quantity, status, delivery_address
       ) VALUES ($1, $2, $3, $4, 'Buffalo Milk', '1 Litre', 'scheduled', '{"city":"Hyderabad"}'::jsonb)`,
      [`ORD-TEST-F-${Date.now()}`, subscriptionId, customerId, testDate]
    );

    // 1. Skip 1
    const s1 = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate, reason: 'Cycle 1' });
    assert.strictEqual(s1.alreadySkipped, false);

    // 2. Unskip 1
    const u1 = await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate });
    assert.strictEqual(u1.alreadyUnskipped, false);

    // 3. Skip 2
    const s2 = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate, reason: 'Cycle 2' });
    assert.strictEqual(s2.alreadySkipped, false);

    // 4. Unskip 2
    const u2 = await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: testDate });
    assert.strictEqual(u2.alreadyUnskipped, false);

    // Check adjustments
    const { rows: adjRows } = await pool.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND notes LIKE $2 ORDER BY id ASC',
      [subscriptionId, `%${testDate}%`]
    );
    assert.strictEqual(adjRows.length, 4, 'Must have exactly 4 adjustments in full cycle');
    assert.deepStrictEqual(adjRows.map(r => r.days_count), [1, -1, 1, -1]);

    const netAmount = adjRows.reduce((sum, r) => sum + r.amount_paise, 0);
    assert.strictEqual(netAmount, 0, 'Net paise adjustment must be 0');

    // Final order status
    const { rows: ordRows } = await pool.query(
      'SELECT status, failed_reason FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(ordRows[0].status, 'scheduled');
    assert.strictEqual(ordRows[0].failed_reason, null);

    // Skip table must be empty for testDate
    const { rows: skipRows } = await pool.query(
      'SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, testDate]
    );
    assert.strictEqual(skipRows.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test G — Vacation Lifecycle
  // -------------------------------------------------------------------------
  it('Test G — Vacation Lifecycle: vacation pause marks calendar dates as vacation; resume clears vacation from future eligible dates', async () => {
    const vacStart = getFutureYMD(8);
    const vacEnd = getFutureYMD(11);

    // 1. Set vacation
    const vacRes = await setVacation(pool, {
      subscriptionId,
      customerId,
      startDate: vacStart,
      endDate: vacEnd,
      reason: 'Outstation holiday'
    });
    assert.strictEqual(vacRes.success, true);

    // Verify active pause record exists
    const { rows: pauseRows } = await pool.query(
      'SELECT * FROM subscription_delivery_pauses WHERE subscription_id = $1 AND resumed_at IS NULL',
      [subscriptionId]
    );
    assert.strictEqual(pauseRows.length, 1);
    assert.strictEqual(pauseRows[0].resumed_at, null);

    // Calendar during vacation shows vacation
    const calDuring = await getSubscriptionCalendar(pool, {
      subscriptionId,
      customerId,
      year: new Date(vacStart).getFullYear(),
      month: new Date(vacStart).getMonth()
    });
    const vacDay = calDuring.days.find(d => d.date === vacStart);
    assert.ok(vacDay);
    assert.strictEqual(vacDay.status, 'vacation');

    // 2. Resume subscription
    const resumeRes = await resumeSubscription(pool, { subscriptionId, customerId });
    assert.strictEqual(resumeRes.success, true);

    // Verify pause record was closed with resumed_at timestamp
    const { rows: closedPauses } = await pool.query(
      'SELECT * FROM subscription_delivery_pauses WHERE subscription_id = $1 AND resumed_at IS NOT NULL',
      [subscriptionId]
    );
    assert.strictEqual(closedPauses.length, 1);
    assert.ok(closedPauses[0].resumed_at instanceof Date);

    // Verify future dates in range NO LONGER show vacation
    const calAfter = await getSubscriptionCalendar(pool, {
      subscriptionId,
      customerId,
      year: new Date(vacStart).getFullYear(),
      month: new Date(vacStart).getMonth()
    });
    const resumedDay = calAfter.days.find(d => d.date === vacStart);
    assert.ok(resumedDay);
    assert.strictEqual(resumedDay.status, 'scheduled', 'Resumed future date must show scheduled, not vacation');
  });

  // -------------------------------------------------------------------------
  // Test H — Safety & Boundary Enforcement
  // -------------------------------------------------------------------------
  it('Test H — Safety: rejects unauthorized customer, cancelled subscription, past date, beyond entitlement, and preserves operational cancellations', async () => {
    const validFuture = getFutureYMD(12);

    // 1. Unauthorized customer (wrong owner)
    const skipWrongOwner = await skipDeliveryDate(pool, { subscriptionId, customerId: 99999, skipDate: validFuture });
    assert.strictEqual(skipWrongOwner.success, false);
    assert.strictEqual(skipWrongOwner.error, 'subscription_not_found');

    const unskipWrongOwner = await unskipDeliveryDate(pool, { subscriptionId, customerId: 99999, skipDate: validFuture });
    assert.strictEqual(unskipWrongOwner.success, false);
    assert.strictEqual(unskipWrongOwner.error, 'subscription_not_found');

    // 2. Cancelled subscription rejection
    const cancelledSubRes = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, plan_type, product_name, quantity, cost_per_day_paise, total_amount_paise, status, notes
       ) VALUES ($1, 'daily', 'Buffalo Milk', '1 Litre', 9000, 270000, 'cancelled', '{"fulfillmentEntitled":false}'::jsonb)
       RETURNING id`,
      [customerId]
    );
    const cancelledSubId = cancelledSubRes.rows[0].id;

    const skipCancelled = await skipDeliveryDate(pool, { subscriptionId: cancelledSubId, customerId, skipDate: validFuture });
    assert.strictEqual(skipCancelled.success, false);
    assert.strictEqual(skipCancelled.error, 'cannot_modify_cancelled_subscription');

    const unskipCancelled = await unskipDeliveryDate(pool, { subscriptionId: cancelledSubId, customerId, skipDate: validFuture });
    assert.strictEqual(unskipCancelled.success, false);
    assert.strictEqual(unskipCancelled.error, 'cannot_modify_cancelled_subscription');

    // 3. Past delivery date rejection
    const skipPast = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: '2025-01-01' });
    assert.strictEqual(skipPast.success, false);
    assert.strictEqual(skipPast.error, 'cutoff_passed');

    const unskipPast = await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: '2025-01-01' });
    assert.strictEqual(unskipPast.success, false);
    assert.strictEqual(unskipPast.error, 'cutoff_passed');

    // 4. Date beyond paid entitlement rejection (subscription paid through 2026-12-31)
    const skipBeyond = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: '2027-02-15' });
    assert.strictEqual(skipBeyond.success, false);
    assert.strictEqual(skipBeyond.error, 'beyond_entitlement');

    const unskipBeyond = await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: '2027-02-15' });
    assert.strictEqual(unskipBeyond.success, false);
    assert.strictEqual(unskipBeyond.error, 'beyond_entitlement');

    // 5. Invalid date format rejection
    const skipInvalid = await skipDeliveryDate(pool, { subscriptionId, customerId, skipDate: 'invalid-date' });
    assert.strictEqual(skipInvalid.success, false);
    assert.strictEqual(skipInvalid.error, 'invalid_date_format');

    const unskipInvalid = await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: '' });
    assert.strictEqual(unskipInvalid.success, false);
    assert.strictEqual(unskipInvalid.error, 'invalid_date_format');

    // 6. Preservation of operational cancellations, delivered, and failed orders
    const opDate = getFutureYMD(14);
    await pool.query(
      `INSERT INTO subscription_delivery_orders (
         delivery_order_number, subscription_id, customer_id, delivery_date, product_name, quantity, status, failed_reason, delivery_address
       ) VALUES ($1, $2, $3, $4, 'Buffalo Milk', '1 Litre', 'cancelled', 'Cancelled by operational hub dispatcher', '{"city":"Hyderabad"}'::jsonb)`,
      [`ORD-TEST-OP-${Date.now()}`, subscriptionId, customerId, opDate]
    );

    // Attempting unskip on this date must NOT touch the operational cancellation
    await unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate: opDate });

    const { rows: opCheck } = await pool.query(
      'SELECT status, failed_reason FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
      [subscriptionId, opDate]
    );
    assert.strictEqual(opCheck[0].status, 'cancelled', 'Operational cancellation must NEVER be converted to scheduled');
    assert.strictEqual(opCheck[0].failed_reason, 'Cancelled by operational hub dispatcher');
  });
});

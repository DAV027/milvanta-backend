import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import assert from 'node:assert/strict';
import {
  pauseSubscription,
  resumeSubscription,
  skipDeliveryDate,
  unskipDeliveryDate,
  setVacation,
  getSubscriptionCalendar,
  formatDateYMD
} from '../src/services/subscriptionService.js';
import {
  generateDailyDeliveries,
  getDailyDeliveries,
  updateDeliveryStatus,
  getTomorrowDeliveryDateYMD
} from '../src/services/deliveryEngine.js';
import {
  queueNotification,
  processNotificationOutbox,
  mockTwilioStore
} from '../src/services/twilioService.js';

const { Pool } = pg;

const rawDbUrl = (
  process.env.DATABASE_URL ||
  process.env.INTERNAL_DATABASE_URL ||
  process.env.EXTERNAL_DATABASE_URL ||
  process.env.POSTGRES_URL
)?.trim().replace(/^["']|["']$/g, '');

if (!rawDbUrl) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: rawDbUrl,
  ssl: { rejectUnauthorized: false }
});

const schemaName = `disposable_staging_int_${Date.now()}`;

console.log(`\n================================================================`);
console.log(`Milvanta Stage 4: Real PostgreSQL Isolated Database Integration`);
console.log(`Target isolated schema: "${schemaName}"`);
console.log(`================================================================\n`);

async function run() {
  const client = await pool.connect();
  try {
    // -------------------------------------------------------------
    // Step 1: Create isolated schema & set search_path
    // -------------------------------------------------------------
    console.log(`[Step 1] Creating isolated test schema: ${schemaName}...`);
    await client.query(`CREATE SCHEMA ${schemaName};`);
    await client.query(`SET search_path TO ${schemaName}, public;`);
    console.log(`   ✓ Isolated schema created and search_path set.`);

    // -------------------------------------------------------------
    // Step 2: Apply Migrations 001 through 013 in order
    // -------------------------------------------------------------
    console.log(`[Step 2] Applying migrations 001 through 013 in exact order...`);
    const migrationsDir = path.resolve('migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`   Applying ${file}...`);
      await client.query(sql);
    }
    console.log(`   ✓ All 13 migrations applied cleanly.`);

    // -------------------------------------------------------------
    // Step 3: Seed Products, Customer, and Address
    // -------------------------------------------------------------
    console.log(`[Step 3] Seeding test customer & products...`);
    const custRes = await client.query(`
      INSERT INTO customers (full_name, email, phone, password_hash, password_salt)
      VALUES ('Rajesh Kumar', 'rajesh.kumar@milvanta.test', '+919876543210', 'dummy_hash', 'dummy_salt')
      RETURNING id, phone;
    `);
    const customerId = custRes.rows[0].id;
    const customerPhone = custRes.rows[0].phone;

    await client.query(`
      INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
      VALUES ($1, 'fp_test_123', 'Rajesh Kumar', '+919876543210', 'Plot 42', 'Milvanta Enclave', 'Jubilee Hills Road 36', 'Near Metro Pillar 18', 'Hyderabad', 'Telangana', '500081', true);
    `, [customerId]);

    const prodRes = await client.query(`
      INSERT INTO products (name, description, category, price_paise, selling_unit)
      VALUES
        ('Pure Fresh Cow Milk', 'Fresh raw cow milk', 'milk', 10500, '1 Litre'),
        ('Pure Buffalo Milk', 'Fresh raw buffalo milk', 'milk', 6500, '500 ml')
      RETURNING id, name;
    `);
    const cowProdId = prodRes.rows[0].id;
    const bufProdId = prodRes.rows[1].id;
    console.log(`   ✓ Seeded customer (ID: ${customerId}) and products.`);

    // -------------------------------------------------------------
    // Step 4: Create 2 Subscriptions (Cow Milk & Buffalo Milk)
    // -------------------------------------------------------------
    console.log(`[Step 4] Creating Cow Milk & Buffalo Milk subscriptions...`);
    const subRes = await client.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_id, product_name, frequency, time_slot, quantity, cost_per_day_paise,
        status, plan_type, duration_label, total_amount_paise, notes
      ) VALUES
        ($1, $2, 'Pure Fresh Cow Milk (1 Litre)', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 10500, 'active', 'prepaid', '30 Days', 315000, '{"subscriptionId":"sub_cow_101"}'::jsonb),
        ($1, $3, 'Pure Buffalo Milk (500 ml)', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '500 ml', 6500, 'active', 'prepaid', '30 Days', 195000, '{"subscriptionId":"sub_buf_202"}'::jsonb)
      RETURNING id, product_name, status, cost_per_day_paise;
    `, [customerId, cowProdId, bufProdId]);

    const cowSubId = subRes.rows[0].id;
    const bufSubId = subRes.rows[1].id;
    assert.equal(subRes.rows.length, 2);
    console.log(`   ✓ Created Subscriptions: Cow Milk (ID: ${cowSubId}), Buffalo Milk (ID: ${bufSubId})`);

    // -------------------------------------------------------------
    // Step 5: Scenario 1 — PAUSE Cow Milk Subscription
    // -------------------------------------------------------------
    console.log(`[Step 5] Scenario 1: Pausing Cow Milk subscription...`);
    const pauseRes = await pauseSubscription(client, {
      subscriptionId: cowSubId,
      customerId,
      reason: 'Travelling out of station'
    });
    assert.equal(pauseRes.success, true);
    assert.equal(pauseRes.status, 'paused');

    // Verify database state for paused Cow Milk sub
    const checkCowPaused = await client.query('SELECT status, next_delivery FROM customer_subscriptions WHERE id = $1', [cowSubId]);
    assert.equal(checkCowPaused.rows[0].status, 'paused');
    assert.equal(checkCowPaused.rows[0].next_delivery, 'On Hold (Paused)');

    const pauseRecords = await client.query('SELECT * FROM subscription_delivery_pauses WHERE subscription_id = $1', [cowSubId]);
    assert.equal(pauseRecords.rows.length, 1);
    assert.equal(pauseRecords.rows[0].resumed_at, null);
    console.log(`   ✓ Cow Milk subscription successfully paused and confirmed in database.`);

    // -------------------------------------------------------------
    // Step 6: Scenario 2 — SKIP a Delivery Date on Buffalo Milk Sub
    // -------------------------------------------------------------
    console.log(`[Step 6] Scenario 2: Skipping a specific delivery date on Buffalo Milk sub...`);
    const targetSkipDate = new Date();
    targetSkipDate.setDate(targetSkipDate.getDate() + 3);
    const skipDateYMD = formatDateYMD(targetSkipDate);

    const skipRes = await skipDeliveryDate(client, {
      subscriptionId: bufSubId,
      customerId,
      skipDate: skipDateYMD,
      reason: 'Fasting day'
    });
    assert.equal(skipRes.success, true);

    const skipCheck = await client.query('SELECT * FROM subscription_skipped_dates WHERE subscription_id = $1', [bufSubId]);
    assert.equal(skipCheck.rows.length, 1);
    assert.equal(formatDateYMD(skipCheck.rows[0].skip_date), skipDateYMD);

    const adjCheck = await client.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND adjustment_type = $2',
      [bufSubId, 'extension']
    );
    assert.equal(adjCheck.rows.length, 1);
    assert.equal(Number(adjCheck.rows[0].days_count), 1);
    console.log(`   ✓ Buffalo Milk delivery skipped for ${skipDateYMD}; 1 day extension recorded.`);

    // -------------------------------------------------------------
    // Step 7: Scenario 3 — VACATION Mode on Buffalo Milk Sub
    // -------------------------------------------------------------
    console.log(`[Step 7] Scenario 3: Scheduling Vacation on Buffalo Milk sub...`);
    const vacStart = new Date();
    vacStart.setDate(vacStart.getDate() + 6);
    const vacEnd = new Date();
    vacEnd.setDate(vacEnd.getDate() + 9);
    const vacStartYMD = formatDateYMD(vacStart);
    const vacEndYMD = formatDateYMD(vacEnd);

    const vacRes = await setVacation(client, {
      subscriptionId: bufSubId,
      customerId,
      startDate: vacStartYMD,
      endDate: vacEndYMD,
      reason: 'Family wedding'
    });
    assert.equal(vacRes.success, true);
    assert.equal(vacRes.daysCount, 4);

    const vacAdjCheck = await client.query(
      'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 AND days_count = 4',
      [bufSubId]
    );
    assert.equal(vacAdjCheck.rows.length, 1);
    assert.equal(Number(vacAdjCheck.rows[0].amount_paise), 6500 * 4);
    console.log(`   ✓ Vacation scheduled (${vacStartYMD} to ${vacEndYMD}, 4 days); billing adjustment verified.`);

    // -------------------------------------------------------------
    // Step 8: Scenario 4 — RESUME Cow Milk Subscription
    // -------------------------------------------------------------
    console.log(`[Step 8] Scenario 4: Resuming Cow Milk subscription...`);
    const resumeRes = await resumeSubscription(client, {
      subscriptionId: cowSubId,
      customerId
    });
    assert.equal(resumeRes.success, true);
    assert.equal(resumeRes.status, 'active');

    const checkCowResumed = await client.query('SELECT status, next_delivery FROM customer_subscriptions WHERE id = $1', [cowSubId]);
    assert.equal(checkCowResumed.rows[0].status, 'active');
    assert.notEqual(checkCowResumed.rows[0].next_delivery, 'On Hold (Paused)');

    const closedPause = await client.query(
      'SELECT resumed_at FROM subscription_delivery_pauses WHERE subscription_id = $1',
      [cowSubId]
    );
    assert.ok(closedPause.rows[0].resumed_at !== null);
    console.log(`   ✓ Cow Milk subscription resumed to active; next delivery scheduled for ${checkCowResumed.rows[0].next_delivery}.`);

    // -------------------------------------------------------------
    // Step 9: Scenario 5 — Daily Delivery Generation for Tomorrow
    // -------------------------------------------------------------
    const tomorrowYMD = getTomorrowDeliveryDateYMD();
    console.log(`[Step 9] Scenario 5: Generating morning deliveries for tomorrow (${tomorrowYMD})...`);
    const genRes = await generateDailyDeliveries(client, tomorrowYMD);
    assert.equal(genRes.success, true);
    assert.ok(genRes.generatedCount >= 2, `Expected at least 2 active deliveries, generated ${genRes.generatedCount}`);

    const { deliveries } = await getDailyDeliveries(client, tomorrowYMD);
    assert.equal(deliveries.length, 2);
    const cowDelivery = deliveries.find(d => Number(d.subscription_id) === Number(cowSubId));
    const bufDelivery = deliveries.find(d => Number(d.subscription_id) === Number(bufSubId));
    assert.ok(cowDelivery, 'Cow milk delivery must be generated for tomorrow');
    assert.ok(bufDelivery, 'Buffalo milk delivery must be generated for tomorrow');
    assert.equal(cowDelivery.status, 'scheduled');
    assert.equal(bufDelivery.status, 'scheduled');
    console.log(`   ✓ Successfully generated 2 scheduled deliveries for tomorrow.`);

    // -------------------------------------------------------------
    // Step 10: Scenario 6 — Rerun Idempotency Test
    // -------------------------------------------------------------
    console.log(`[Step 10] Scenario 6: Re-running generation for ${tomorrowYMD} to prove 100% idempotency...`);
    const rerunRes = await generateDailyDeliveries(client, tomorrowYMD);
    assert.equal(rerunRes.success, true);
    assert.equal(rerunRes.generatedCount, 0, 'Re-run must generate 0 duplicate deliveries');

    const totalOrdersCheck = await client.query(
      'SELECT COUNT(*) AS total FROM subscription_delivery_orders WHERE delivery_date = $1',
      [tomorrowYMD]
    );
    assert.equal(Number(totalOrdersCheck.rows[0].total), 2, 'Total orders must remain exactly 2');
    console.log(`   ✓ Re-run generated 0 duplicates (100% idempotent via unique constraint).`);

    // -------------------------------------------------------------
    // Step 11: Scenario 7 — Cutoff Enforcement
    // -------------------------------------------------------------
    console.log(`[Step 11] Scenario 7: Verifying cutoff enforcement on past delivery dates...`);
    const pastSkip = await skipDeliveryDate(client, {
      subscriptionId: cowSubId,
      customerId,
      skipDate: '2026-01-01'
    });
    assert.equal(pastSkip.success, false);
    assert.equal(pastSkip.error, 'cutoff_passed');
    console.log(`   ✓ Cutoff correctly enforced; past date modifications rejected.`);

    // -------------------------------------------------------------
    // Step 12: Scenario 8 — Strict Delivery Status Transitions
    // -------------------------------------------------------------
    console.log(`[Step 12] Scenario 8: Verifying delivery fulfillment state machine transitions...`);
    // A. Invalid jump: scheduled directly to delivered must fail
    const invalidJump = await updateDeliveryStatus(client, cowDelivery.id, 'delivered');
    assert.equal(invalidJump.success, false);
    assert.equal(invalidJump.error, 'invalid_status_transition');

    // B. scheduled -> packed
    const step1 = await updateDeliveryStatus(client, cowDelivery.id, 'packed', { driverNotes: 'Packed in cold crate #4' });
    assert.equal(step1.success, true);
    assert.equal(step1.status, 'packed');

    // C. packed -> out_for_delivery
    const step2 = await updateDeliveryStatus(client, cowDelivery.id, 'out_for_delivery');
    assert.equal(step2.success, true);
    assert.equal(step2.status, 'out_for_delivery');

    // D. out_for_delivery -> delivered
    const step3 = await updateDeliveryStatus(client, cowDelivery.id, 'delivered');
    assert.equal(step3.success, true);
    assert.equal(step3.status, 'delivered');

    // Verify delivered record in DB
    const finalDel = await client.query('SELECT status, delivered_at FROM subscription_delivery_orders WHERE id = $1', [cowDelivery.id]);
    assert.equal(finalDel.rows[0].status, 'delivered');
    assert.ok(finalDel.rows[0].delivered_at !== null);
    console.log(`   ✓ Delivery order successfully moved scheduled -> packed -> out_for_delivery -> delivered.`);

    // -------------------------------------------------------------
    // Step 13: Scenario 9 — Twilio Notification Outbox & Worker
    // -------------------------------------------------------------
    console.log(`[Step 13] Scenario 9: Testing notification outbox enqueue & worker sweep...`);
    const queueRes = await queueNotification(client, {
      customerId,
      phone: customerPhone,
      templateKey: 'DELIVERY_COMPLETED',
      params: {
        productName: 'Cow Milk',
        quantity: '1 Litre',
        time: '6:30 AM'
      },
      idempotencyKey: `test_outbox_integration_${Date.now()}`
    });
    assert.equal(queueRes.queued, true);

    const pendingCheck = await client.query(
      'SELECT id, status, attempts FROM notification_outbox WHERE id = $1',
      [queueRes.outboxId]
    );
    assert.equal(pendingCheck.rows[0].status, 'pending');
    assert.equal(pendingCheck.rows[0].attempts, 0);

    // Process notification through worker
    const processRes = await processNotificationOutbox(client, 10);
    assert.ok(processRes.processed >= 1);

    const sentCheck = await client.query(
      'SELECT status, attempts, sent_at, twilio_message_sid FROM notification_outbox WHERE id = $1',
      [queueRes.outboxId]
    );
    assert.equal(sentCheck.rows[0].status, 'sent');
    assert.equal(sentCheck.rows[0].attempts, 1);
    assert.ok(sentCheck.rows[0].sent_at !== null);
    assert.ok(sentCheck.rows[0].twilio_message_sid !== null);
    console.log(`   ✓ Notification successfully processed from outbox (Status: ${sentCheck.rows[0].status}, SID: ${sentCheck.rows[0].twilio_message_sid}).`);

    console.log(`\n================================================================`);
    console.log(`SUCCESS: All 9 Stage 4 PostgreSQL Integration Scenarios PASSED!`);
    console.log(`================================================================\n`);

  } finally {
    // -------------------------------------------------------------
    // Step 14: Clean Teardown — ALWAYS DROP DISPOSABLE SCHEMA
    // -------------------------------------------------------------
    console.log(`[Clean Teardown] Dropping isolated schema "${schemaName}"...`);
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
    console.log(`   ✓ Isolated test schema completely dropped. Zero production impact.`);
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\nIntegration verification failed:', err);
  process.exit(1);
});
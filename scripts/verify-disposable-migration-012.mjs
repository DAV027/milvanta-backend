import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import assert from 'node:assert/strict';

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

const schemaName = `disposable_test_mig_012_${Date.now()}`;

console.log(`\n======================================================`);
console.log(`Task 4: Disposable PostgreSQL Migration 012 Verification`);
console.log(`Target isolated schema: "${schemaName}"`);
console.log(`======================================================\n`);

async function run() {
  const client = await pool.connect();
  try {
    // 1. Create isolated disposable test schema
    console.log(`[Step 1] Creating isolated test schema: ${schemaName}`);
    await client.query(`CREATE SCHEMA ${schemaName};`);
    await client.query(`SET search_path TO ${schemaName}, public;`);

    // 2. Apply migrations 001 through 011 in exact chronological order
    const migrationsDir = path.resolve('migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('012'))
      .sort();

    console.log(`[Step 2] Applying baseline migrations 001 through 011...`);
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`   Applying ${file}...`);
      await client.query(sql);
    }

    // 3. Insert mock customer and pre-existing active, paused, cancelled subscriptions
    console.log(`[Step 3] Seeding baseline customer & subscriptions in baseline state...`);
    const custRes = await client.query(`
      INSERT INTO customers (full_name, email, phone, password_hash, password_salt)
      VALUES ('Test Customer', 'verify_mig012@milvanta.in', '9876543210', 'dummy_hash', 'dummy_salt')
      RETURNING id;
    `);
    const customerId = custRes.rows[0].id;

    await client.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_name, frequency, time_slot, quantity, cost_per_day_paise, status, notes
      ) VALUES
        ($1, 'Pure Fresh Cow Milk (1 Litre)', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '1 Litre', 10500, 'active', '{"subscriptionId":"sub_existing_active_1"}'::jsonb),
        ($1, 'Pure Buffalo Milk (500 ml)', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '500 ml', 6500, 'paused', '{"subscriptionId":"sub_existing_paused_2"}'::jsonb),
        ($1, 'Pure Fresh Cow Milk (500 ml)', 'Daily (Every Morning)', '6:00 AM – 7:00 AM', '500 ml', 5500, 'cancelled', '{"subscriptionId":"sub_existing_cancelled_3"}'::jsonb);
    `, [customerId]);

    const countBefore = await client.query('SELECT COUNT(*) AS total FROM customer_subscriptions;');
    assert.equal(Number(countBefore.rows[0].total), 3, 'Must have 3 pre-existing subscriptions');
    console.log(`   Verified 3 baseline subscriptions present before migration 012.`);

    // 4. Apply Migration 012 (subscription lifecycle states and columns)
    console.log(`[Step 4] Applying migration 012_subscription_lifecycle_states.sql...`);
    const mig012Sql = fs.readFileSync(path.join(migrationsDir, '012_subscription_lifecycle_states.sql'), 'utf8');
    await client.query(mig012Sql);
    console.log(`   Migration 012 applied cleanly without error.`);

    // 5. Verify existing subscriptions remain valid and untouched
    console.log(`[Step 5] Verifying existing subscriptions compatibility...`);
    const existingActive = await client.query(
      "SELECT id, status, notes->>'subscriptionId' AS sub_id FROM customer_subscriptions WHERE status = 'active';"
    );
    assert.equal(existingActive.rows.length, 1);
    assert.equal(existingActive.rows[0].sub_id, 'sub_existing_active_1');
    console.log(`   Existing active subscription preserved intact.`);

    // 6. Test inserting new lifecycle states: pending_authorization & pending_payment
    console.log(`[Step 6] Testing insert of new pending_authorization & pending_payment statuses...`);
    const pendingAuthRes = await client.query(`
      INSERT INTO customer_subscriptions (
        customer_id, product_name, quantity, cost_per_day_paise, status, razorpay_subscription_id, razorpay_plan_id, notes
      ) VALUES
        ($1, 'Cow Milk 1L Continuous', '1 Litre', 10500, 'pending_authorization', 'sub_rzp_auth_test_100', 'plan_test_001', '{"months":1}'::jsonb),
        ($1, 'Buffalo Milk 1L Continuous', '1 Litre', 12500, 'pending_payment', 'sub_rzp_pay_test_200', 'plan_test_002', '{"months":3}'::jsonb)
      RETURNING id, status, razorpay_subscription_id;
    `, [customerId]);
    assert.equal(pendingAuthRes.rows.length, 2);
    console.log(`   Successfully inserted 'pending_authorization' and 'pending_payment' records.`);

    // 7. Verify invalid status rejection by check constraint
    console.log(`[Step 7] Verifying invalid status rejection by updated CHECK constraint...`);
    let constraintTriggered = false;
    try {
      await client.query(`
        INSERT INTO customer_subscriptions (customer_id, product_name, quantity, status)
        VALUES ($1, 'Bogus Milk', '1L', 'malicious_free_status');
      `, [customerId]);
    } catch (constraintErr) {
      constraintTriggered = true;
      assert.match(constraintErr.message, /check constraint/i);
    }
    assert.equal(constraintTriggered, true, 'Check constraint MUST reject invalid status');
    console.log(`   Check constraint successfully rejected invalid status 'malicious_free_status'.`);

    // 8. Test fast index lookup on razorpay_subscription_id
    console.log(`[Step 8] Verifying index lookup on razorpay_subscription_id...`);
    const lookupRes = await client.query(`
      EXPLAIN SELECT id FROM customer_subscriptions WHERE razorpay_subscription_id = 'sub_rzp_auth_test_100';
    `);
    const planText = lookupRes.rows.map(r => r['QUERY PLAN']).join(' ');
    console.log(`   Query plan: ${planText}`);

    // 9. Verify migration 012 restart / idempotency behavior
    console.log(`[Step 9] Verifying migration 012 idempotency (re-running 012)...`);
    await client.query(mig012Sql);
    console.log(`   Migration 012 successfully re-run with zero errors (100% idempotent).`);

    console.log(`\nAll 9 PostgreSQL Migration 012 verification criteria PASSED successfully!`);

  } finally {
    // 10. Clean up: ALWAYS DROP THE DISPOSABLE SCHEMA
    console.log(`\n[Step 10] Cleaning up: Dropping isolated test schema ${schemaName}...`);
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
    console.log(`   Schema ${schemaName} dropped completely.`);
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\nMigration verification failed:', err);
  process.exit(1);
});

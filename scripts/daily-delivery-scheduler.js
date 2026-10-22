#!/usr/bin/env node
/**
 * Milvanta Automated Daily Delivery Scheduler
 * Executable script for Render Cron Job (Scheduled at 20:15 IST / 14:45 UTC daily)
 * 
 * Functions:
 * 1. Generates next-morning delivery orders for all eligible active milk subscriptions.
 * 2. Excludes paused, vacation, and skipped subscriptions.
 * 3. Enforces duplicate-order prevention.
 * 4. Processes notification outbox for pending SMS reminders.
 */

import 'dotenv/config';
import pg from 'pg';
import { generateDailyDeliveries } from '../src/services/deliveryEngine.js';
import { processNotificationOutbox, queueBillingReminders } from '../src/services/notificationService.js';
import { getNowInIST, formatDateYMD } from '../src/services/subscriptionService.js';
import { assertStagingDatabaseIsolation } from '../src/migrate.js';

const { Pool } = pg;

async function main() {
  if (process.env.DELIVERY_SCHEDULER_ENABLED === 'false') {
    console.log('ℹ️ Delivery scheduler is disabled (DELIVERY_SCHEDULER_ENABLED=false). Exiting cleanly without generating deliveries.');
    process.exit(0);
  }

  const istNow = getNowInIST();
  console.log(`[${istNow.toISOString()}] Starting Milvanta Daily Delivery Scheduler...`);
  console.log(`Current IST Time: ${istNow.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  if (process.env.APP_ENV === 'staging') {
    try {
      assertStagingDatabaseIsolation(process.env.DATABASE_URL);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    // 1. Generate Daily Delivery Orders for Tomorrow
    console.log('Generating next-morning milk delivery orders...');
    const result = await generateDailyDeliveries(pool);
    console.log(`✅ Deliveries generated successfully for ${result.targetDate}:`, {
      targetDate: result.targetDate,
      generatedCount: result.generatedCount,
      skippedCount: result.skippedCount,
      totalActiveSubscriptions: result.totalActiveSubscriptions
    });

    // 2. Process Notification Outbox (send pending reminders / SMS)
    console.log('Processing notification outbox...');
    await queueBillingReminders(pool);
    const notifyRes = await processNotificationOutbox(pool, 50);
    console.log(`✅ Processed ${notifyRes.processed} pending notifications.`);

    console.log(`[${new Date().toISOString()}] Milvanta Delivery Scheduler execution finished successfully.`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Scheduler execution failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();


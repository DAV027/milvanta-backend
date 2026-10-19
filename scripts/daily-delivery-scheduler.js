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
import { processNotificationOutbox } from '../src/services/twilioService.js';
import { getNowInIST, formatDateYMD } from '../src/services/subscriptionService.js';

const { Pool } = pg;

async function main() {
  const istNow = getNowInIST();
  console.log(`[${istNow.toISOString()}] Starting Milvanta Daily Delivery Scheduler...`);
  console.log(`Current IST Time: ${istNow.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is missing.');
    process.exit(1);
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


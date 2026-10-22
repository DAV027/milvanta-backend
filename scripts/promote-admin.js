#!/usr/bin/env node
/**
 * Milvanta Safe Operator-Controlled Admin Activation Script
 * 
 * Usage:
 *   node scripts/promote-admin.js <customer_email> --confirm
 * 
 * Safety:
 * - Requires explicit email argument matching an existing approved customer record.
 * - Does not perform bulk or automatic promotion.
 * - Requires explicit operator approval flag (--confirm) before applying database changes.
 * - Confirms admin authorization is controlled server-side through customers.is_admin.
 * - Operates only when valid DATABASE_URL is configured.
 * - Does NOT attempt to write non-existent updated_at column on customers table.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function main() {
  const args = process.argv.slice(2);
  const targetEmail = args.find(a => !a.startsWith('--'))?.trim().toLowerCase();
  const isConfirmed = args.includes('--confirm') || args.includes('--approved-by-operator');

  if (!targetEmail || !targetEmail.includes('@')) {
    console.error('Error: Please provide a valid customer email to promote to administrator.');
    console.error('Usage: node scripts/promote-admin.js <approved_operator_email> --confirm');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL || process.env.INTERNAL_DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('render.com') || dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false
  });

  try {
    const { rows: existing } = await pool.query(
      'SELECT id, full_name, email, phone, COALESCE(is_admin, FALSE) AS is_admin, created_at FROM customers WHERE LOWER(email) = $1',
      [targetEmail]
    );

    if (!existing.length) {
      console.error(`Error: No customer record found matching email: ${targetEmail}`);
      console.error('Operator instruction: The administrator candidate must first sign up through the standard customer portal.');
      process.exit(1);
    }

    const customer = existing[0];
    if (customer.is_admin) {
      console.log(`Notice: Customer ${customer.full_name} (${customer.email}, ID: ${customer.id}) is already an administrator.`);
      process.exit(0);
    }

    if (!isConfirmed) {
      console.log('====================================================');
      console.log('MILVANTA OPERATOR APPROVAL REQUIRED (DRY RUN)');
      console.log('====================================================');
      console.log(`Target Customer ID : ${customer.id}`);
      console.log(`Full Name          : ${customer.full_name}`);
      console.log(`Email              : ${customer.email}`);
      console.log(`Phone              : ${customer.phone}`);
      console.log(`Current Admin Role : FALSE`);
      console.log(`Account Created At : ${customer.created_at}`);
      console.log('----------------------------------------------------');
      console.log('To confirm this administrator role change, re-run with:');
      console.log(`  node scripts/promote-admin.js ${customer.email} --confirm`);
      console.log('====================================================');
      process.exit(0);
    }

    // Explicit single-account promotion without non-existent updated_at column
    const { rows: updated } = await pool.query(
      `UPDATE customers
       SET is_admin = TRUE
       WHERE id = $1
       RETURNING id, full_name, email, phone, is_admin, created_at`,
      [customer.id]
    );

    console.log('====================================================');
    console.log('MILVANTA ADMINISTRATOR PROMOTION SUCCESSFUL');
    console.log('====================================================');
    console.log(`Customer ID  : ${updated[0].id}`);
    console.log(`Full Name    : ${updated[0].full_name}`);
    console.log(`Email        : ${updated[0].email}`);
    console.log(`Phone        : ${updated[0].phone}`);
    console.log(`Admin Status : ${updated[0].is_admin}`);
    console.log(`Approved At  : ${new Date().toISOString()}`);
    console.log('====================================================');
    console.log('Server-side authorization is now active for this account.');
  } catch (err) {
    console.error('Database query failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

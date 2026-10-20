#!/usr/bin/env node
/**
 * Milvanta Safe Operator-Controlled Admin Activation Script
 * 
 * Usage:
 *   node scripts/promote-admin.js <customer_email>
 * 
 * Safety:
 * - Requires explicit email argument matching an existing approved customer record.
 * - Does not perform bulk or automatic promotion.
 * - Operates only when valid DATABASE_URL is configured.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function main() {
  const targetEmail = process.argv[2]?.trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes('@')) {
    console.error('Error: Please provide a valid customer email to promote to administrator.');
    console.error('Usage: node scripts/promote-admin.js <approved_operator_email>');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL || process.env.INTERNAL_DATABASE_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('render.com') ? { rejectUnauthorized: false } : false
  });

  try {
    const { rows: existing } = await pool.query(
      'SELECT id, full_name, email, phone, is_admin FROM customers WHERE LOWER(email) = $1',
      [targetEmail]
    );

    if (!existing.length) {
      console.error(`Error: No customer record found matching email: ${targetEmail}`);
      process.exit(1);
    }

    const customer = existing[0];
    if (customer.is_admin) {
      console.log(`Notice: Customer ${customer.full_name} (${customer.email}) is already an administrator.`);
      process.exit(0);
    }

    const { rows: updated } = await pool.query(
      `UPDATE customers
       SET is_admin = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, email, phone, is_admin, updated_at`,
      [customer.id]
    );

    console.log('----------------------------------------------------');
    console.log('MILVANTA ADMINISTRATOR PROMOTION SUCCESSFUL');
    console.log('----------------------------------------------------');
    console.log(`Customer ID : ${updated[0].id}`);
    console.log(`Full Name   : ${updated[0].full_name}`);
    console.log(`Email       : ${updated[0].email}`);
    console.log(`Phone       : ${updated[0].phone}`);
    console.log(`Admin Status: ${updated[0].is_admin}`);
    console.log(`Updated At  : ${updated[0].updated_at}`);
    console.log('----------------------------------------------------');
  } catch (err) {
    console.error('Database query failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

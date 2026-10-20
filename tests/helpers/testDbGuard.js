/**
 * Milvanta Test Database Isolation Guard
 * 
 * Strict enforcement of database isolation for integration tests:
 * - Requires an explicitly provided isolated TEST_DATABASE_URL.
 * - Rejects production database hostname (Render prod host) and database name ('milvanta').
 * - Fails closed if database identity cannot be confirmed.
 * - Clears dangerous production DATABASE_URL before application modules can connect.
 * - Runs integration tests in a unique disposable schema isolated from application tables.
 * - Independently verifies cleanup upon test completion.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

// Immediately purge default/production database variables so no module connects implicitly
const PROD_DB_NAME = 'milvanta';
const PROD_HOST_PATTERNS = [
  /oregon-postgres\.render\.com/i,
  /dpg-[a-z0-9]+-a/i,
  /milvanta-db\.(internal|external)/i,
  /production/i
];

/**
 * Validate and sanitize test database configuration.
 * Must be executed BEFORE importing any application code that instantiates pools.
 */
export function validateAndGetTestDatabaseConfig() {
  const rawTestUrl = (process.env.TEST_DATABASE_URL || '').trim();

  // Explicit isolation requirement: fail closed if missing
  if (!rawTestUrl) {
    // Delete any inherited production database URLs to protect database
    delete process.env.DATABASE_URL;
    delete process.env.INTERNAL_DATABASE_URL;
    delete process.env.EXTERNAL_DATABASE_URL;
    delete process.env.POSTGRES_URL;

    return {
      isConfigured: false,
      error: 'TEST_DATABASE_URL is not set. Database integration tests require an explicitly provided, isolated TEST_DATABASE_URL.'
    };
  }

  // Parse URL safely
  let parsed;
  try {
    parsed = new URL(rawTestUrl);
  } catch (err) {
    throw new Error(`FATAL ISOLATION SAFETY ERROR: TEST_DATABASE_URL cannot be parsed: ${err.message}`);
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();

  // 1. Reject production database name ('milvanta')
  if (dbName === PROD_DB_NAME) {
    throw new Error(
      `FATAL ISOLATION SAFETY ERROR: TEST_DATABASE_URL targets production database name ('${PROD_DB_NAME}'). Access strictly denied.`
    );
  }

  // 2. Reject production database hostname patterns
  for (const pattern of PROD_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(
        `FATAL ISOLATION SAFETY ERROR: TEST_DATABASE_URL targets production database host ('${hostname}'). Access strictly denied.`
      );
    }
  }

  // 3. Reject if host is missing or unverified
  if (!hostname) {
    throw new Error('FATAL ISOLATION SAFETY ERROR: TEST_DATABASE_URL lacks a valid hostname.');
  }

  // 4. Staging database check: If pointing to staging DB name, enforce disposable schema
  const isStagingDb = dbName === 'milvanta_db_staging' || dbName === 'milvanta_staging';

  // Override DATABASE_URL so server modules use the verified test URL
  process.env.DATABASE_URL = rawTestUrl;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    process.env.DATABASE_SSL = 'false';
  }

  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const sslConfig = isLocal ? false : (process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false);

  return {
    isConfigured: true,
    url: rawTestUrl,
    hostname,
    port: parsed.port || '5432',
    dbName,
    isStagingDb,
    sslConfig
  };
}

// Execute guard check on module evaluation
export const testDbConfig = validateAndGetTestDatabaseConfig();

/**
 * Asserts that the test database is configured and isolated.
 * Throws immediately if not configured.
 */
export function assertTestDatabaseConfigured() {
  if (!testDbConfig.isConfigured) {
    throw new Error(
      `ISOLATION GUARD BLOCK: ${testDbConfig.error} Provide an isolated disposable test database to run integration tests.`
    );
  }
}

/**
 * Initializes a unique disposable schema in the verified test database and runs all migrations.
 */
export async function setupDisposableTestSchema() {
  assertTestDatabaseConfigured();

  const pool = new Pool({
    connectionString: testDbConfig.url,
    ssl: testDbConfig.sslConfig
  });

  // Verify connected database identity directly from the PostgreSQL engine
  const idRes = await pool.query('SELECT current_database() AS db, current_user AS usr, inet_server_port() AS port');
  const connectedDb = (idRes.rows[0]?.db || '').toLowerCase();

  if (connectedDb === PROD_DB_NAME) {
    await pool.end();
    throw new Error(
      `CRITICAL FATAL SAFETY VIOLATION: Database engine reports connected database is '${connectedDb}'. Aborting immediately!`
    );
  }

  // Generate unique disposable schema name
  const schemaName = `disposable_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  // Create schema
  await pool.query(`CREATE SCHEMA "${schemaName}"`);

  // Set DATABASE_URL with options search_path so server and tests share the exact schema
  const urlObj = new URL(testDbConfig.url);
  urlObj.searchParams.set('options', `-c search_path=${schemaName},public`);
  process.env.DATABASE_URL = urlObj.toString();

  // Create schema-scoped pool for running migrations and test operations
  const schemaPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: testDbConfig.sslConfig
  });

  // Apply migrations in order within the disposable schema
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await schemaPool.query(sql);
    }
  }

  // Close the initial bootstrap pool
  await pool.end().catch(() => {});

  return {
    pool: schemaPool,
    schemaName,
    connectedDb,
    serverPort: idRes.rows[0]?.port
  };
}

/**
 * Cleans up and drops the disposable test schema, and independently verifies its removal.
 */
export async function cleanupDisposableTestSchema(pool, schemaName) {
  if (!pool || !schemaName) return;

  try {
    // Reset search_path
    await pool.query('SET search_path TO public');
    // Drop the disposable schema
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

    // Independently verify that the schema was removed
    const verifyRes = await pool.query(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
      [schemaName]
    );

    if (verifyRes.rows.length !== 0) {
      throw new Error(`INDEPENDENT VERIFICATION FAILED: Disposable schema '${schemaName}' was not dropped!`);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

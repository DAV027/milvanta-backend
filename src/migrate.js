import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Known production PostgreSQL host identifiers
 * Used to safeguard production from unauthorized or accidental staging migrations.
 */
export const KNOWN_PRODUCTION_DB_HOSTS = [
  'dpg-db5ra25ckfvc73b67q7g-a.oregon-postgres.render.com',
  'dpg-db5ra25ckfvc73b67q7g'
];

/**
 * Verifies that the target database connection string is strictly isolated from production.
 * Throws a fatal error if the target matches production.
 */
export function assertStagingDatabaseIsolation(dbUrl) {
  if (!dbUrl) throw new Error('DATABASE_URL is required for database isolation check.');
  const lowerUrl = dbUrl.toLowerCase();
  for (const prodHost of KNOWN_PRODUCTION_DB_HOSTS) {
    if (lowerUrl.includes(prodHost.toLowerCase())) {
      throw new Error(
        `CRITICAL ISOLATION ABORT: Target database connection matches the PRODUCTION database (${prodHost})! ` +
        `Refusing to apply staging migrations to production infrastructure.`
      );
    }
  }
}

export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(__dirname, '../migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.warn('Migrations directory not found:', migrationsDir);
      return [];
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const applied = [];
    for (const file of files) {
      const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [file]);
      if (rows.length === 0) {
        console.log(`Applying migration: ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${file}`);
        applied.push(file);
      }
    }
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// CLI runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isStagingTarget = process.argv.includes('--staging') || process.env.APP_ENV === 'staging';

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  // Strictly enforce production isolation check when targeting staging
  if (isStagingTarget) {
    try {
      assertStagingDatabaseIsolation(process.env.DATABASE_URL);
      console.log('✓ Verified staging database isolation: target does NOT match production.');
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const isRenderPg = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com'));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isRenderPg ? { rejectUnauthorized: false } : (process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }),
    connectionTimeoutMillis: 10000
  });

  try {
    const applied = await runMigrations(pool);
    console.log(`Migrations complete. ${applied.length} new migrations applied.`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    await pool.end();
    process.exit(1);
  }
}

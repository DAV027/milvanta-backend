import 'dotenv/config';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import nodemailer from 'nodemailer';
import pg from 'pg';
import Razorpay from 'razorpay';
import { runMigrations } from './migrate.js';
import { seedProducts } from './seed.js';
import { getDeliveryInfo, isHyderabadPincode } from './delivery.js';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);

const JWT_SECRET = process.env.JWT_SECRET || 'milvanta_super_secure_jwt_secret_key_minimum_32_chars';

if (JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long');
}

const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: true, bodyLimit: 1_048_576 });
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body;
  try { done(null, JSON.parse(body.toString('utf8'))); }
  catch (error) { done(error); }
});

const rawDbUrl = (
  process.env.DATABASE_URL ||
  process.env.INTERNAL_DATABASE_URL ||
  process.env.EXTERNAL_DATABASE_URL ||
  process.env.POSTGRES_URL
)?.trim().replace(/^["']|["']$/g, '');

let normalizedDbUrl = rawDbUrl;
if (normalizedDbUrl) {
  try {
    const parsed = new URL(normalizedDbUrl);
    if (parsed.hostname.startsWith('dpg-') && !parsed.hostname.includes('.')) {
      parsed.hostname = `${parsed.hostname}.oregon-postgres.render.com`;
      normalizedDbUrl = parsed.toString();
    }
  } catch (_) {
    if (/@dpg-[a-z0-9-]+(?::|\/)/i.test(normalizedDbUrl)) {
      normalizedDbUrl = normalizedDbUrl.replace(/@(dpg-[a-z0-9-]+)([:\/])/i, (m, host, sep) => '@' + host + '.oregon-postgres.render.com' + sep);
    }
  }
}

const isRenderPg = Boolean(normalizedDbUrl && normalizedDbUrl.includes('render.com'));
const pool = normalizedDbUrl
  ? new Pool({
      connectionString: normalizedDbUrl,
      ssl: isRenderPg ? { rejectUnauthorized: false } : (process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }),
      connectionTimeoutMillis: 10000
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    app.log.error({ err }, 'Unexpected error on idle database client');
  });
}

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

// ---------- Email (welcome mail only, no verification) ----------
const mailer = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendWelcomeEmail(user) {
  if (!mailer) {
    app.log.warn('SMTP not configured; welcome email skipped');
    return;
  }
  const name = escapeHtml(user.name);
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.SMTP_USER,
    to: user.email,
    subject: 'Welcome to MILVANTA - you have signed up successfully',
    text: `Hi ${user.name},\n\nYou have signed up successfully on MILVANTA. You can now log in and order fresh milk and dairy products.\n\nConnecting Farms to Families\nTeam MILVANTA`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#0B1B4B">
      <h2>Welcome to MILVANTA, ${name}!</h2>
      <p>You have <b>signed up successfully</b>. You can now log in and order fresh milk and dairy products.</p>
      <p style="color:#1E8E3E">Connecting Farms to Families</p>
      <p>Team MILVANTA</p></div>`
  });
}

// ---------- Password hashing (built-in scrypt, no extra dependency) ----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

// ---------- Allowed Origins & CORS ----------
const defaultAllowedOrigins = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://solitary-firefly-ef06.akhilrajuvarma.workers.dev',
  'https://milvanta.in',
  'https://www.milvanta.in'
];
const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
const allAllowedOrigins = new Set([...defaultAllowedOrigins, ...envAllowedOrigins]);

// ---------- Plugins ----------
await app.register(helmet);
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    // Allow any local origin (e.g., Live Server on 5500, preview on 8080, vite/react on 3000/5173)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return cb(null, true);
    }
    if (allAllowedOrigins.has(origin) || origin.endsWith('.workers.dev') || origin.endsWith('.milvanta.in')) {
      return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'x-admin-key']
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '30d' } });

app.decorate('authenticate', async (request, reply) => {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '');
  if (!match) return reply.code(401).send({ error: 'unauthorized' });
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { rows } = await pool.query(
    `SELECT c.id, c.full_name, c.email, c.phone, COALESCE(c.is_admin, FALSE) AS is_admin
     FROM customers c
     JOIN customer_sessions s ON s.customer_id = c.id
     WHERE c.id = $1 AND s.token_hash = $2 AND s.expires_at > NOW()`,
    [request.user.sub, digest(match[1])]
  );
  if (!rows[0]) return reply.code(401).send({ error: 'unauthorized' });
  request.customer = rows[0];
  request.authToken = match[1];
});

app.decorate('requireAdmin', async (request, reply) => {
  const adminKey = request.headers['x-admin-key'];
  if (process.env.ADMIN_API_KEY && adminKey && adminKey === process.env.ADMIN_API_KEY) {
    request.isAdmin = true;
    return;
  }
  await app.authenticate(request, reply);
  if (reply.sent) return;
  if (!request.customer?.is_admin) {
    return reply.code(403).send({ error: 'forbidden_admin_required', message: 'Administrator privileges are required for this action.' });
  }
  request.isAdmin = true;
});

const publicUser = (u) => ({
  id: u.id,
  full_name: u.full_name,
  email: u.email,
  phone: u.phone,
  is_admin: Boolean(u.is_admin)
});
const signToken = (u) => app.jwt.sign({ sub: String(u.id), email: u.email, jti: crypto.randomUUID() });
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function issueToken(user) {
  const token = signToken(user);
  await pool.query(
    `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
    [digest(token), user.id, digest(crypto.randomBytes(32).toString('hex'))]
  );
  return token;
}

function safeAddress(input) {
  if (!input || typeof input !== 'object') return null;
  const nameVal = input.name || input.recipient_name || '';
  const fields = ['name', 'phone', 'house', 'building', 'street', 'landmark', 'city', 'state', 'pincode'];
  const address = Object.fromEntries(fields.map((key) => [key, String(key === 'name' ? nameVal : (input[key] || '')).trim()]));
  if (fields.some((key) => key !== 'landmark' && !address[key]) || fields.some((key) => address[key].length > 160)) return null;
  const digits = address.phone.replace(/\D/g, '');
  address.phone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(address.phone) || !/^\d{6}$/.test(address.pincode)) return null;
  return address;
}

async function applyPaymentStatus(client, orderId, paymentId, status, amount, currency) {
  if (!['authorized', 'captured', 'failed'].includes(status)) return false;
  const found = await client.query(
    'SELECT customer_order_id, razorpay_payment_id, amount_paise, currency, status FROM payment_orders WHERE razorpay_order_id = $1 FOR UPDATE',
    [orderId]
  );
  const payment = found.rows[0];
  if (!payment || Number(payment.amount_paise) !== Number(amount) || payment.currency !== currency) return false;
  if (['captured', 'refunded'].includes(payment.status)) return payment.status === status && payment.razorpay_payment_id === paymentId;
  await client.query(
    'UPDATE payment_orders SET razorpay_payment_id = $2, status = $3, updated_at = NOW() WHERE razorpay_order_id = $1',
    [orderId, paymentId, status]
  );
  if (!payment.customer_order_id) return true;
  const result = await client.query(
    'SELECT id, order_number, items, payment_status, order_status, reservation_expires_at FROM customer_orders WHERE id = $1 FOR UPDATE',
    [payment.customer_order_id]
  );
  const order = result.rows[0];
  if (!order || ['paid', 'failed', 'expired'].includes(order.payment_status)) {
    if (status === 'captured' && order?.payment_status === 'expired') {
      await client.query(
        "UPDATE customer_orders SET payment_status = 'paid', order_status = 'payment_review', updated_at = NOW() WHERE id = $1",
        [payment.customer_order_id]
      );
      await client.query(
        `INSERT INTO order_status_history (order_id, order_number, previous_status, new_status, actor, note)
         VALUES ($1, $2, $3, 'payment_review', 'payment_gateway', 'Payment captured after reservation expiration; marked for manual review')`,
        [order.id, order.order_number, order.order_status]
      );
    }
    return true;
  }
  if (status === 'failed') {
    await client.query(
      `INSERT INTO order_status_history (order_id, order_number, previous_status, new_status, actor, note)
       VALUES ($1, $2, $3, $3, 'payment_gateway', 'Payment attempt failed')`,
      [order.id, order.order_number, order.order_status]
    );
    return true;
  }
  if (status === 'captured') {
    if (new Date(order.reservation_expires_at) > new Date()) {
      for (const item of order.items) {
        const changed = await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $2, reserved_stock = reserved_stock - $2, updated_at = NOW() WHERE id = $1 AND stock_quantity >= $2 AND reserved_stock >= $2',
          [item.productId, item.quantity]
        );
        if (!changed.rowCount) throw new Error('reserved_stock_invariant_failed');
      }
      await client.query(
        "UPDATE customer_orders SET payment_status = 'paid', order_status = 'confirmed', updated_at = NOW() WHERE id = $1",
        [payment.customer_order_id]
      );
      await client.query(
        `INSERT INTO order_status_history (order_id, order_number, previous_status, new_status, actor, note)
         VALUES ($1, $2, $3, 'confirmed', 'payment_gateway', 'Payment verified and order confirmed')`,
        [order.id, order.order_number, order.order_status]
      );
    } else {
      await client.query(
        "UPDATE customer_orders SET payment_status = 'paid', order_status = 'payment_review', updated_at = NOW() WHERE id = $1",
        [payment.customer_order_id]
      );
      await client.query(
        `INSERT INTO order_status_history (order_id, order_number, previous_status, new_status, actor, note)
         VALUES ($1, $2, $3, 'payment_review', 'payment_gateway', 'Payment received after reservation window')`,
        [order.id, order.order_number, order.order_status]
      );
    }
  } else {
    await client.query(
      "UPDATE customer_orders SET payment_status = 'authorized', updated_at = NOW() WHERE id = $1 AND payment_status = 'pending'",
      [payment.customer_order_id]
    );
  }
  return true;
}

// ---------- Routes ----------
app.get('/health', async (request, reply) => {
  const dbEnvKeys = Object.keys(process.env).filter((k) => /DB|DATABASE|POSTGRES|RENDER/i.test(k));
  if (!pool) {
    return reply.code(503).send({
      status: 'degraded',
      service: 'milvanta-api',
      database: 'not_configured',
      deploy_version: '2026-10-13-v4',
      detected_db_env_keys: dbEnvKeys,
      message: 'DATABASE_URL environment variable is not set on the Render Web Service container.'
    });
  }
  try {
    const { rows } = await pool.query(
      `SELECT to_regclass('public.customers') AS customers,
              to_regclass('public.customer_sessions') AS customer_sessions,
              to_regclass('public.products') AS products,
              to_regclass('public.customer_addresses') AS customer_addresses,
              to_regclass('public.customer_orders') AS customer_orders,
              to_regclass('public.payment_orders') AS payment_orders,
              to_regclass('public.payment_webhook_events') AS payment_webhook_events,
              to_regclass('public.order_status_history') AS order_status_history`
    );
    const schemaReady = Object.values(rows[0]).every(Boolean);
    if (!schemaReady) {
      return reply.code(503).send({ status: 'degraded', service: 'milvanta-api', database: 'connected', schema: 'not_ready' });
    }
    return { status: 'ok', service: 'milvanta-api', database: 'connected', schema: 'ready' };
  } catch (error) {
    request.log.error({ err: error }, 'Database health check failed');
    return reply.code(503).send({
      status: 'degraded',
      service: 'milvanta-api',
      database: 'unavailable',
      error_message: error.message,
      error_code: error.code || null
    });
  }
});

const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

// Signup creates the account immediately; welcome email delivery is non-blocking.
app.post('/api/v1/auth/signup', {
  ...authLimit,
  schema: {
    body: {
      type: 'object',
      required: ['name', 'email', 'password'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 100 },
        email: { type: 'string', format: 'email', maxLength: 254 },
        phone: { type: 'string', pattern: '^[6-9][0-9]{9}$' },
        password: { type: 'string', minLength: 8, maxLength: 128 }
      }
    }
  }
}, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { name, phone, password } = request.body;
  const email = request.body.email.trim().toLowerCase();
  const nameClean = name.trim();
  if (nameClean.length < 2) return reply.code(400).send({ error: 'invalid_name' });
  const [passwordSalt, passwordDigest] = (await hashPassword(password)).split(':');

  let user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, full_name, email, phone`,
      [nameClean, email, phone || null, passwordSalt, passwordDigest]
    );
    user = rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const field = String(error.constraint || '').includes('phone') ? 'phone' : 'email';
      return reply.code(409).send({ error: `${field}_already_registered` });
    }
    throw error;
  }

  sendWelcomeEmail({ ...user, name: user.full_name }).catch((error) => request.log.error({ err: error }, 'welcome email failed'));

  const token = await issueToken(user);
  return reply.code(201).send({ user: publicUser(user), customer: publicUser(user), token });
});

app.post('/api/v1/auth/login', {
  ...authLimit,
  schema: {
    body: {
      type: 'object',
      required: ['email', 'password'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email', maxLength: 254 },
        password: { type: 'string', minLength: 1, maxLength: 128 }
      }
    }
  }
}, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const email = request.body.email.trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, full_name, email, phone, password_salt, password_hash FROM customers WHERE LOWER(email) = $1',
    [email]
  );
  const user = rows[0];
  const savedHash = user ? `${user.password_salt}:${user.password_hash}` : DUMMY_HASH;
  const ok = await verifyPassword(request.body.password, savedHash);
  if (!user || !ok) return reply.code(401).send({ error: 'invalid_email_or_password' });
  const token = await issueToken(user);
  return { user: publicUser(user), customer: publicUser(user), token };
});

app.get('/api/v1/auth/me', { preHandler: app.authenticate }, async (request) => ({
  user: publicUser(request.customer),
  customer: publicUser(request.customer),
  csrfToken: ''
}));

app.post('/api/v1/auth/logout', { preHandler: app.authenticate }, async (request) => {
  await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [digest(request.authToken)]);
  return { loggedOut: true };
});

app.patch('/api/v1/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
  const fullName = String(request.body?.fullName || '').trim();
  if (fullName.length < 2 || fullName.length > 100) return reply.code(400).send({ error: 'invalid_customer_name' });
  const { rows } = await pool.query(
    'UPDATE customers SET full_name = $2 WHERE id = $1 RETURNING id, full_name, email, phone',
    [request.customer.id, fullName]
  );
  return { user: publicUser(rows[0]), customer: publicUser(rows[0]) };
});

app.get('/api/v1/products', async (_request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { rows } = await pool.query(
    `SELECT id, name, description, category, price_paise, selling_unit, image_url, GREATEST(0, stock_quantity - reserved_stock) AS stock_quantity
     FROM products WHERE active = TRUE
     ORDER BY 
       CASE category
         WHEN 'Fresh Milk' THEN 1
         WHEN 'Dairy Products' THEN 2
         WHEN 'Baking Essentials' THEN 3
         WHEN 'Healthy Living' THEN 4
         WHEN 'Indian Pickles' THEN 5
         ELSE 6
       END, id ASC`
  );
  return { products: rows };
});

// ---------- Address Management ----------
app.get('/api/v1/addresses', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { rows } = await pool.query(
    `SELECT id, recipient_name AS name, phone, house, building, street, landmark, city, state, pincode, is_default, created_at, updated_at
     FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, updated_at DESC`,
    [request.customer.id]
  );
  return { addresses: rows };
});

app.post('/api/v1/addresses', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const address = safeAddress(request.body);
  if (!address) {
    return reply.code(400).send({ error: 'invalid_address', message: 'Please provide valid address fields, 10-digit mobile number, and 6-digit pincode.' });
  }

  const makeDefault = Boolean(request.body.is_default);
  const addressFingerprint = digest(JSON.stringify(address));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: countRows } = await client.query('SELECT COUNT(*) AS total FROM customer_addresses WHERE customer_id = $1', [request.customer.id]);
    const isFirst = Number(countRows[0].total) === 0;
    const shouldBeDefault = makeDefault || isFirst;

    if (shouldBeDefault) {
      await client.query('UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = $1', [request.customer.id]);
    }

    const { rows } = await client.query(
      `INSERT INTO customer_addresses (
        customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (customer_id, address_fingerprint) DO UPDATE SET
        recipient_name = EXCLUDED.recipient_name,
        phone = EXCLUDED.phone,
        house = EXCLUDED.house,
        building = EXCLUDED.building,
        street = EXCLUDED.street,
        landmark = EXCLUDED.landmark,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        pincode = EXCLUDED.pincode,
        is_default = CASE WHEN $12 THEN TRUE ELSE customer_addresses.is_default END,
        updated_at = NOW()
      RETURNING id, recipient_name AS name, phone, house, building, street, landmark, city, state, pincode, is_default, created_at, updated_at`,
      [request.customer.id, addressFingerprint, address.name, address.phone, address.house, address.building, address.street, address.landmark, address.city, address.state, address.pincode, shouldBeDefault]
    );
    await client.query('COMMIT');
    return reply.code(201).send({ address: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.put('/api/v1/addresses/:id/default', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const addressId = Number(request.params.id);
  if (!Number.isSafeInteger(addressId) || addressId <= 0) return reply.code(400).send({ error: 'invalid_address_id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM customer_addresses WHERE id = $1 AND customer_id = $2 FOR UPDATE', [addressId, request.customer.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'address_not_found' });
    }
    await client.query('UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = $1', [request.customer.id]);
    await client.query('UPDATE customer_addresses SET is_default = TRUE, updated_at = NOW() WHERE id = $1', [addressId]);
    await client.query('COMMIT');
    return { success: true, id: addressId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/api/v1/addresses/:id', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const addressId = Number(request.params.id);
  if (!Number.isSafeInteger(addressId) || addressId <= 0) return reply.code(400).send({ error: 'invalid_address_id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2 RETURNING is_default', [addressId, request.customer.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'address_not_found' });
    }
    if (rows[0].is_default) {
      await client.query(`
        UPDATE customer_addresses
        SET is_default = TRUE
        WHERE id = (
          SELECT id FROM customer_addresses WHERE customer_id = $1 ORDER BY updated_at DESC LIMIT 1
        )
      `, [request.customer.id]);
    }
    await client.query('COMMIT');
    return { deleted: true, id: addressId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ---------- Subscriptions Management ----------
app.get('/api/v1/subscriptions', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { rows } = await pool.query(
    `SELECT id, product_id, product_name, image_url, frequency, time_slot, quantity, quantity_num,
            cost_per_day_paise, status, next_delivery, created_at, updated_at
     FROM customer_subscriptions
     WHERE customer_id = $1 AND status != 'cancelled'
     ORDER BY created_at DESC`,
    [request.customer.id]
  );
  return { subscriptions: rows };
});

app.post('/api/v1/subscriptions', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { productId, productName, imageUrl, frequency, timeSlot, quantity, quantityNum, costPerDayPaise } = request.body || {};
  if (!productName) return reply.code(400).send({ error: 'product_name_required' });

  const { rows } = await pool.query(
    `INSERT INTO customer_subscriptions (
       customer_id, product_id, product_name, image_url, frequency, time_slot, quantity, quantity_num, cost_per_day_paise, status, next_delivery
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 'Tomorrow, 6:00 AM'
     ) RETURNING *`,
    [
      request.customer.id,
      productId || null,
      String(productName).trim(),
      imageUrl || 'assets/milvanta-cow-milk.jpg',
      frequency || 'Daily (Every Morning)',
      timeSlot || '6:00 AM – 7:00 AM',
      quantity || '1 Litre',
      Number(quantityNum) || 1,
      Number(costPerDayPaise) || 6000
    ]
  );
  return reply.code(201).send({ subscription: rows[0] });
});

app.patch('/api/v1/subscriptions/:id', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { status, quantity, quantityNum } = request.body || {};

  const updates = [];
  const values = [request.customer.id, subId];
  let paramIdx = 3;

  if (status && ['active', 'paused', 'cancelled'].includes(status)) {
    updates.push(`status = $${paramIdx++}`);
    values.push(status);
  }
  if (quantity) {
    updates.push(`quantity = $${paramIdx++}`);
    values.push(String(quantity).trim());
  }
  if (quantityNum !== undefined) {
    updates.push(`quantity_num = $${paramIdx++}`);
    values.push(Number(quantityNum));
  }

  if (updates.length === 0) {
    return reply.code(400).send({ error: 'no_updates_provided' });
  }

  updates.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE customer_subscriptions
     SET ${updates.join(', ')}
     WHERE customer_id = $1 AND id = $2
     RETURNING *`,
    values
  );

  if (!rows[0]) return reply.code(404).send({ error: 'subscription_not_found' });
  return { subscription: rows[0] };
});

app.delete('/api/v1/subscriptions/:id', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { rows } = await pool.query(
    `UPDATE customer_subscriptions SET status = 'cancelled', updated_at = NOW()
     WHERE customer_id = $1 AND id = $2
     RETURNING id`,
    [request.customer.id, subId]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'subscription_not_found' });
  return { deleted: true, id: rows[0].id };
});

// ---------- Delivery Check ----------
app.get('/api/v1/delivery/check', async (request, reply) => {
  const pincode = request.query?.pincode;
  const info = getDeliveryInfo(pincode);
  return reply.send(info);
});

// ---------- Orders & Checkout ----------
app.post('/api/v1/orders', {
  preHandler: app.authenticate,
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
}, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const address = safeAddress(request.body?.address);
  const items = request.body?.items;
  if (!address || !Array.isArray(items) || items.length < 1 || items.length > 50) return reply.code(400).send({ error: 'invalid_checkout' });
  const idempotencyKey = request.headers['idempotency-key'] || request.body?.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return reply.code(400).send({ error: 'missing_idempotency_key' });

  const deliveryInfo = getDeliveryInfo(address.pincode);
  if (!deliveryInfo.inHyderabad) {
    return reply.code(422).send({
      error: 'outside_hyderabad',
      message: `Milvanta delivers across Hyderabad (500001–500096). PIN code ${address.pincode} is outside Hyderabad.`
    });
  }
  if (!deliveryInfo.serviceable) {
    return reply.code(422).send({
      error: 'outside_delivery_area',
      message: deliveryInfo.message || `Milvanta delivers across Hyderabad (500001–500096). PIN code ${address.pincode} is outside our delivery zone.`
    });
  }
  const deliveryCharge = deliveryInfo.feePaise || 5000;

  const quantities = new Map();
  for (const item of items) {
    const productId = Number(item?.productId), quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25) return reply.code(400).send({ error: 'invalid_item' });
    const totalQuantity = (quantities.get(productId) || 0) + quantity;
    if (totalQuantity > 25) return reply.code(400).send({ error: 'invalid_item' });
    quantities.set(productId, totalQuantity);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [String(request.customer.id), idempotencyKey]);
    const previous = await client.query(
      `SELECT co.order_number, co.payment_status, co.reservation_expires_at, po.razorpay_order_id, po.amount_paise, po.currency
       FROM customer_orders co LEFT JOIN payment_orders po ON po.customer_order_id = co.id
       WHERE co.customer_id = $1 AND co.idempotency_key = $2`,
      [request.customer.id, idempotencyKey]
    );
    if (previous.rows[0]) {
      const oldOrder = previous.rows[0];
      if (new Date(oldOrder.reservation_expires_at) <= new Date() || ['expired', 'paid'].includes(oldOrder.payment_status)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'checkout_already_processed', orderNumber: oldOrder.order_number });
      }
      await client.query('COMMIT');
      return {
        orderNumber: oldOrder.order_number,
        orderId: oldOrder.razorpay_order_id || `mv_${oldOrder.order_number}`,
        amount: Number(oldOrder.amount_paise || 0),
        currency: oldOrder.currency || 'INR',
        keyId: process.env.RAZORPAY_KEY_ID || ''
      };
    }

    const ids = [...quantities.keys()];
    const { rows: productRows } = await client.query(
      'SELECT id, name, category, price_paise, selling_unit, stock_quantity, reserved_stock FROM products WHERE active = TRUE AND id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
      [ids]
    );
    if (productRows.length !== ids.length) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'product_unavailable', message: 'One or more items in your cart are currently unavailable.' });
    }
    let subtotal = 0;
    const orderItems = [];
    for (const product of productRows) {
      const quantity = quantities.get(Number(product.id));
      if (Number(product.stock_quantity) - Number(product.reserved_stock) < quantity) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'insufficient_stock', productId: Number(product.id), message: `Insufficient stock for ${product.name}.` });
      }
      const unitPricePaise = Number(product.price_paise);
      subtotal += unitPricePaise * quantity;
      orderItems.push({
        productId: Number(product.id),
        name: product.name,
        category: product.category,
        unit: product.selling_unit,
        quantity,
        unitPricePaise,
        lineTotalPaise: unitPricePaise * quantity
      });
    }
    // Total amount in Razorpay includes subtotal plus delivery fee (₹50 / ₹80 based on Hafeezpet hub distance)
    const finalDeliveryCharge = deliveryCharge;
    const total = subtotal + finalDeliveryCharge;
    if (!Number.isSafeInteger(total) || total < 100 || total > 10_000_000) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: 'invalid_order_total' });
    }

    const inserted = await client.query(
      `INSERT INTO customer_orders (customer_id, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise, reservation_expires_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, NOW() + INTERVAL '15 minutes') RETURNING id, created_at`,
      [request.customer.id, idempotencyKey, JSON.stringify(address), JSON.stringify(orderItems), subtotal, finalDeliveryCharge, total]
    );
    const row = inserted.rows[0];
    const addressFingerprint = digest(JSON.stringify(address));
    await client.query('UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = $1 AND is_default', [request.customer.id]);
    await client.query(
      `INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
       ON CONFLICT (customer_id, address_fingerprint) DO UPDATE SET
         recipient_name = EXCLUDED.recipient_name, phone = EXCLUDED.phone, house = EXCLUDED.house,
         building = EXCLUDED.building, street = EXCLUDED.street, landmark = EXCLUDED.landmark,
         city = EXCLUDED.city, state = EXCLUDED.state, pincode = EXCLUDED.pincode,
         is_default = TRUE, updated_at = NOW()`,
      [request.customer.id, addressFingerprint, address.name, address.phone, address.house, address.building, address.street, address.landmark, address.city, address.state, address.pincode]
    );
    const orderNumber = `MV-${new Date(row.created_at).toISOString().slice(0, 10).replaceAll('-', '')}-${String(row.id).padStart(6, '0')}`;
    for (const [productId, quantity] of quantities) {
      await client.query('UPDATE products SET reserved_stock = reserved_stock + $2, updated_at = NOW() WHERE id = $1', [productId, quantity]);
    }

    // Record initial status in order_status_history
    await client.query(
      `INSERT INTO order_status_history (order_id, order_number, previous_status, new_status, actor, note)
       VALUES ($1, $2, NULL, 'placed', 'customer', 'Order placed successfully')`,
      [row.id, orderNumber]
    );

    // If Razorpay is configured, initiate gateway order; otherwise support direct placement
    if (razorpay && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      const gatewayOrder = await razorpay.orders.create({
        amount: total,
        currency: 'INR',
        receipt: `mv-${row.id}-${crypto.randomBytes(4).toString('hex')}`,
        notes: { order_number: orderNumber, customer_id: String(request.customer.id) }
      });
      await client.query('UPDATE customer_orders SET order_number = $2, razorpay_order_id = $3 WHERE id = $1', [row.id, orderNumber, gatewayOrder.id]);
      await client.query(
        `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
         VALUES ($1, $2, $3, 'INR', $4::jsonb, 'created')`,
        [gatewayOrder.id, row.id, total, JSON.stringify(orderItems)]
      );
      await client.query('COMMIT');
      return reply.code(201).send({
        orderNumber,
        orderId: gatewayOrder.id,
        amount: gatewayOrder.amount,
        currency: gatewayOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        subtotalPaise: subtotal,
        deliveryChargePaise: finalDeliveryCharge
      });
    } else {
      // Direct placement fallback (e.g., COD or dev/test environment)
      await client.query('UPDATE customer_orders SET order_number = $2 WHERE id = $1', [row.id, orderNumber]);
      await client.query('COMMIT');
      return reply.code(201).send({
        orderNumber,
        orderId: `direct_${orderNumber}`,
        amount: total,
        currency: 'INR',
        keyId: '',
        subtotalPaise: subtotal,
        deliveryChargePaise: finalDeliveryCharge,
        directMode: true
      });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/v1/orders', { preHandler: app.authenticate }, async (request) => {
  const { rows } = await pool.query(
    `SELECT order_number, items, address, subtotal_paise, delivery_charge_paise, total_paise,
            order_status, payment_status, courier_name, tracking_number, estimated_delivery, created_at
     FROM customer_orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [request.customer.id]
  );
  return { orders: rows };
});

app.get('/api/v1/orders/:orderNumber', { preHandler: app.authenticate }, async (request, reply) => {
  const { rows } = await pool.query(
    `SELECT order_number, items, address, subtotal_paise, delivery_charge_paise, total_paise,
            order_status, payment_status, courier_name, tracking_number, estimated_delivery, created_at
     FROM customer_orders WHERE customer_id = $1 AND order_number = $2`,
    [request.customer.id, request.params.orderNumber]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'order_not_found' });
  return { order: rows[0] };
});

// Order Tracking Timeline
app.get('/api/v1/orders/:orderNumber/track', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { orderNumber } = request.params;

  const { rows: orderRows } = await pool.query(
    `SELECT co.id, co.order_number, co.customer_id, co.items, co.address, co.subtotal_paise, co.delivery_charge_paise,
            co.total_paise, co.order_status, co.payment_status, co.courier_name, co.tracking_number,
            co.estimated_delivery, co.created_at, co.updated_at
     FROM customer_orders co
     WHERE co.order_number = $1`,
    [orderNumber]
  );
  const order = orderRows[0];
  if (!order) return reply.code(404).send({ error: 'order_not_found' });

  if (Number(order.customer_id) !== Number(request.customer.id) && !request.customer.is_admin) {
    return reply.code(403).send({ error: 'forbidden' });
  }

  const { rows: historyRows } = await pool.query(
    `SELECT id, order_number, previous_status, new_status, actor, note, courier_name, tracking_number, created_at
     FROM order_status_history
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [order.id]
  );

  return {
    order: {
      orderNumber: order.order_number,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      courierName: order.courier_name,
      trackingNumber: order.tracking_number,
      estimatedDelivery: order.estimated_delivery,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: order.items,
      address: order.address,
      subtotalPaise: order.subtotal_paise,
      deliveryChargePaise: order.delivery_charge_paise,
      totalPaise: order.total_paise
    },
    history: historyRows
  };
});

// ---------- Admin Order Management ----------
app.get('/api/v1/admin/orders', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { status, search, limit = 50, offset = 0 } = request.query || {};
  const queryParams = [];
  const conditions = [];

  if (status && status !== 'all') {
    queryParams.push(status);
    conditions.push(`co.order_status = $${queryParams.length}`);
  }

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(co.order_number) LIKE $${queryParams.length} OR
      LOWER(c.full_name) LIKE $${queryParams.length} OR
      LOWER(c.email) LIKE $${queryParams.length} OR
      LOWER(co.address->>'phone') LIKE $${queryParams.length} OR
      LOWER(COALESCE(co.tracking_number, '')) LIKE $${queryParams.length}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const parsedOffset = Math.max(0, Number(offset) || 0);
  queryParams.push(parsedLimit, parsedOffset);

  const { rows } = await pool.query(
    `SELECT co.id, co.order_number, co.customer_id, c.full_name AS customer_name, c.email AS customer_email,
            co.address, co.items, co.subtotal_paise, co.delivery_charge_paise, co.total_paise,
            co.order_status, co.payment_status, co.courier_name, co.tracking_number, co.estimated_delivery,
            co.created_at, co.updated_at
     FROM customer_orders co
     JOIN customers c ON c.id = co.customer_id
     ${whereClause}
     ORDER BY co.created_at DESC
     LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams
  );

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM customer_orders co JOIN customers c ON c.id = co.customer_id ${whereClause}`,
    queryParams.slice(0, -2)
  );

  return { orders: rows, total: Number(countRes.rows[0].total) };
});

app.patch('/api/v1/admin/orders/:orderNumber/status', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { orderNumber } = request.params;
  const { status, note = '', courierName, trackingNumber, estimatedDelivery } = request.body || {};

  const allowedStatuses = ['placed', 'pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'payment_review'];
  if (!status || !allowedStatuses.includes(status)) {
    return reply.code(400).send({ error: 'invalid_status', allowed: allowedStatuses });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      'SELECT id, order_number, order_status, payment_status, courier_name, tracking_number FROM customer_orders WHERE order_number = $1 FOR UPDATE',
      [orderNumber]
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'order_not_found' });
    }

    const previousStatus = existing.order_status;
    const newCourier = courierName !== undefined ? (courierName ? String(courierName).trim() : null) : existing.courier_name;
    const newTracking = trackingNumber !== undefined ? (trackingNumber ? String(trackingNumber).trim() : null) : existing.tracking_number;
    const estDeliveryDate = estimatedDelivery ? new Date(estimatedDelivery) : null;

    const { rows: updatedRows } = await client.query(
      `UPDATE customer_orders
       SET order_status = $2,
           courier_name = $3,
           tracking_number = $4,
           estimated_delivery = COALESCE($5, estimated_delivery),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [existing.id, status, newCourier, newTracking, estDeliveryDate]
    );

    const actor = request.customer?.email || 'admin';
    await client.query(
      `INSERT INTO order_status_history (
        order_id, order_number, previous_status, new_status, actor, note, courier_name, tracking_number, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [existing.id, orderNumber, previousStatus, status, actor, note || `Status updated to ${status}`, newCourier, newTracking]
    );

    await client.query('COMMIT');
    return { order: updatedRows[0], previousStatus, newStatus: status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.get('/api/v1/admin/stats', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const [ordersSummary, customerSummary] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE order_status IN ('placed', 'confirmed', 'processing')) AS active_orders,
        COUNT(*) FILTER (WHERE order_status = 'delivered') AS delivered_orders,
        COALESCE(SUM(total_paise) FILTER (WHERE payment_status = 'paid'), 0) AS total_revenue_paise
      FROM customer_orders
    `),
    pool.query('SELECT COUNT(*) AS total_customers FROM customers')
  ]);

  return {
    totalOrders: Number(ordersSummary.rows[0].total_orders),
    activeOrders: Number(ordersSummary.rows[0].active_orders),
    deliveredOrders: Number(ordersSummary.rows[0].delivered_orders),
    totalRevenuePaise: Number(ordersSummary.rows[0].total_revenue_paise),
    totalCustomers: Number(customerSummary.rows[0].total_customers)
  };
});

app.post('/api/v1/payments/verify', { preHandler: app.authenticate }, async (request, reply) => {
  if (!process.env.RAZORPAY_KEY_SECRET || !pool || !razorpay) return reply.code(503).send({ error: 'payments_not_configured' });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = request.body || {};
  if (![orderId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0)) {
    return reply.code(400).send({ error: 'invalid_payment_proof' });
  }
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return reply.code(400).send({ verified: false, error: 'invalid_payment_signature' });
  }
  const paymentOrder = await pool.query(
    `SELECT po.amount_paise FROM payment_orders po
     JOIN customer_orders co ON co.id = po.customer_order_id
     WHERE po.razorpay_order_id = $1 AND co.customer_id = $2`,
    [orderId, request.customer.id]
  );
  if (!paymentOrder.rowCount) return reply.code(404).send({ verified: false, error: 'payment_order_not_found' });
  const [gatewayOrder, gatewayPayment] = await Promise.all([razorpay.orders.fetch(orderId), razorpay.payments.fetch(paymentId)]);
  if (gatewayPayment.order_id !== orderId ||
      gatewayOrder.amount !== Number(paymentOrder.rows[0].amount_paise) ||
      gatewayPayment.amount !== Number(paymentOrder.rows[0].amount_paise) ||
      gatewayPayment.currency !== 'INR') {
    return reply.code(400).send({ verified: false, error: 'payment_details_mismatch' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const applied = await applyPaymentStatus(client, orderId, paymentId, gatewayPayment.status, gatewayPayment.amount, gatewayPayment.currency);
    await client.query('COMMIT');
    if (!applied) return reply.code(409).send({ verified: false, error: 'payment_state_not_applicable' });
    return { verified: true, orderId, paymentId, status: gatewayPayment.status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/v1/payments/webhook', async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return reply.code(503).send({ error: 'webhook_not_configured' });
  const signature = request.headers['x-razorpay-signature'];
  if (typeof signature !== 'string' || !request.rawBody) return reply.code(400).send({ error: 'invalid_webhook' });
  const expected = crypto.createHmac('sha256', secret).update(request.rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return reply.code(400).send({ error: 'invalid_webhook_signature' });
  }
  const eventId = request.headers['x-razorpay-event-id'];
  if (typeof eventId !== 'string' || !eventId) return reply.code(400).send({ error: 'missing_event_id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seen = await client.query('INSERT INTO payment_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
    if (seen.rowCount) {
      const entity = request.body?.payload?.payment?.entity;
      if (entity?.order_id && entity?.id) {
        const status = request.body.event === 'payment.captured' ? 'captured'
          : request.body.event === 'payment.failed' ? 'failed'
            : request.body.event === 'payment.authorized' ? 'authorized' : null;
        if (status) await applyPaymentStatus(client, entity.order_id, entity.id, status, entity.amount, entity.currency);
      }
    }
    await client.query('COMMIT');
    return { received: true, duplicate: !seen.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? 'internal_server_error' : error.message });
});

async function releaseExpiredReservations() {
  if (!pool) return;
  let client = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, items FROM customer_orders
       WHERE payment_status IN ('pending', 'authorized') AND reservation_expires_at <= NOW()
       ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`
    );
    for (const order of rows) {
      for (const item of order.items) {
        await client.query(
          'UPDATE products SET reserved_stock = GREATEST(0, reserved_stock - $2), updated_at = NOW() WHERE id = $1',
          [item.productId, item.quantity]
        );
      }
      await client.query(
        "UPDATE customer_orders SET payment_status = 'expired', order_status = 'cancelled', updated_at = NOW() WHERE id = $1",
        [order.id]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    app.log.warn({ err: error?.message || error }, 'Failed to release expired inventory reservations');
  } finally {
    if (client) {
      try { client.release(); } catch (_) {}
    }
  }
}

const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || '0.0.0.0';

let reservationSweep = null;
if (process.env.NODE_ENV !== 'test') {
  await app.listen({ port, host });
  reservationSweep = setInterval(releaseExpiredReservations, 60_000);
  reservationSweep.unref();

  // Asynchronously apply database migrations on startup without delaying HTTP listener
  if (pool) {
    runMigrations(pool)
      .then(async (applied) => {
        if (applied && applied.length > 0) {
          app.log.info({ applied }, 'Database migrations applied successfully');
        } else {
          app.log.info('Database schema is up to date');
        }
        try {
          const { rows } = await pool.query('SELECT COUNT(*) FROM products');
          if (Number(rows[0].count) === 0) {
            await seedProducts(pool);
            app.log.info('Initial product catalog seeded into database');
          }
        } catch (err) {
          app.log.error({ err }, 'Failed checking/seeding products catalog');
        }
      })
      .catch((err) => {
        app.log.error({ err }, 'Failed running database migrations on startup');
      });
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (reservationSweep) clearInterval(reservationSweep);
      await app.close();
      await pool?.end();
      process.exit(0);
    });
  }
}

export { app, pool };

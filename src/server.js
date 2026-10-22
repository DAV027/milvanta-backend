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
import { runMigrations, assertStagingDatabaseIsolation } from './migrate.js';
import { seedProducts } from './seed.js';
import { getDeliveryInfo, isHyderabadPincode } from './delivery.js';
import { sendOrderPaidEmails, sendSubscriptionConfirmationEmails, sendPasswordResetEmail } from './email.js';
import {
  resolveItemPricing,
  isFreshMilkProduct,
  getMilkDailySubscriptionRatePaise,
  calculateContinuousMonthsDays,
  normalizeSizeKey,
  parseLitresFromSize,
  APPROVED_MILK_PACK_SIZES
} from './pricing.js';
import {
  normalizeIndianPhoneNumber,
  sendPhoneOtp,
  verifyPhoneOtp,
  queueNotification,
  processNotificationOutbox,
  notificationProvider,
  queuePaidSubscriptionActivation
} from './services/notificationService.js';
import { handleTwilioStatusCallback, validateTwilioWebhookSignature } from './services/twilioService.js';
import { verifyWhatsAppWebhookSignature, handleWhatsAppWebhook, getWhatsAppPreferences, setWhatsAppPreferences } from './services/whatsappService.js';
import {
  pauseSubscription,
  resumeSubscription,
  skipDeliveryDate,
  unskipDeliveryDate,
  setVacation,
  cancelSubscription,
  cancelSubscriptionWithRefund,
  calculateSubscriptionEntitlement,
  getSubscriptionCalendar,
  calculateNextDeliveryDate,
  isDeliveryCutoffPassed,
  derivePaidThroughDate,
  formatDateYMD
} from './services/subscriptionService.js';
import {
  calculateOrderRefundEligibility,
  createOrderRefundRequest,
  listAdminRefundRequests,
  approveRefundRequest,
  rejectRefundRequest
} from './services/refundService.js';
import {
  generateDailyDeliveries,
  getDailyDeliveries,
  updateDeliveryStatus
} from './services/deliveryEngine.js';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'test') {
    JWT_SECRET = 'test_fallback_jwt_secret_key_minimum_32_characters_long';
  } else {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable is missing. A dedicated secret of at least 32 characters is strictly required in staging and production.');
  }
}

if (JWT_SECRET.length < 32) {
  throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be at least 32 characters long');
}

const app = Fastify({
  logger: process.env.NODE_ENV === 'test' ? false : {
    serializers: { req: request => ({ method: request.method, url: request.url?.replace(/([?&]hub\.verify_token=)[^&]*/g, '$1[REDACTED]') }) },
    redact: ['req.headers.authorization', 'req.headers.cookie']
  },
  trustProxy: true, bodyLimit: 1_048_576
});
// Explicit test injection; live server never uses an injected Meta transport.
app.decorate('whatsappFetch', null);
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body;
  const rawStr = body ? body.toString('utf8') : '';
  const trimmed = rawStr.trim();
  if (!trimmed) {
    return done(null, undefined);
  }
  try {
    const parsed = JSON.parse(rawStr);
    done(null, parsed);
  } catch (error) {
    error.statusCode = 400;
    done(error);
  }
});

app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body;
  try {
    const params = new URLSearchParams(body.toString('utf8'));
    const parsed = {};
    for (const [key, value] of params.entries()) {
      parsed[key] = value;
    }
    done(null, parsed);
  } catch (error) {
    done(error);
  }
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

if (normalizedDbUrl && process.env.NODE_ENV === 'test') {
  try {
    const parsed = new URL(normalizedDbUrl);
    const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
    const hostname = (parsed.hostname || '').toLowerCase();
    const isProdHost = hostname.includes('dpg-db5ra25ckfvc73b67q7g') || hostname.includes('milvanta-db');
    const isProdDb = dbName === 'milvanta';
    if (isProdDb || isProdHost) {
      throw new Error(`FATAL ISOLATION SAFETY ERROR: Attempted to connect to production database '${dbName}' at '${hostname}' during tests! Access strictly rejected.`);
    }
  } catch (err) {
    if (err.message.startsWith('FATAL ISOLATION SAFETY ERROR')) throw err;
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
await app.register(rateLimit, { max: process.env.NODE_ENV === 'test' ? 10000 : 100, timeWindow: '1 minute' });
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
  let rows;
  try {
    const res = await pool.query(
      `SELECT c.id, c.full_name, c.email, c.phone, COALESCE(c.is_admin, FALSE) AS is_admin,
              c.phone_verified_at, COALESCE(c.sms_notifications_enabled, TRUE) AS sms_notifications_enabled
       FROM customers c
       JOIN customer_sessions s ON s.customer_id = c.id
       WHERE c.id = $1 AND s.token_hash = $2 AND s.expires_at > NOW()`,
      [request.user.sub, digest(match[1])]
    );
    rows = res.rows;
  } catch (err) {
    if (err.code === '42703') {
      const fallback = await pool.query(
        `SELECT c.id, c.full_name, c.email, c.phone, COALESCE(c.is_admin, FALSE) AS is_admin
         FROM customers c
         JOIN customer_sessions s ON s.customer_id = c.id
         WHERE c.id = $1 AND s.token_hash = $2 AND s.expires_at > NOW()`,
        [request.user.sub, digest(match[1])]
      );
      rows = fallback.rows;
    } else {
      throw err;
    }
  }
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
  phone_verified: Boolean(u.phone_verified_at),
  phone_verified_at: u.phone_verified_at || null,
  sms_notifications_enabled: u.sms_notifications_enabled !== false,
  is_admin: Boolean(u.is_admin)
});
const isPhoneVerificationMandatory = () => process.env.MANDATORY_PHONE_VERIFICATION === 'true';
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

const authLimit = { config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 10000 : 10, timeWindow: '1 minute' } } };

// Signup creates the account immediately; welcome email delivery is non-blocking.
app.post('/api/v1/auth/signup', {
  ...authLimit,
  schema: {
    body: {
      type: 'object',
      required: ['name', 'email', 'phone', 'password'],
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

  const normalizedPhone = normalizeIndianPhoneNumber(phone);
  if (!normalizedPhone) {
    return reply.code(400).send({ error: 'invalid_phone_number', message: 'A valid 10-digit Indian mobile number is required.' });
  }
  const cleanPhone = normalizedPhone.replace('+91', '');

  const [passwordSalt, passwordDigest] = (await hashPassword(password)).split(':');

  let user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, full_name, email, phone, phone_verified_at, email_verified`,
      [nameClean, email, cleanPhone, passwordSalt, passwordDigest]
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

// ---------- Forgot Password Flow (Send OTP -> Verify OTP -> Reset Password) ----------
app.post('/api/v1/auth/forgot-password/send-otp', {
  ...authLimit,
  schema: {
    body: {
      type: 'object',
      required: ['email'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email', maxLength: 254 }
      }
    }
  }
}, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const email = request.body.email.trim().toLowerCase();

  // Verify that customer exists
  const { rows } = await pool.query(
    'SELECT id, full_name, email FROM customers WHERE LOWER(email) = $1',
    [email]
  );
  const customer = rows[0];
  if (!customer) {
    return reply.code(404).send({
      error: 'email_not_registered',
      message: 'No registered Milvanta account found with this email address.'
    });
  }

  // Check rate limit on OTP generation (at least 30s resend buffer)
  const existingRes = await pool.query(
    'SELECT resend_after FROM password_reset_codes WHERE email = $1',
    [email]
  );
  if (existingRes.rows.length > 0 && new Date(existingRes.rows[0].resend_after) > new Date()) {
    const waitSec = Math.ceil((new Date(existingRes.rows[0].resend_after) - new Date()) / 1000);
    return reply.code(429).send({
      error: 'resend_throttled',
      message: `Please wait ${waitSec} seconds before requesting another OTP.`
    });
  }

  // Generate 6-digit cryptographic OTP
  const otp = String(crypto.randomInt(100000, 999999));
  const otpHash = crypto.createHash('sha256').update(otp + email).digest('hex');

  await pool.query(`
    INSERT INTO password_reset_codes (email, otp_hash, reset_token, expires_at, resend_after, attempts, created_at)
    VALUES ($1, $2, NULL, NOW() + INTERVAL '10 minutes', NOW() + INTERVAL '30 seconds', 0, NOW())
    ON CONFLICT (email) DO UPDATE
    SET otp_hash = EXCLUDED.otp_hash,
        reset_token = NULL,
        expires_at = EXCLUDED.expires_at,
        resend_after = EXCLUDED.resend_after,
        attempts = 0,
        created_at = NOW()
  `, [email, otpHash]);

  // Dispatch live email & log for audit/dev
  console.log(`[Password Reset] Generated OTP for ${email}: ${otp}`);
  sendPasswordResetEmail({
    to: customer.email,
    customerName: customer.full_name,
    otp
  }).catch((err) => request.log.error({ err }, 'Failed to deliver password reset email'));

  return {
    success: true,
    message: 'A 6-digit verification OTP has been sent to your registered email address.'
  };
});

app.post('/api/v1/auth/forgot-password/verify-otp', {
  ...authLimit,
  schema: {
    body: {
      type: 'object',
      required: ['email', 'otp'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email', maxLength: 254 },
        otp: { type: 'string', minLength: 6, maxLength: 6 }
      }
    }
  }
}, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const email = request.body.email.trim().toLowerCase();
  const otp = request.body.otp.trim();

  const { rows } = await pool.query(
    'SELECT otp_hash, expires_at, attempts FROM password_reset_codes WHERE email = $1',
    [email]
  );
  const record = rows[0];

  if (!record || new Date(record.expires_at) < new Date()) {
    return reply.code(400).send({
      error: 'otp_expired',
      message: 'This OTP has expired or is invalid. Please request a new OTP.'
    });
  }

  if (record.attempts >= 5) {
    return reply.code(429).send({
      error: 'too_many_attempts',
      message: 'Too many incorrect attempts. Please request a new OTP.'
    });
  }

  const candidateHash = crypto.createHash('sha256').update(otp + email).digest('hex');
  if (candidateHash !== record.otp_hash) {
    await pool.query('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE email = $1', [email]);
    return reply.code(400).send({
      error: 'invalid_otp',
      message: 'Incorrect OTP. Please enter the valid 6-digit code sent to your email.'
    });
  }

  // OTP verified! Generate single-use reset token valid for 15 minutes
  const resetToken = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `UPDATE password_reset_codes SET reset_token = $1, expires_at = NOW() + INTERVAL '15 minutes' WHERE email = $2`,
    [resetToken, email]
  );

  return {
    success: true,
    resetToken,
    message: 'OTP verified successfully. You may now create your new password.'
  };
});

app.post('/api/v1/auth/forgot-password/reset', {
  ...authLimit,
  schema: {
    body: {
      type: 'object',
      required: ['email', 'resetToken', 'newPassword'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email', maxLength: 254 },
        resetToken: { type: 'string', minLength: 32, maxLength: 128 },
        newPassword: { type: 'string', minLength: 8, maxLength: 128 }
      }
    }
  }
}, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const email = request.body.email.trim().toLowerCase();
  const { resetToken, newPassword } = request.body;

  // Validate reset token
  const { rows } = await pool.query(
    'SELECT email, expires_at FROM password_reset_codes WHERE email = $1 AND reset_token = $2 AND expires_at >= NOW()',
    [email, resetToken]
  );
  if (rows.length === 0) {
    return reply.code(400).send({
      error: 'invalid_or_expired_token',
      message: 'Password reset session has expired or is invalid. Please restart the forgot password process.'
    });
  }

  // Hash new password using scrypt
  const [passwordSalt, passwordDigest] = (await hashPassword(newPassword)).split(':');

  // Update customer password
  const updateRes = await pool.query(
    'UPDATE customers SET password_salt = $1, password_hash = $2 WHERE LOWER(email) = $3 RETURNING id',
    [passwordSalt, passwordDigest, email]
  );
  const customerId = updateRes.rows[0]?.id;

  // Cleanup reset code
  await pool.query('DELETE FROM password_reset_codes WHERE email = $1', [email]);

  // Invalidate any active sessions for this customer
  if (customerId) {
    await pool.query('DELETE FROM customer_sessions WHERE customer_id = $1', [customerId]);
  }

  return {
    success: true,
    message: 'Password reset successfully! You can now sign in with your new password.'
  };
});

// ---------- Provider-controlled Phone OTP Verification ----------
app.get('/api/v1/auth/phone/config', async () => ({
  provider: notificationProvider(), mandatory: isPhoneVerificationMandatory()
}));
app.post('/api/v1/auth/phone/send-otp', {
  ...authLimit,
  preHandler: async (request,reply) => { if (notificationProvider()==='whatsapp') return app.authenticate(request,reply); },
  schema: {
    body: {
      type: 'object',
      required: ['phone'],
      additionalProperties: false,
      properties: {
        phone: { type: 'string', minLength: 10, maxLength: 16 }
      }
    }
  }
}, async (request, reply) => {
  const { phone } = request.body;
  const authHeader = request.headers.authorization;
  let customerId = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = app.jwt.verify(authHeader.slice(7));
      customerId = decoded?.sub ? Number(decoded.sub) : null;
    } catch {}
  }

  const result = await sendPhoneOtp({
    phone,
    ip: request.ip,
    customerId: request.customer?.id || customerId,
    sessionHash: request.authToken ? digest(request.authToken) : null,
    pool
  }, process.env.NODE_ENV === 'test' ? {fetchImpl:app.whatsappFetch || undefined} : undefined);

  if (!result.success) {
    const code = result.statusCode || (result.error === 'cooldown_active' ? 429 : 400);
    return reply.code(code).send(result);
  }

  return reply.send(result);
});

app.post('/api/v1/auth/phone/verify-otp', {
  ...authLimit,
  preHandler: async (request,reply) => { if (notificationProvider()==='whatsapp') return app.authenticate(request,reply); },
  schema: {
    body: {
      type: 'object',
      required: ['phone', 'code'],
      additionalProperties: false,
      properties: {
        phone: { type: 'string', minLength: 10, maxLength: 16 },
        code: { type: 'string', minLength: 4, maxLength: 8 }
      }
    }
  }
}, async (request, reply) => {
  const { phone, code } = request.body;
  const authHeader = request.headers.authorization;
  let customerId = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = app.jwt.verify(authHeader.slice(7));
      customerId = decoded?.sub ? Number(decoded.sub) : null;
    } catch {}
  }

  const result = await verifyPhoneOtp({
    phone,
    code,
    customerId: request.customer?.id || customerId,
    sessionHash: request.authToken ? digest(request.authToken) : null,
    pool
  });

  if (!result.verified) {
    const status = result.statusCode || (result.error === 'max_attempts_exceeded' ? 429 : 400);
    return reply.code(status).send(result);
  }

  return reply.send(result);
});

// Meta handshake and exact-raw-body signed event ingress. Remains available during provider cutover.
app.get('/api/v1/webhooks/whatsapp', async(request,reply)=>{
  const q=request.query || {}, token=process.env.WHATSAPP_VERIFY_TOKEN;
  const supplied=typeof q['hub.verify_token']==='string'?q['hub.verify_token']:'';
  const a=Buffer.from(token || ''), b=Buffer.from(supplied);
  if(!token || q['hub.mode']!=='subscribe' || a.length!==b.length || !crypto.timingSafeEqual(a,b) || typeof q['hub.challenge']!=='string') return reply.code(403).send({error:'invalid_webhook_challenge'});
  return reply.type('text/plain').send(q['hub.challenge']);
});
app.post('/api/v1/webhooks/whatsapp', async(request,reply)=>{
  if(!verifyWhatsAppWebhookSignature({rawBody:request.rawBody,signature:request.headers['x-hub-signature-256']})) return reply.code(403).send({error:'invalid_webhook_signature'});
  if(!pool) return reply.code(503).send({error:'database_not_configured'});
  await handleWhatsAppWebhook(pool,request.body);
  return {received:true};
});

// ---------- Customer Notification Preferences ----------
app.get('/api/v1/customers/notifications/preferences', { preHandler: app.authenticate }, async (request, reply) => {
  if (notificationProvider()==='whatsapp') return reply.send({ provider:'whatsapp', ...(await getWhatsAppPreferences(pool,request.customer.id)), phone:request.customer.phone, phone_verified:Boolean(request.customer.phone_verified_at) });
  return reply.send({
    sms_notifications_enabled: request.customer.sms_notifications_enabled !== false,
    phone: request.customer.phone,
    phone_verified: Boolean(request.customer.phone_verified_at)
  });
});

app.patch('/api/v1/customers/notifications/preferences', { preHandler: app.authenticate }, async (request, reply) => {
  if (notificationProvider()==='whatsapp') {
    try { return reply.send({success:true,provider:'whatsapp',...(await setWhatsAppPreferences(pool,request.customer,request.body || {}))}); }
    catch(error) { return reply.code(error.statusCode || 503).send({error:error.code || 'preferences_unavailable'}); }
  }
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { enabled } = request.body || {};
  const isEnabled = enabled !== false;

  await pool.query(
    'UPDATE customers SET sms_notifications_enabled = $1, updated_at = NOW() WHERE id = $2',
    [isEnabled, request.customer.id]
  );

  return reply.send({
    success: true,
    sms_notifications_enabled: isEnabled,
    message: isEnabled ? 'SMS delivery alerts enabled.' : 'SMS delivery alerts muted.'
  });
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
            cost_per_day_paise, plan_type, duration_label, total_amount_paise, razorpay_subscription_id,
            notes, status, next_delivery, created_at, updated_at
     FROM customer_subscriptions
     WHERE customer_id = $1 AND status != 'cancelled'
     ORDER BY created_at DESC`,
    [request.customer.id]
  );
  return { subscriptions: rows };
});

app.post('/api/v1/subscriptions', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  if (isPhoneVerificationMandatory() && !request.customer?.phone_verified_at && !request.isAdmin) {
    return reply.code(403).send({
      error: 'phone_verification_required',
      message: 'Mobile number verification is required before starting a subscription. Please verify your phone number in your profile.'
    });
  }
  const {
    productId,
    productName,
    imageUrl,
    frequency,
    timeSlot,
    quantity,
    quantityNum,
    planType,
    durationLabel,
    notes,
    paymentId: rawPaymentId
  } = request.body || {};

  if (!productName) return reply.code(400).send({ error: 'product_name_required' });

  const paymentId = String(rawPaymentId || notes?.paymentId || '').trim();

  // Non-admins MUST provide a verifiable payment ID
  if (!request.isAdmin) {
    if (!paymentId) {
      return reply.code(400).send({
        error: 'payment_id_required',
        message: 'A verified payment authorization ID is required to activate a subscription.'
      });
    }

    // Check duplicate activation prevention: ensure paymentId hasn't already been used
    const existing = await pool.query(
      "SELECT id, status, product_name, quantity, cost_per_day_paise, total_amount_paise, notes, next_delivery, razorpay_subscription_id FROM customer_subscriptions WHERE (notes->>'paymentId' = $1 OR notes->>'payment_id' = $1) AND customer_id = $2",
      [paymentId, request.customer.id]
    );
    if (existing.rows.length) {
      return reply.code(200).send({
        subscription: existing.rows[0],
        message: 'Subscription already active for this payment'
      });
    }

    const otherExisting = await pool.query(
      "SELECT id, customer_id FROM customer_subscriptions WHERE (notes->>'paymentId' = $1 OR notes->>'payment_id' = $1)",
      [paymentId]
    );
    if (otherExisting.rows.length) {
      return reply.code(409).send({
        error: 'payment_already_used',
        message: 'This payment authorization has already been used by another account.'
      });
    }

    // Security: Ensure an unrelated one-time order payment cannot be used for a subscription
    const orderPaid = await pool.query(
      "SELECT razorpay_order_id FROM payment_orders WHERE razorpay_payment_id = $1",
      [paymentId]
    );
    if (orderPaid.rows.length) {
      return reply.code(400).send({
        error: 'payment_already_used_for_order',
        message: 'This payment authorization is associated with an order and cannot be used to activate a subscription.'
      });
    }

    // Calculate authoritative server-side pricing for milk subscriptions
    const cleanQty = quantity || '1 Litre';
    const dailyRatePaise = getMilkDailySubscriptionRatePaise(productName, cleanQty);
    const effectiveDays = Math.max(1, Math.min(365, Number(notes?.days || notes?.customDays) || (planType === 'custom' ? 7 : 30)));
    const calculatedTotalPaise = dailyRatePaise * effectiveDays;

    // Verify payment status, ownership and amount with Razorpay gateway
    if (razorpay && process.env.RAZORPAY_KEY_SECRET) {
      let gatewayPayment;
      try {
        gatewayPayment = await razorpay.payments.fetch(paymentId);
      } catch (rzpErr) {
        return reply.code(400).send({
          error: 'invalid_payment_proof',
          message: 'Provided payment reference could not be verified with gateway.'
        });
      }

      if (!['captured', 'authorized'].includes(gatewayPayment?.status)) {
        return reply.code(402).send({
          error: 'payment_not_captured',
          message: 'Payment has not been captured or authorized by gateway.'
        });
      }

      // Do not silently accept missing or non-INR currency
      if (!gatewayPayment?.currency || gatewayPayment.currency !== 'INR') {
        return reply.code(400).send({
          error: 'payment_currency_mismatch',
          message: 'Payment currency must be explicitly INR.'
        });
      }

      // Do not silently accept missing amount
      if (typeof gatewayPayment?.amount !== 'number' || gatewayPayment.amount <= 0) {
        return reply.code(400).send({
          error: 'invalid_payment_amount',
          message: 'Authorized payment amount must be a positive number.'
        });
      }

      // Prevent direct subscription creation from activating arbitrary subscriptions using recurring payment IDs
      if (gatewayPayment.subscription_id) {
        return reply.code(400).send({
          error: 'subscription_payment_requires_verify',
          message: 'Recurring subscription payments must be activated via the subscription verification endpoint.'
        });
      }

      // Reject missing, contradictory, or unverified ownership evidence
      const paymentCustId = gatewayPayment.notes?.customerId || gatewayPayment.notes?.customer_id;
      if (!paymentCustId || String(paymentCustId) !== String(request.customer.id)) {
        return reply.code(403).send({
          error: 'payment_customer_mismatch',
          message: 'Payment authorization lacks verified ownership linking it to this customer.'
        });
      }

      // Reject contradictory purpose if present
      if (gatewayPayment.notes?.purpose && !['subscription', 'milk_subscription'].includes(String(gatewayPayment.notes.purpose).toLowerCase())) {
        return reply.code(400).send({
          error: 'payment_purpose_mismatch',
          message: 'Payment authorization purpose is not designated for subscription creation.'
        });
      }

      // Verify payment amount covers the required subscription total
      if (gatewayPayment.amount < calculatedTotalPaise) {
        return reply.code(400).send({
          error: 'payment_amount_insufficient',
          message: `Authorized payment amount (₹${(gatewayPayment.amount / 100).toFixed(0)}) is less than required subscription total (₹${(calculatedTotalPaise / 100).toFixed(0)}).`
        });
      }
    }
  }

  // Calculate authoritative server-side pricing for milk subscriptions
  const cleanQty = quantity || '1 Litre';
  const dailyRatePaise = getMilkDailySubscriptionRatePaise(productName, cleanQty);
  const effectiveDays = Math.max(1, Math.min(365, Number(notes?.days || notes?.customDays) || (planType === 'custom' ? 7 : 30)));
  const calculatedTotalPaise = dailyRatePaise * effectiveDays;

  const enrichedNotes = {
    ...(notes || {}),
    paymentId: paymentId || '',
    dailyRatePaise,
    totalPaise: calculatedTotalPaise,
    verifiedAt: new Date().toISOString()
  };

  const { rows } = await pool.query(
    `INSERT INTO customer_subscriptions (
       customer_id, product_id, product_name, image_url, frequency, time_slot, quantity, quantity_num,
       cost_per_day_paise, plan_type, duration_label, total_amount_paise, notes, status, next_delivery
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', 'Tomorrow, 6:00 AM'
     ) RETURNING *`,
    [
      request.customer.id,
      productId || null,
      String(productName).trim(),
      imageUrl || 'assets/milvanta-cow-milk.jpg',
      frequency || 'Daily (Every Morning)',
      timeSlot || '6:00 AM – 7:00 AM',
      cleanQty,
      Number(quantityNum) || 1,
      dailyRatePaise,
      planType || 'month',
      durationLabel || '',
      calculatedTotalPaise,
      JSON.stringify(enrichedNotes)
    ]
  );

  const createdSub = rows[0];

  // Send subscription confirmation email asynchronously
  sendSubscriptionConfirmationEmails(pool, createdSub, {
    paymentId: paymentId || '',
    customerEmail: request.customer.email,
    customerName: request.customer.full_name
  }).catch((err) => {
    app.log.error({ err }, '[Email] Failed to send subscription confirmation email on POST /api/v1/subscriptions');
  });

  return reply.code(201).send({ subscription: createdSub });
});

app.post('/api/v1/subscriptions/razorpay-checkout', { preHandler: app.authenticate }, async (request, reply) => {
  if (!razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return reply.code(503).send({ error: 'razorpay_not_configured' });
  }
  if (!pool) {
    return reply.code(503).send({ error: 'database_not_configured' });
  }

  if (isPhoneVerificationMandatory() && !request.customer?.phone_verified_at) {
    return reply.code(403).send({
      error: 'phone_verification_required',
      message: 'Mobile number verification is required before starting a subscription. Please verify your phone number in your profile.'
    });
  }

  const {
    productId,
    productName,
    size,
    monthsCount,
    startOffset
  } = request.body || {};

  // 1. Fetch and validate product from database
  let product;
  if (productId) {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE active = TRUE AND (id = $1 OR name ILIKE $2) LIMIT 1',
      [Number(productId) || 0, `%${productName || ''}%`]
    );
    product = rows[0];
  } else if (productName) {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE active = TRUE AND name ILIKE $1 LIMIT 1',
      [`%${productName}%`]
    );
    product = rows[0];
  }

  if (!product || !isFreshMilkProduct(product)) {
    return reply.code(400).send({
      error: 'invalid_subscription_product',
      message: 'Subscriptions are only available for pure fresh milk products.'
    });
  }

  // 2. Validate and normalize size against approved pack sizes
  const normalizedSize = normalizeSizeKey(size || '1 Litre');
  if (!APPROVED_MILK_PACK_SIZES.includes(normalizedSize)) {
    return reply.code(400).send({
      error: 'invalid_pack_size',
      message: `Selected pack size is not approved. Must be one of: ${APPROVED_MILK_PACK_SIZES.join(', ')}`
    });
  }

  // 3. Compute trusted server-side rates, calendar days, and totals
  const months = Math.max(1, Math.min(12, Number(monthsCount) || 1));
  const offset = Math.max(0, Math.min(12, Number(startOffset) || 0));
  const dailyRatePaise = getMilkDailySubscriptionRatePaise(product, normalizedSize);
  const totalDays = calculateContinuousMonthsDays(offset, months);
  const calculatedTotalAmountPaise = totalDays * dailyRatePaise;
  const amountPerMonthPaise = Math.round(calculatedTotalAmountPaise / months);

  // Compute future start date and Razorpay start_at timestamp if offset > 0
  const now = new Date();
  const futureStartDate = new Date(now.getFullYear(), now.getMonth() + offset, 1, 6, 0, 0);
  const futureStartDateYMD = `${futureStartDate.getFullYear()}-${String(futureStartDate.getMonth() + 1).padStart(2, '0')}-01`;
  const startAtTimestamp = offset > 0 ? Math.floor(futureStartDate.getTime() / 1000) : null;
  const initialNextDelivery = offset > 0 ? `${futureStartDateYMD}, 6:00 AM – 7:00 AM` : 'Tomorrow, 6:00 AM';

  // 4. Idempotency check: Reuse existing pending subscription if one was already created recently
  const existingPending = await pool.query(
    `SELECT id, razorpay_subscription_id, razorpay_plan_id, total_amount_paise 
     FROM customer_subscriptions 
     WHERE customer_id = $1 AND product_id = $2 AND quantity = $3 
       AND status = 'pending_authorization' 
       AND created_at > (NOW() - INTERVAL '15 minutes')
     ORDER BY created_at DESC LIMIT 1`,
    [request.customer.id, product.id, normalizedSize]
  );

  if (existingPending.rows[0]?.razorpay_subscription_id) {
    const oldSub = existingPending.rows[0];
    return {
      success: true,
      subscriptionId: oldSub.razorpay_subscription_id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: amountPerMonthPaise,
      totalAmount: Number(oldSub.total_amount_paise || calculatedTotalAmountPaise),
      dailyRate: dailyRatePaise / 100,
      totalDays,
      startDate: offset > 0 ? futureStartDateYMD : null,
      startOffset: offset,
      planId: oldSub.razorpay_plan_id
    };
  }

  try {
    // 5. Create plan in Razorpay with server-calculated monthly amount
    const planName = `Milvanta ${product.name} (${normalizedSize})`;
    const plan = await razorpay.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name: planName,
        amount: amountPerMonthPaise,
        currency: 'INR',
        description: `${normalizedSize} fresh milk delivered daily (₹${dailyRatePaise / 100}/day)`
      }
    });

    // 6. Create subscription in Razorpay linked to customer with start_at configured
    const subParams = {
      plan_id: plan.id,
      total_count: months,
      quantity: 1,
      customer_notify: 1,
      notes: {
        customerId: String(request.customer.id),
        customerPhone: String(request.customer.phone || ''),
        productId: String(product.id),
        productName: String(product.name),
        size: normalizedSize,
        months: String(months),
        days: String(totalDays),
        startOffset: String(offset),
        startDate: offset > 0 ? futureStartDateYMD : '',
        dailyRate: String(dailyRatePaise / 100),
        totalAmountPaise: String(calculatedTotalAmountPaise)
      }
    };
    if (startAtTimestamp) {
      subParams.start_at = startAtTimestamp;
    }

    const rzpSub = await razorpay.subscriptions.create(subParams);

    // 7. Store local subscription in pending_authorization state
    await pool.query(
      `INSERT INTO customer_subscriptions (
        customer_id, product_id, product_name, image_url, frequency, time_slot,
        quantity, quantity_num, cost_per_day_paise, status, next_delivery,
        plan_type, duration_label, total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
      ) VALUES (
        $1, $2, $3, $4, 'Daily (Every Morning)', '6:00 AM – 7:00 AM',
        $5, $6, $7, 'pending_authorization', $8,
        'month', $9, $10, $11, $12, $13
      )`,
      [
        request.customer.id,
        product.id,
        product.name,
        product.image_url || 'assets/milvanta-cow-milk.jpg',
        normalizedSize,
        parseLitresFromSize(normalizedSize),
        dailyRatePaise,
        initialNextDelivery,
        `${months} Month Continuous Plan (${totalDays} Days)`,
        calculatedTotalAmountPaise,
        rzpSub.id,
        plan.id,
        JSON.stringify({
          subscriptionId: rzpSub.id,
          months,
          days: totalDays,
          startOffset: offset,
          startDate: offset > 0 ? futureStartDateYMD : null,
          start_at: startAtTimestamp,
          dailyRatePaise,
          amountPerMonthPaise
        })
      ]
    );

    return {
      success: true,
      subscriptionId: rzpSub.id,
      shortUrl: rzpSub.short_url,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: amountPerMonthPaise,
      totalAmount: calculatedTotalAmountPaise,
      dailyRate: dailyRatePaise / 100,
      totalDays,
      startDate: offset > 0 ? futureStartDateYMD : null,
      startOffset: offset,
      planId: plan.id
    };
  } catch (err) {
    request.log.error({ err }, 'Error creating Razorpay subscription');
    return reply.code(500).send({ error: 'subscription_creation_failed', message: err.message });
  }
});

// Derive authoritative subscription start date from scheduling tables, notes, or gateway
async function deriveAuthoritativeSubscriptionStartDate(pool, subRow, gatewaySub) {
  // 1. Authoritative delivery engine schedule (if delivery rows generated)
  if (pool && subRow?.id) {
    try {
      const { rows } = await pool.query(
        "SELECT delivery_date::text FROM subscription_delivery_orders WHERE subscription_id = $1 AND status = 'scheduled' ORDER BY delivery_date ASC LIMIT 1",
        [subRow.id]
      );
      if (rows[0]?.delivery_date) {
        return rows[0].delivery_date;
      }
    } catch {}
  }

  // 2. Authoritative gateway start timestamp (Razorpay subscription start_at configuration)
  if (gatewaySub?.start_at && Number.isFinite(gatewaySub.start_at)) {
    try {
      return new Date(gatewaySub.start_at * 1000).toISOString().slice(0, 10);
    } catch {}
  }
  if (gatewaySub?.current_start && Number.isFinite(gatewaySub.current_start)) {
    try {
      return new Date(gatewaySub.current_start * 1000).toISOString().slice(0, 10);
    } catch {}
  }

  // 3. Explicit startDate or start_at in subscription notes
  const notes = typeof subRow?.notes === 'object' && subRow?.notes !== null
    ? subRow.notes
    : (typeof gatewaySub?.notes === 'object' && gatewaySub?.notes !== null ? gatewaySub.notes : {});
  if (notes.startDate || notes.start_date) {
    return String(notes.startDate || notes.start_date).trim();
  }
  if (notes.start_at && Number.isFinite(Number(notes.start_at))) {
    try {
      return new Date(Number(notes.start_at) * 1000).toISOString().slice(0, 10);
    } catch {}
  }

  // 4. Stored next_delivery string if present
  if (subRow?.next_delivery && typeof subRow.next_delivery === 'string' && subRow.next_delivery.trim()) {
    const raw = subRow.next_delivery.replace(/,\s*6:00\s*AM.*$/i, '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    if (raw.toLowerCase() === 'tomorrow') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().slice(0, 10);
    }
  }

  // 5. Accurate pending representation
  return 'Pending Schedule';
}

/**
 * Resolves authoritative plan amount in paise from Razorpay gateway
 */
async function resolveGatewayPlanAmount(razorpayClient, gatewaySub) {
  if (typeof gatewaySub?.plan?.item?.amount === 'number' && gatewaySub.plan.item.amount > 0) {
    return gatewaySub.plan.item.amount;
  }
  const planId = gatewaySub?.plan_id;
  if (planId && razorpayClient?.plans?.fetch) {
    try {
      const plan = await razorpayClient.plans.fetch(planId);
      if (typeof plan?.item?.amount === 'number' && plan.item.amount > 0) {
        return plan.item.amount;
      }
    } catch {
      // plan fetch failed
    }
  }
  return null;
}

/**
 * Authoritatively verifies linkage between a Razorpay payment and subscription entity.
 * Fails closed on explicit contradictions (different subscription ID on payment, notes, or invoice).
 * Accepts verified association via top-level ID, notes, invoice link, subscription payments list,
 * existing local database record for the customer, or valid HMAC checkout signature.
 */
async function verifyPaymentSubscriptionLinkage({
  razorpayClient,
  gatewaySub,
  gatewayPayment,
  subId,
  paymentId,
  signatureValid = false,
  existingSubRow = null
}) {
  // 1. Explicit contradiction check on top-level payment subscription_id
  if (gatewayPayment?.subscription_id && gatewayPayment.subscription_id !== subId) {
    return {
      linked: false,
      error: 'payment_subscription_mismatch',
      message: 'Payment is linked to a different subscription ID.'
    };
  }

  // 2. Explicit contradiction check on payment notes
  const paymentSubNote = gatewayPayment?.notes?.subscriptionId ||
    gatewayPayment?.notes?.subscription_id ||
    gatewayPayment?.notes?.razorpay_subscription_id;

  if (paymentSubNote && paymentSubNote !== subId) {
    return {
      linked: false,
      error: 'payment_subscription_mismatch',
      message: 'Payment notes point to a different subscription ID.'
    };
  }

  // 3. Explicit contradiction check on payment invoice
  if (gatewayPayment?.invoice_id && razorpayClient?.invoices?.fetch) {
    try {
      const inv = await razorpayClient.invoices.fetch(gatewayPayment.invoice_id);
      if (inv?.subscription_id) {
        if (inv.subscription_id !== subId) {
          return {
            linked: false,
            error: 'payment_subscription_mismatch',
            message: 'Payment invoice points to a different subscription ID.'
          };
        }
        return { linked: true, method: 'invoice_subscription_link', invoiceId: gatewayPayment.invoice_id };
      }
    } catch {
      // If invoice fetch fails or returns error, continue evaluating other proofs
    }
  }

  // 4. Positive proof A: Top-level payment subscription_id matches
  if (gatewayPayment?.subscription_id && gatewayPayment.subscription_id === subId) {
    return { linked: true, method: 'direct_payment_subscription_id' };
  }

  // 5. Positive proof B: Payment notes match subscription ID
  if (paymentSubNote && paymentSubNote === subId) {
    return { linked: true, method: 'payment_notes_match' };
  }

  // 6. Positive proof C: Local database record matches subscription ID and customer
  if (
    existingSubRow &&
    (existingSubRow.razorpay_subscription_id === subId || existingSubRow.notes?.subscriptionId === subId)
  ) {
    return { linked: true, method: 'existing_subscription_record_link' };
  }

  // 7. Positive proof D: Razorpay subscription payments list includes this payment
  if (razorpayClient?.subscriptions?.fetchPayments) {
    try {
      const subPayments = await razorpayClient.subscriptions.fetchPayments(subId);
      const items = Array.isArray(subPayments?.items) ? subPayments.items : [];
      const paymentItem = items.find(p => p && p.id === paymentId);
      if (paymentItem) {
        return { linked: true, method: 'subscription_payments_list' };
      }
    } catch {
      // Optional fallback
    }
  }

  // Fail closed: missing subscription_id without any authoritative association proof is rejected
  return {
    linked: false,
    error: 'payment_subscription_mismatch',
    message: 'Payment is not authoritatively linked to the specified subscription ID.'
  };
}

// Explicit subscription verification endpoint
app.post('/api/v1/subscriptions/verify', { preHandler: app.authenticate }, async (request, reply) => {
  if (!process.env.RAZORPAY_KEY_SECRET || !pool || !razorpay) {
    return reply.code(503).send({ error: 'payments_not_configured' });
  }

  const {
    razorpay_subscription_id: subId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  } = request.body || {};

  if (!subId || !paymentId || !signature) {
    return reply.code(400).send({ verified: false, error: 'invalid_subscription_proof' });
  }

  // 1. Verify Razorpay subscription signature: HMAC-SHA256(payment_id + '|' + subscription_id)
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${paymentId}|${subId}`)
    .digest();
  const supplied = Buffer.from(signature, 'hex');

  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return reply.code(400).send({ verified: false, error: 'invalid_subscription_signature' });
  }

  // 2. Fetch gateway state from Razorpay first to confirm authorization status
  let gatewaySub, gatewayPayment;
  try {
    [gatewaySub, gatewayPayment] = await Promise.all([
      razorpay.subscriptions.fetch(subId),
      razorpay.payments.fetch(paymentId)
    ]);
  } catch (fetchErr) {
    request.log.error({ fetchErr }, 'Failed to fetch Razorpay subscription or payment details');
    return reply.code(502).send({ verified: false, error: 'gateway_fetch_failed', message: fetchErr.message });
  }

  // 3. Confirm payment and subscription are authorized by Razorpay gateway
  // Subscriptions with total_count = 1 transition to 'completed' immediately upon charging the cycle.
  const isSubAuthorized = ['active', 'authenticated', 'completed'].includes(gatewaySub?.status);
  const isPaymentAuthorized = ['captured', 'authorized'].includes(gatewayPayment?.status);

  if (!isSubAuthorized || !isPaymentAuthorized) {
    return reply.code(409).send({
      verified: false,
      error: 'subscription_payment_state_not_captured',
      gatewaySubStatus: gatewaySub?.status,
      gatewayPaymentStatus: gatewayPayment?.status
    });
  }

  // Do not silently accept missing or non-INR currency
  if (!gatewayPayment?.currency || gatewayPayment.currency !== 'INR') {
    return reply.code(400).send({
      verified: false,
      error: 'invalid_payment_currency',
      message: 'Payment currency must be explicitly INR.'
    });
  }

  // Do not silently accept missing amount
  if (typeof gatewayPayment?.amount !== 'number' || gatewayPayment.amount <= 0) {
    return reply.code(400).send({
      verified: false,
      error: 'invalid_payment_amount',
      message: 'Payment amount must be a positive number.'
    });
  }

  // 4. Pre-query local database subscription record and enforce customer ownership
  const { rows: subMatches } = await pool.query(
    `SELECT cs.id, cs.customer_id, cs.status, cs.product_id, cs.product_name, cs.quantity, cs.quantity_num,
            cs.frequency, cs.time_slot, cs.cost_per_day_paise, cs.plan_type, cs.duration_label,
            cs.total_amount_paise, cs.notes, cs.next_delivery, cs.razorpay_subscription_id, cs.razorpay_plan_id, cs.created_at,
            c.phone, c.sms_notifications_enabled
     FROM customer_subscriptions cs
     LEFT JOIN customers c ON c.id = cs.customer_id
     WHERE (cs.razorpay_subscription_id = $1 
            OR cs.notes->>'subscriptionId' = $1 
            OR cs.notes->>'razorpay_subscription_id' = $1 
            OR cs.notes->>'subscription_id' = $1 
            OR cs.id::text = $1)`,
    [subId]
  );

  let subRow = null;
  if (subMatches.length > 0) {
    if (Number(subMatches[0].customer_id) !== Number(request.customer.id) && !request.isAdmin) {
      return reply.code(403).send({
        verified: false,
        error: 'subscription_forbidden',
        message: 'Subscription belongs to another customer'
      });
    }
    subRow = subMatches[0];
  }

  // 5. Authoritative payment and subscription identity linkage check
  const linkage = await verifyPaymentSubscriptionLinkage({
    razorpayClient: razorpay,
    gatewaySub,
    gatewayPayment,
    subId,
    paymentId,
    signatureValid: true,
    existingSubRow: subRow
  });

  // Diagnostic logging for Razorpay payment and subscription linkage (safe statuses/booleans only, no secrets or customer PII)
  request.log.info({
    subId,
    paymentId,
    linkageLinked: linkage.linked,
    linkageMethod: linkage.method || null,
    gatewaySubStatus: gatewaySub?.status,
    gatewayPaymentStatus: gatewayPayment?.status,
    gatewayPaymentAmount: gatewayPayment?.amount,
    gatewayPaymentCurrency: gatewayPayment?.currency,
    hasPaymentSubscriptionId: Boolean(gatewayPayment?.subscription_id),
    paymentSubscriptionIdMatches: gatewayPayment?.subscription_id ? (gatewayPayment.subscription_id === subId) : null,
    gatewaySubPaidCount: gatewaySub?.paid_count
  }, '[Subscriptions] Verify diagnostics for payment and subscription linkage');

  if (!linkage.linked) {
    return reply.code(400).send({
      verified: false,
      error: linkage.error || 'payment_subscription_mismatch',
      message: linkage.message || 'Payment is not authoritatively linked to the specified subscription ID.'
    });
  }

  // Verify plan amount using Razorpay's actual plan data
  const expectedPlanAmount = await resolveGatewayPlanAmount(razorpay, gatewaySub);
  if (expectedPlanAmount === null) {
    return reply.code(400).send({
      verified: false,
      error: 'unverifiable_plan_amount',
      message: 'Authoritative subscription plan amount could not be verified with gateway.'
    });
  }

  // Authoritative validation of subscription payment / authorization transaction:
  // A. Recurring cycle charge: amount matches full plan cycle charge
  const isFullPlanCharge = gatewayPayment.amount === expectedPlanAmount;

  // B. Mandate authentication transaction: legitimate nominal or refundable authorization amount
  //    used by Razorpay/banks (e.g. UPI Autopay / e-mandate registration: ₹1 - ₹5, or refundable auth up to ₹500)
  const isRefundableAuth = Boolean(
    isSubAuthorized &&
    isPaymentAuthorized &&
    (
      gatewaySub?.status === 'authenticated' ||
      gatewayPayment?.notes?.auth_type === 'refundable' ||
      gatewayPayment?.notes?.auth_type === 'mandate_auth' ||
      gatewaySub?.notes?.auth_type === 'refundable' ||
      (!gatewayPayment?.invoice_id && gatewayPayment.amount <= 50000)
    )
  );

  if (!isFullPlanCharge && !isRefundableAuth) {
    return reply.code(400).send({
      verified: false,
      error: 'subscription_amount_mismatch',
      message: `Payment amount (₹${(gatewayPayment.amount / 100).toFixed(0)}) does not match gateway subscription plan amount (₹${(expectedPlanAmount / 100).toFixed(0)}) and is not a valid mandate authorization transaction.`
    });
  }

  // Distinguish verified captured billing-cycle payment from mandate-only authorization
  const isCapturedBillingCyclePayment = Boolean(
    isFullPlanCharge &&
    gatewayPayment?.status === 'captured' &&
    ['active', 'completed'].includes(gatewaySub?.status) &&
    (gatewaySub?.paid_count !== undefined ? Number(gatewaySub.paid_count) >= 1 : true)
  );

  const isMandateOnlyAuth = Boolean(
    !isCapturedBillingCyclePayment &&
    (isRefundableAuth || gatewaySub?.status === 'authenticated' || Number(gatewaySub?.paid_count || 0) === 0)
  );

  // Reject ambiguous or authorized-but-not-captured full-price transactions without activating deliveries
  if (isFullPlanCharge && gatewayPayment?.status !== 'captured') {
    return reply.code(409).send({
      verified: false,
      error: 'payment_not_captured',
      message: 'Subscription full plan charge is authorized but not captured by gateway. Fulfillment cannot be activated.'
    });
  }

  if (!isCapturedBillingCyclePayment && !isMandateOnlyAuth) {
    return reply.code(409).send({
      verified: false,
      error: 'ambiguous_payment_state',
      message: 'Payment state is neither an authoritative captured billing cycle charge nor a valid mandate authorization.'
    });
  }

  // 5. Gateway customer ownership and contradiction checks (Requirement 2 & 3)
  const gatewayCustId = gatewaySub?.notes?.customerId || gatewaySub?.notes?.customer_id || gatewayPayment?.notes?.customerId || gatewayPayment?.notes?.customer_id;
  const gatewayPhone = gatewaySub?.notes?.customerPhone || gatewaySub?.notes?.phone;
  const gatewayEmail = gatewaySub?.notes?.customerEmail || gatewaySub?.notes?.email;

  if (gatewayCustId && String(gatewayCustId) !== String(request.customer.id) && !request.isAdmin) {
    return reply.code(403).send({
      verified: false,
      error: 'subscription_forbidden',
      message: 'Gateway subscription linked to another customer ID'
    });
  }

  if (gatewayPhone && request.customer.phone &&
      normalizeIndianPhoneNumber(gatewayPhone) !== normalizeIndianPhoneNumber(request.customer.phone) &&
      !request.isAdmin) {
    return reply.code(403).send({
      verified: false,
      error: 'subscription_forbidden',
      message: 'Gateway subscription phone contradicts authenticated customer phone'
    });
  }

  if (gatewayEmail && request.customer.email &&
      String(gatewayEmail).toLowerCase().trim() !== String(request.customer.email).toLowerCase().trim() &&
      !request.isAdmin) {
    return reply.code(403).send({
      verified: false,
      error: 'subscription_forbidden',
      message: 'Gateway subscription email contradicts authenticated customer email'
    });
  }

  // 6. Local subscription state and safe reconciliation
  let isNewlyActivated = false;

  if (!subRow) {
    // Reconcile missing local subscription ONLY when gateway establishes trustworthy association (Requirement 2)
      if ((!gatewayCustId || String(gatewayCustId) !== String(request.customer.id)) && !request.isAdmin) {
        return reply.code(403).send({
          verified: false,
          error: 'untrustworthy_subscription_ownership',
          message: 'Gateway subscription metadata does not establish verified customer ownership for reconciliation'
        });
      }

      // Validate expected product and pack size (Requirement 3)
      const productName = gatewaySub?.notes?.productName || 'Pure Fresh Cow Milk';
      const sizeStr = gatewaySub?.notes?.size || '1 Litre';
      if (!APPROVED_MILK_PACK_SIZES.includes(sizeStr)) {
        return reply.code(400).send({
          verified: false,
          error: 'invalid_subscription_product',
          message: `Unrecognized pack size '${sizeStr}' in gateway subscription metadata.`
        });
      }

      const dailyRatePaise = gatewaySub?.notes?.dailyRate
        ? Math.round(Number(gatewaySub.notes.dailyRate) * 100)
        : getMilkDailySubscriptionRatePaise(productName, sizeStr);
      const totalAmountPaise = Number(gatewaySub?.notes?.totalAmountPaise) || expectedPlanAmount;
      const durationLabel = gatewaySub?.notes?.months
        ? `${gatewaySub.notes.months} Month Continuous Plan`
        : 'Continuous Subscription Plan';

      // Concurrency-safe reconciliation using transaction and advisory lock
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [subId]);

        const recheck = await client.query(
          `SELECT cs.id, cs.customer_id, cs.status, cs.product_name, cs.quantity, cs.notes, cs.next_delivery
           FROM customer_subscriptions cs
           WHERE cs.razorpay_subscription_id = $1 OR cs.notes->>'subscriptionId' = $1`,
          [subId]
        );

        const gatewayStartAtYMD = gatewaySub?.start_at && Number.isFinite(gatewaySub.start_at)
          ? new Date(gatewaySub.start_at * 1000).toISOString().slice(0, 10)
          : null;
        const initialNextDelivery = gatewayStartAtYMD && gatewayStartAtYMD > new Date().toISOString().slice(0, 10)
          ? `${gatewayStartAtYMD}, 6:00 AM – 7:00 AM`
          : 'Tomorrow, 6:00 AM';

        if (recheck.rows.length > 0) {
          subRow = recheck.rows[0];
          isNewlyActivated = false;
        } else {
          const insertStatus = isCapturedBillingCyclePayment ? 'active' : 'pending_authorization';
          const insertNextDelivery = isCapturedBillingCyclePayment
            ? initialNextDelivery
            : 'Pending Billing Cycle Payment';

          const insertRes = await client.query(
            `INSERT INTO customer_subscriptions (
               customer_id, product_name, frequency, time_slot, quantity, quantity_num,
               cost_per_day_paise, status, next_delivery, plan_type, duration_label,
               total_amount_paise, razorpay_subscription_id, razorpay_plan_id, notes
             ) VALUES (
               $1, $2, 'Daily (Every Morning)', '6:00 AM – 7:00 AM', $3, $4,
               $5, $6, $7, 'month', $8,
               $9, $10, $11, $12
             ) RETURNING id, customer_id, status, product_name, quantity, quantity_num,
                         frequency, time_slot, cost_per_day_paise, plan_type, duration_label,
                         total_amount_paise, notes, next_delivery, razorpay_subscription_id, created_at`,
            [
              request.customer.id,
              productName,
              sizeStr,
              parseLitresFromSize(sizeStr),
              dailyRatePaise,
              insertStatus,
              insertNextDelivery,
              durationLabel,
              totalAmountPaise,
              subId,
              gatewaySub?.plan_id || null,
              JSON.stringify({
                ...(gatewaySub?.notes || {}),
                subscriptionId: subId,
                razorpay_subscription_id: subId,
                paymentId,
                authType: isMandateOnlyAuth ? 'mandate_only' : 'recurring_charge',
                authAmountPaise: gatewayPayment.amount,
                mandateStatus: isMandateOnlyAuth ? 'authenticated' : (gatewaySub?.status || 'authenticated'),
                mandateAuthorized: true,
                mandatePaymentId: paymentId,
                paidCount: isCapturedBillingCyclePayment ? (gatewaySub?.paid_count || 1) : 0,
                fulfillmentEntitled: isCapturedBillingCyclePayment,
                start_at: gatewaySub?.start_at || null,
                startDate: gatewayStartAtYMD || null,
                reconciledAt: new Date().toISOString()
              })
            ]
          );
          subRow = insertRes.rows[0];
          isNewlyActivated = isCapturedBillingCyclePayment;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
  }

  // 7. Check local subscription state & paid-through entitlement
  const gatewayStartAtYMD = gatewaySub?.start_at && Number.isFinite(gatewaySub.start_at)
    ? new Date(gatewaySub.start_at * 1000).toISOString().slice(0, 10)
    : null;
  const existingNotes = typeof subRow?.notes === 'object' && subRow?.notes !== null ? subRow.notes : {};
  const effectiveStartDate = gatewayStartAtYMD || existingNotes.startDate || (subRow?.created_at ? formatDateYMD(new Date(subRow.created_at)) : null);

  const paidThroughYMD = derivePaidThroughDate({
    startDate: effectiveStartDate,
    paidThroughDate: existingNotes.paidThroughDate,
    current_end: gatewaySub?.current_end,
    cost_per_day_paise: subRow?.cost_per_day_paise,
    total_amount_paise: subRow?.total_amount_paise || expectedPlanAmount,
    paidCount: isCapturedBillingCyclePayment ? (Number(gatewaySub?.paid_count) || 1) : (Number(existingNotes.paidCount) || 0),
    months: gatewaySub?.notes?.months || existingNotes.months || 1
  });

  const todayYMD = new Date().toISOString().slice(0, 10);
  const isEntitlementCurrent = Boolean(paidThroughYMD && paidThroughYMD >= todayYMD);

  // Premature completed expiry occurs ONLY if Razorpay marked completed on total_count = 1
  // AND full cycle payment was captured AND the paid entitlement has not elapsed.
  const isPrematureCompletedExpiry = Boolean(
    subRow &&
    subRow.status === 'expired' &&
    isCapturedBillingCyclePayment &&
    isEntitlementCurrent
  );

  if (subRow && (['cancelled', 'paused'].includes(subRow.status) || (subRow.status === 'expired' && !isPrematureCompletedExpiry))) {
    return reply.code(409).send({
      verified: false,
      error: subRow.status === 'expired' ? 'subscription_expired' : 'subscription_state_conflict',
      message: subRow.status === 'expired'
        ? 'Subscription paid entitlement period has already elapsed and cannot be reactivated.'
        : `Subscription is currently in '${subRow.status}' status and cannot be reactivated via verification.`,
      status: subRow.status
    });
  }

  // 8. Validation against server-side records if existing draft or prematurely expired subscription
  if (subRow && (subRow.status === 'pending_authorization' || isPrematureCompletedExpiry)) {
    // Validate plan ID
    if (subRow.razorpay_plan_id && gatewaySub.plan_id && subRow.razorpay_plan_id !== gatewaySub.plan_id) {
      return reply.code(400).send({
        verified: false,
        error: 'subscription_plan_mismatch',
        message: 'Subscription plan on gateway does not match local record.'
      });
    }

    // Validate product name compatibility
    if (gatewaySub.notes?.productName && subRow.product_name) {
      const isGatewayCow = gatewaySub.notes.productName.toLowerCase().includes('cow');
      const isSubCow = subRow.product_name.toLowerCase().includes('cow');
      if (isGatewayCow !== isSubCow) {
        return reply.code(400).send({
          verified: false,
          error: 'subscription_product_mismatch',
          message: 'Gateway product does not match registered subscription product.'
        });
      }
    }

    if (isMandateOnlyAuth) {
      // Mandate-only authorization: do NOT activate fulfillment!
      // Persist authenticated mandate state separately in notes.
      const updatedNotes = {
        ...existingNotes,
        subscriptionId: subId,
        razorpay_subscription_id: subId,
        mandateStatus: 'authenticated',
        mandateAuthorized: true,
        mandateAuthorizedAt: new Date().toISOString(),
        mandatePaymentId: paymentId,
        mandateAuthAmountPaise: gatewayPayment.amount,
        authType: 'mandate_only',
        gatewayStatus: gatewaySub?.status || 'authenticated',
        paidCount: 0,
        fulfillmentEntitled: false,
        start_at: gatewaySub?.start_at || existingNotes.start_at || null,
        startDate: gatewayStartAtYMD || existingNotes.startDate || null,
        verifiedAt: new Date().toISOString()
      };

      await pool.query(
        `UPDATE customer_subscriptions
         SET razorpay_subscription_id = COALESCE(razorpay_subscription_id, $1),
             notes = $2::jsonb,
             updated_at = NOW()
         WHERE id = $3`,
        [subId, JSON.stringify(updatedNotes), subRow.id]
      );

      subRow.notes = updatedNotes;
      const startDate = await deriveAuthoritativeSubscriptionStartDate(pool, subRow, gatewaySub);

      return {
        verified: true,
        subscriptionId: subId,
        paymentId,
        status: subRow.status, // stays 'pending_authorization'
        mandateStatus: 'authenticated',
        fulfillmentEntitled: false,
        startDate,
        nextDelivery: subRow.next_delivery || 'Pending Billing Cycle Payment',
        message: 'Mandate authenticated successfully. Awaiting captured billing-cycle payment to activate deliveries.'
      };
    }

    // Verified captured billing-cycle payment: activate fulfillment!
    const futureNextDelivery = gatewayStartAtYMD && gatewayStartAtYMD > new Date().toISOString().slice(0, 10)
      ? `${gatewayStartAtYMD}, 6:00 AM – 7:00 AM`
      : (subRow.next_delivery || 'Tomorrow, 6:00 AM');

    const updatedNotes = {
      ...existingNotes,
      subscriptionId: subId,
      razorpay_subscription_id: subId,
      lastPaymentId: paymentId,
      gatewayStatus: gatewaySub?.status || 'active',
      billingStatus: gatewaySub?.status === 'completed' ? 'completed' : 'active',
      paidCount: isCapturedBillingCyclePayment ? (Number(gatewaySub?.paid_count) || 1) : (Number(existingNotes.paidCount) || 0),
      paidThroughDate: paidThroughYMD,
      fulfillmentEntitled: true,
      authType: 'recurring_charge',
      authAmountPaise: gatewayPayment.amount,
      start_at: gatewaySub?.start_at || existingNotes.start_at || null,
      startDate: gatewayStartAtYMD || existingNotes.startDate || null,
      verifiedAt: new Date().toISOString()
    };

    const updateRes = await pool.query(
      `UPDATE customer_subscriptions
       SET status = 'active',
           razorpay_subscription_id = COALESCE(razorpay_subscription_id, $1),
           next_delivery = $2,
           notes = $3::jsonb,
           updated_at = NOW()
       WHERE id = $4 AND (status = 'pending_authorization' OR (status = 'expired' AND $5::boolean))
       RETURNING id`,
      [subId, futureNextDelivery, JSON.stringify(updatedNotes), subRow.id, isPrematureCompletedExpiry]
    );

    if (updateRes.rows.length > 0) {
      subRow.status = 'active';
      subRow.next_delivery = futureNextDelivery;
      subRow.notes = updatedNotes;
      isNewlyActivated = true;
    } else {
      // Concurrently updated by another request/worker: reread actual database state
      const freshRes = await pool.query(
        `SELECT cs.id, cs.customer_id, cs.status, cs.product_name, cs.quantity, cs.quantity_num,
                cs.cost_per_day_paise, cs.total_amount_paise, cs.frequency, cs.time_slot,
                cs.notes, cs.next_delivery, cs.razorpay_subscription_id, cs.razorpay_plan_id, cs.created_at
         FROM customer_subscriptions cs
         WHERE cs.id = $1`,
        [subRow.id]
      );
      if (freshRes.rows.length > 0) {
        subRow = freshRes.rows[0];
      }
      isNewlyActivated = false;

      // Never report active if the record was concurrently paused, cancelled or truly expired
      if (['cancelled', 'paused'].includes(subRow.status) || (subRow.status === 'expired' && !isPrematureCompletedExpiry)) {
        return reply.code(409).send({
          verified: false,
          error: 'subscription_state_conflict',
          message: `Subscription is currently in '${subRow.status}' status and cannot be verified as active.`,
          status: subRow.status
        });
      }
    }
  }

  // 9. If subscription was already active (e.g. preceding webhook arrived before verify):
  if (!isNewlyActivated && subRow && subRow.status === 'active') {
    const existingNotes = typeof subRow.notes === 'object' && subRow.notes !== null ? subRow.notes : {};
    let notesChanged = false;
    const notesPatch = { ...existingNotes };

    if (isMandateOnlyAuth) {
      // Mandate authorization payment reference: record mandatePaymentId and NEVER overwrite captured lastPaymentId
      if (notesPatch.mandatePaymentId !== paymentId) {
        notesPatch.mandatePaymentId = paymentId;
        notesPatch.mandateStatus = 'authenticated';
        notesPatch.mandateAuthorized = true;
        notesChanged = true;
      }
    } else if (isCapturedBillingCyclePayment) {
      // Captured billing-cycle recurring charge
      if (notesPatch.lastPaymentId !== paymentId) {
        notesPatch.lastPaymentId = paymentId;
        notesChanged = true;
      }
    }

    if (notesChanged) {
      await pool.query(
        `UPDATE customer_subscriptions
         SET notes = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(notesPatch), subRow.id]
      );
      subRow.notes = notesPatch;
    }
  }

  // 10. Authoritative Start Date derivation
  const startDate = await deriveAuthoritativeSubscriptionStartDate(pool, subRow, gatewaySub);

  // 11. Send confirmation email and queue SMS ONLY if newly transitioned to active (Requirement 6)
  if (isNewlyActivated) {
    sendSubscriptionConfirmationEmails(pool, { subscriptionId: subId, paymentId }).catch((err) => {
      app.log.error({ err }, '[Email] Failed to send subscription confirmation email on verify');
    });

    const targetPhone = subRow.phone || request.customer.phone;
    const notificationsEnabled = subRow.sms_notifications_enabled !== undefined
      ? subRow.sms_notifications_enabled
      : request.customer.sms_notifications_enabled;

    if (notificationProvider()==='whatsapp') {
      await queuePaidSubscriptionActivation(pool,subRow.id);
    } else if (targetPhone && notificationsEnabled !== false) {
      queueNotification(pool, {
        customerId: request.customer.id,
        phone: targetPhone,
        templateKey: 'SUBSCRIPTION_ACTIVATED',
        params: {
          productName: subRow.product_name || gatewaySub?.notes?.productName || 'Milk',
          quantity: subRow.quantity || gatewaySub?.notes?.size || '1 Litre',
          startDate: startDate || 'tomorrow'
        },
        idempotencyKey: `sms_sub_activated_${subRow.id || subId}`
      }).catch(() => {});
      setImmediate(() => processNotificationOutbox(pool, 10, process.env.NODE_ENV==='test' ? {fetchImpl:app.whatsappFetch || undefined} : undefined).catch(() => {}));
    }
  }

  const finalNotes = typeof subRow.notes === 'object' && subRow.notes !== null ? subRow.notes : {};
  const effectivePaidThrough = finalNotes.paidThroughDate || (isCapturedBillingCyclePayment ? paidThroughYMD : null);
  const hasValidPaidThrough = Boolean(effectivePaidThrough && effectivePaidThrough >= todayYMD);

  // Require verified captured billing-cycle evidence and a valid paid-through date
  // NEVER infer fulfillmentEntitled from status = 'active' alone!
  const hasVerifiedPaymentEvidence = Boolean(
    (finalNotes.lastPaymentId || (isCapturedBillingCyclePayment && paymentId)) &&
    (finalNotes.fulfillmentEntitled === true || isCapturedBillingCyclePayment) &&
    hasValidPaidThrough
  );

  const authoritativeFulfillmentEntitled = Boolean(hasVerifiedPaymentEvidence);

  // NEVER default unknown paidCount to 1! If no verified payment, paidCount is 0.
  let authoritativePaidCount = 0;
  if (finalNotes.paidCount !== undefined && Number.isInteger(Number(finalNotes.paidCount))) {
    authoritativePaidCount = Number(finalNotes.paidCount);
  } else if (hasVerifiedPaymentEvidence && gatewaySub?.paid_count !== undefined && Number.isInteger(Number(gatewaySub.paid_count))) {
    authoritativePaidCount = Number(gatewaySub.paid_count);
  } else if (hasVerifiedPaymentEvidence) {
    authoritativePaidCount = 1;
  } else {
    authoritativePaidCount = 0;
  }

  return reply.code(200).send({
    verified: true,
    subscriptionId: subId,
    paymentId,
    status: subRow.status,
    mandateStatus: finalNotes.mandateStatus || (gatewaySub?.status === 'authenticated' ? 'authenticated' : 'authenticated'),
    fulfillmentEntitled: authoritativeFulfillmentEntitled,
    paidCount: authoritativePaidCount,
    paidThroughDate: authoritativeFulfillmentEntitled ? (finalNotes.paidThroughDate || paidThroughYMD) : null,
    startDate,
    nextDelivery: subRow.next_delivery,
    message: isNewlyActivated ? 'Subscription verified and activated' : 'Subscription already active'
  });
});

// Razorpay Subscription return callback (with signature verification & open-redirect protection)
app.all('/api/v1/subscriptions/callback', async (request, reply) => {
  const ALLOWED_REDIRECT_HOSTS = ['milvanta.in', 'www.milvanta.in', 'localhost', '127.0.0.1'];
  let safeReturnUrl = 'https://milvanta.in/';
  try {
    const rawTarget = request.query?.return_url || request.body?.return_url;
    if (rawTarget) {
      const parsed = new URL(rawTarget, 'https://milvanta.in/');
      if (ALLOWED_REDIRECT_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
        safeReturnUrl = rawTarget;
      }
    }
  } catch {}

  const subId = request.body?.razorpay_subscription_id || request.query?.razorpay_subscription_id;
  const paymentId = request.body?.razorpay_payment_id || request.query?.razorpay_payment_id;
  const signature = request.body?.razorpay_signature || request.query?.razorpay_signature;

  const separator = safeReturnUrl.includes('?') ? '&' : '?';

  // If missing critical payment identifiers, reject without activation
  if (!subId || !paymentId || !signature) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=missing_payment_proof`, 302);
  }

  if (!process.env.RAZORPAY_KEY_SECRET || !razorpay) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=server_configuration_error`, 302);
  }

  // 1. Verify HMAC signature: HMAC-SHA256(payment_id + '|' + subscription_id)
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${paymentId}|${subId}`)
    .digest();
  const supplied = Buffer.from(signature, 'hex');

  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=invalid_signature`, 302);
  }

  // 2. Authoritative payment-state check with Razorpay gateway (Requirement 5)
  let gatewaySub, gatewayPayment;
  try {
    [gatewaySub, gatewayPayment] = await Promise.all([
      razorpay.subscriptions.fetch(subId),
      razorpay.payments.fetch(paymentId)
    ]);
  } catch {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=gateway_fetch_failed`, 302);
  }

  const isSubAuthorized = ['active', 'authenticated', 'completed'].includes(gatewaySub?.status);
  const isPaymentAuthorized = ['captured', 'authorized'].includes(gatewayPayment?.status);
  if (!isSubAuthorized || !isPaymentAuthorized) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=payment_not_authorized`, 302);
  }

  // Do not silently accept missing or non-INR currency
  if (!gatewayPayment?.currency || gatewayPayment.currency !== 'INR') {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=payment_currency_mismatch`, 302);
  }

  // Do not silently accept missing amount
  if (typeof gatewayPayment?.amount !== 'number' || gatewayPayment.amount <= 0) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=invalid_payment_amount`, 302);
  }

  // Reject explicitly different payment.subscription_id or contradictory notes immediately
  if (gatewayPayment?.subscription_id && gatewayPayment.subscription_id !== subId) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=payment_subscription_mismatch`, 302);
  }
  const callbackSubNote = gatewayPayment?.notes?.subscriptionId || gatewayPayment?.notes?.subscription_id || gatewayPayment?.notes?.razorpay_subscription_id;
  if (callbackSubNote && callbackSubNote !== subId) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=payment_subscription_mismatch`, 302);
  }

  // Verify plan amount using Razorpay's actual plan data
  const expectedPlanAmount = await resolveGatewayPlanAmount(razorpay, gatewaySub);
  const isFullPlanCharge = expectedPlanAmount !== null && gatewayPayment.amount === expectedPlanAmount;
  const isRefundableAuth = Boolean(
    expectedPlanAmount !== null &&
    isSubAuthorized &&
    isPaymentAuthorized &&
    (
      gatewaySub?.status === 'authenticated' ||
      gatewayPayment?.notes?.auth_type === 'refundable' ||
      gatewayPayment?.notes?.auth_type === 'mandate_auth' ||
      gatewaySub?.notes?.auth_type === 'refundable' ||
      (!gatewayPayment?.invoice_id && gatewayPayment.amount <= 50000)
    )
  );

  if (!isFullPlanCharge && !isRefundableAuth) {
    return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=subscription_amount_mismatch`, 302);
  }

  // 3. Database check and customer ownership validation (Requirement 5)
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id, customer_id, status, notes, next_delivery
         FROM customer_subscriptions
         WHERE razorpay_subscription_id = $1 
            OR notes->>'subscriptionId' = $1 
            OR notes->>'razorpay_subscription_id' = $1 
            OR notes->>'subscription_id' = $1 
            OR id::text = $1`,
        [subId]
      );
      const subRow = rows[0];

      if (!subRow) {
        return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=subscription_not_found`, 302);
      }

      // Authoritative payment and subscription linkage check
      const callbackLinkage = await verifyPaymentSubscriptionLinkage({
        razorpayClient: razorpay,
        gatewaySub,
        gatewayPayment,
        subId,
        paymentId,
        signatureValid: true,
        existingSubRow: subRow
      });

      if (!callbackLinkage.linked) {
        return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=${callbackLinkage.error || 'payment_subscription_mismatch'}`, 302);
      }

      const isCapturedBillingCyclePayment = Boolean(
        isFullPlanCharge &&
        gatewayPayment?.status === 'captured' &&
        ['active', 'completed'].includes(gatewaySub?.status) &&
        (gatewaySub?.paid_count !== undefined ? Number(gatewaySub.paid_count) >= 1 : true)
      );

      const isMandateOnlyAuth = Boolean(
        !isCapturedBillingCyclePayment &&
        (isRefundableAuth || gatewaySub?.status === 'authenticated' || Number(gatewaySub?.paid_count || 0) === 0)
      );

      // Reject ambiguous or authorized-but-not-captured full-price transactions without activating deliveries
      if (isFullPlanCharge && gatewayPayment?.status !== 'captured') {
        return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=payment_not_captured`, 302);
      }

      if (!isCapturedBillingCyclePayment && !isMandateOnlyAuth) {
        return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=ambiguous_payment_state`, 302);
      }

      const gatewayStartAtYMD = gatewaySub?.start_at && Number.isFinite(gatewaySub.start_at)
        ? new Date(gatewaySub.start_at * 1000).toISOString().slice(0, 10)
        : null;
      const existingNotes = typeof subRow.notes === 'object' && subRow.notes !== null ? subRow.notes : {};
      const effectiveStartDate = gatewayStartAtYMD || existingNotes.startDate || (subRow.created_at ? formatDateYMD(new Date(subRow.created_at)) : null);

      const paidThroughYMD = derivePaidThroughDate({
        startDate: effectiveStartDate,
        paidThroughDate: existingNotes.paidThroughDate,
        current_end: gatewaySub?.current_end,
        cost_per_day_paise: subRow.cost_per_day_paise,
        total_amount_paise: subRow.total_amount_paise || expectedPlanAmount,
        paidCount: isCapturedBillingCyclePayment ? (Number(gatewaySub?.paid_count) || 1) : (Number(existingNotes.paidCount) || 0),
        months: gatewaySub?.notes?.months || existingNotes.months || 1
      });

      const todayYMD = new Date().toISOString().slice(0, 10);
      const isEntitlementCurrent = Boolean(paidThroughYMD && paidThroughYMD >= todayYMD);

      const isPrematureCompletedExpiry = Boolean(
        subRow &&
        subRow.status === 'expired' &&
        isCapturedBillingCyclePayment &&
        isEntitlementCurrent
      );

      // Prevent resurrecting cancelled, paused or truly expired subscriptions
      if (['cancelled', 'paused'].includes(subRow.status) || (subRow.status === 'expired' && !isPrematureCompletedExpiry)) {
        return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=${subRow.status === 'expired' ? 'subscription_expired' : 'subscription_state_conflict'}`, 302);
      }

      // Verify customer ownership if gateway metadata provides customerId
      const gatewayCustId = gatewaySub?.notes?.customerId || gatewaySub?.notes?.customer_id;
      if (gatewayCustId && String(gatewayCustId) !== String(subRow.customer_id)) {
        return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=subscription_forbidden`, 302);
      }

      // If subscription was already activated by webhook with paid entitlement:
      if (subRow.status === 'active' && existingNotes.fulfillmentEntitled === true) {
        if (isMandateOnlyAuth && existingNotes.mandatePaymentId !== paymentId) {
          await pool.query(
            `UPDATE customer_subscriptions
             SET notes = jsonb_set(
                   COALESCE(notes, '{}'::jsonb),
                   '{mandatePaymentId}',
                   to_jsonb($1::text)
                 ),
                 updated_at = NOW()
             WHERE id = $2`,
            [paymentId, subRow.id]
          );
        } else if (isCapturedBillingCyclePayment && existingNotes.lastPaymentId !== paymentId) {
          await pool.query(
            `UPDATE customer_subscriptions
             SET notes = jsonb_set(
                   COALESCE(notes, '{}'::jsonb),
                   '{lastPaymentId}',
                   to_jsonb($1::text)
                 ),
                 updated_at = NOW()
             WHERE id = $2`,
            [paymentId, subRow.id]
          );
        }
        return reply.redirect(`${safeReturnUrl}${separator}subscription=success&payment_id=${encodeURIComponent(paymentId)}`, 302);
      }

      // If mandate-only authorization: persist mandate state separately without activating fulfillment
      if (isMandateOnlyAuth) {
        await pool.query(
          `UPDATE customer_subscriptions 
           SET notes = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(
                       COALESCE(notes, '{}'::jsonb),
                       '{mandateStatus}',
                       '"authenticated"'
                     ),
                     '{mandatePaymentId}',
                     to_jsonb($1::text)
                   ),
                   '{gatewayStatus}',
                   to_jsonb($2::text)
                 ),
                 '{fulfillmentEntitled}',
                 'false'::jsonb
               ),
               updated_at = NOW() 
           WHERE id = $3`,
          [paymentId, gatewaySub?.status || 'authenticated', subRow.id]
        );
        return reply.redirect(`${safeReturnUrl}${separator}subscription=mandate_authenticated&payment_id=${encodeURIComponent(paymentId)}`, 302);
      }

      // Activate if pending_authorization or reconcile premature expiry
      if (subRow.status === 'pending_authorization' || isPrematureCompletedExpiry) {
        const futureNextDelivery = gatewayStartAtYMD && gatewayStartAtYMD > new Date().toISOString().slice(0, 10)
          ? `${gatewayStartAtYMD}, 6:00 AM – 7:00 AM`
          : (subRow.next_delivery || 'Tomorrow, 6:00 AM');

        const updateRes = await pool.query(
          `UPDATE customer_subscriptions 
           SET status = 'active', 
               razorpay_subscription_id = COALESCE(razorpay_subscription_id, $1), 
               next_delivery = $2,
               notes = $3::jsonb,
               updated_at = NOW() 
           WHERE id = $4 AND (status = 'pending_authorization' OR (status = 'expired' AND $5::boolean))
           RETURNING id`,
          [
            subId,
            futureNextDelivery,
            JSON.stringify({
              ...existingNotes,
              subscriptionId: subId,
              razorpay_subscription_id: subId,
              lastPaymentId: paymentId,
              gatewayStatus: gatewaySub?.status || 'active',
              billingStatus: gatewaySub?.status === 'completed' ? 'completed' : 'active',
              paidCount: isCapturedBillingCyclePayment ? (Number(gatewaySub?.paid_count) || 1) : (Number(existingNotes.paidCount) || 0),
              paidThroughDate: paidThroughYMD,
              fulfillmentEntitled: true,
              authType: 'recurring_charge',
              authAmountPaise: gatewayPayment.amount,
              start_at: gatewaySub?.start_at || existingNotes.start_at || null,
              startDate: gatewayStartAtYMD || existingNotes.startDate || null,
              activatedVia: 'callback',
              verifiedAt: new Date().toISOString()
            }),
            subRow.id,
            isPrematureCompletedExpiry
          ]
        );
        if (updateRes.rows.length > 0) {
          sendSubscriptionConfirmationEmails(pool, { subscriptionId: subId, paymentId }).catch((err) => {
            app.log.error({ err }, '[Email] Failed to send subscription confirmation email on callback');
          });
        } else {
          // Concurrently updated by another request/worker: reread actual database state
          const freshRes = await pool.query('SELECT status FROM customer_subscriptions WHERE id = $1', [subRow.id]);
          if (freshRes.rows.length > 0 && (['cancelled', 'paused'].includes(freshRes.rows[0].status) || (freshRes.rows[0].status === 'expired' && !isPrematureCompletedExpiry))) {
            return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=subscription_state_conflict`, 302);
          }
        }
      }
    } catch (dbErr) {
      app.log.error({ dbErr }, 'Error processing subscription callback in DB');
      return reply.redirect(`${safeReturnUrl}${separator}subscription=failed&error=database_error`, 302);
    }
  }

  return reply.redirect(`${safeReturnUrl}${separator}subscription=success&payment_id=${encodeURIComponent(paymentId)}`, 302);
});

// Explicit endpoint to trigger or resend subscription confirmation emails (authenticated)
app.post('/api/v1/subscriptions/send-confirmation', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });

  const { subscriptionId } = request.body || {};
  if (!subscriptionId) {
    return reply.code(400).send({
      error: 'subscription_id_required',
      message: 'An existing subscription ID is required to send confirmation.'
    });
  }

  // 1. Authoritative DB lookup: Must be an existing subscription belonging to the authenticated customer
  const isNumeric = typeof subscriptionId === 'number' || (/^\d+$/.test(String(subscriptionId).trim()) && !String(subscriptionId).includes('-'));
  const { rows } = await pool.query(
    isNumeric
      ? `SELECT cs.*, c.full_name, c.email, c.phone 
         FROM customer_subscriptions cs 
         JOIN customers c ON c.id = cs.customer_id 
         WHERE cs.id = $1`
      : `SELECT cs.*, c.full_name, c.email, c.phone 
         FROM customer_subscriptions cs 
         JOIN customers c ON c.id = cs.customer_id 
         WHERE cs.id::text = $1 OR cs.razorpay_subscription_id = $1 OR cs.notes->>'subscriptionId' = $1 OR cs.notes->>'razorpay_subscription_id' = $1`,
    [String(subscriptionId)]
  );

  if (!rows.length) {
    return reply.code(404).send({
      error: 'subscription_not_found',
      message: 'Subscription record does not exist.'
    });
  }

  const sub = rows[0];

  // 2. Reject unauthorized customer access
  if (Number(sub.customer_id) !== Number(request.customer.id) && !request.isAdmin) {
    return reply.code(403).send({
      error: 'forbidden',
      message: 'You do not have permission to trigger confirmation for this subscription.'
    });
  }

  // 3. Require authoritative verified payment or mandate state
  const isMandateAuth = Boolean(
    sub.notes?.authType === 'refundable_authorization' ||
    sub.notes?.isRefundableAuth ||
    sub.auth_type === 'refundable_authorization' ||
    (sub.razorpay_subscription_id && sub.status === 'active')
  );
  const serverNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
  // Derive payment email idempotency key strictly from server-side verified records
  const serverPaymentId = serverNotes.lastPaymentId || serverNotes.paymentId || serverNotes.mandatePaymentId || sub.razorpay_subscription_id;
  const isAuthorized = sub.status === 'active' || (sub.status === 'paused' && serverNotes.paymentId) || (isMandateAuth && sub.status !== 'cancelled');

  if (!isAuthorized) {
    return reply.code(422).send({
      error: 'subscription_not_verified',
      message: 'Subscription does not have an authoritative verified payment or active mandate state.'
    });
  }

  // 4. Send confirmation using ONLY authoritative database data, never untrusted frontend cart data
  const result = await sendSubscriptionConfirmationEmails(pool, sub, {
    paymentId: serverPaymentId || sub.razorpay_subscription_id || '',
    customerEmail: sub.email || request.customer.email,
    customerName: sub.full_name || request.customer.full_name
  });

  return reply.send(result);
});

/**
 * Customer-authenticated, read-only subscription status endpoint.
 * Looks up local database subscription record and gateway billing state.
 * Distinguishes active-and-paid, mandate-authorized-awaiting-payment, failed, cancelled and pending.
 * Returns authoritative state without requiring a signature or triggering payments.
 */
async function handleSubscriptionStatus(request, reply) {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const rawId = String(request.params.id || '').trim();
  if (!rawId) {
    return reply.code(400).send({ error: 'invalid_subscription_id', message: 'Subscription ID is required.' });
  }

  // 1. Look up subscription by Razorpay subscription ID, notes, or integer ID
  const { rows } = await pool.query(
    `SELECT cs.*, c.phone as customer_phone, c.email as customer_email, c.full_name as customer_name
     FROM customer_subscriptions cs
     JOIN customers c ON c.id = cs.customer_id
     WHERE (cs.razorpay_subscription_id = $1 
            OR cs.notes->>'subscriptionId' = $1 
            OR cs.notes->>'razorpay_subscription_id' = $1 
            OR cs.notes->>'subscription_id' = $1 
            OR cs.id::text = $1)
     ORDER BY cs.id DESC LIMIT 1`,
    [rawId]
  );

  const sub = rows[0];

  // 2. If not found in local DB, check Razorpay gateway (if sub_ prefix)
  if (!sub) {
    if (rawId.startsWith('sub_') && razorpay) {
      try {
        const gatewaySub = await razorpay.subscriptions.fetch(rawId);
        const gatewayCustId = gatewaySub?.notes?.customerId || gatewaySub?.notes?.customer_id;

        // Positively verified customer ownership is REQUIRED for gateway-only queries
        if (!gatewayCustId && !request.isAdmin) {
          // Ownership missing or ambiguous: do not disclose subscription details
          return reply.code(404).send({
            error: 'subscription_not_found',
            message: 'Subscription record does not exist.'
          });
        }

        if (String(gatewayCustId) !== String(request.customer.id) && !request.isAdmin) {
          return reply.code(403).send({
            error: 'subscription_forbidden',
            message: 'Subscription belongs to another customer.'
          });
        }

        // Ownership is positively proven, but local record is not yet reconciled
        return reply.code(200).send({
          success: true,
          subscriptionId: rawId,
          localSubscriptionId: null,
          status: 'pending_reconciliation',
          state: 'pending_reconciliation',
          fulfillmentEntitled: false,
          isPaid: false,
          paidCount: 0,
          paidThroughDate: null,
          nextDelivery: 'Pending Reconciliation',
          mandateStatus: gatewaySub?.status === 'authenticated' ? 'authenticated' : null,
          profileUrl: '/profile.html?tab=subscription',
          message: 'Subscription authorization is syncing with store records. Awaiting secure reconciliation.'
        });
      } catch {
        return reply.code(404).send({
          error: 'subscription_not_found',
          message: 'Subscription record does not exist.'
        });
      }
    }
    return reply.code(404).send({
      error: 'subscription_not_found',
      message: 'Subscription record does not exist.'
    });
  }

  // 3. Customer ownership check
  if (Number(sub.customer_id) !== Number(request.customer.id) && !request.isAdmin) {
    return reply.code(403).send({
      error: 'subscription_forbidden',
      message: 'You do not have permission to view this subscription.'
    });
  }

  // 4. Derive authoritative state
  const notes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
  const todayYMD = new Date().toISOString().slice(0, 10);
  const isFulfillmentEntitled = Boolean(notes.fulfillmentEntitled);
  const paidThroughDate = notes.paidThroughDate || null;
  const hasValidPaidThrough = Boolean(paidThroughDate && paidThroughDate >= todayYMD);
  const hasVerifiedPayment = Boolean(
    (notes.lastPaymentId || notes.paymentId) &&
    isFulfillmentEntitled &&
    hasValidPaidThrough
  );

  let state = 'pending';
  let isPaid = false;
  let paidCount = 0;

  if (['cancelled', 'paused', 'expired'].includes(sub.status)) {
    state = sub.status;
    isPaid = Boolean(hasVerifiedPayment);
    paidCount = Number(notes.paidCount) || (isPaid ? 1 : 0);
  } else if (sub.status === 'active') {
    if (hasVerifiedPayment) {
      state = 'active_paid';
      isPaid = true;
      paidCount = Number.isInteger(Number(notes.paidCount)) && Number(notes.paidCount) > 0 ? Number(notes.paidCount) : 1;
    } else {
      // Legacy subscription without payment evidence (e.g. #70)
      state = 'active_unverified';
      isPaid = false;
      paidCount = 0;
    }
  } else if (sub.status === 'pending_authorization') {
    const isMandateAuth = Boolean(
      notes.mandateStatus === 'authenticated' ||
      notes.mandateAuthorized ||
      notes.authType === 'mandate_only'
    );
    if (isMandateAuth) {
      state = 'mandate_authorized_awaiting_payment';
      isPaid = false;
      paidCount = 0;
    } else {
      state = 'pending';
      isPaid = false;
      paidCount = 0;
    }
  }

  const effectiveFulfillmentEntitled = Boolean(sub.status === 'active' && hasVerifiedPayment);

  return reply.code(200).send({
    success: true,
    subscriptionId: sub.razorpay_subscription_id || notes.subscriptionId || String(sub.id),
    localSubscriptionId: sub.id,
    productName: sub.product_name,
    quantity: sub.quantity,
    status: sub.status,
    state,
    fulfillmentEntitled: effectiveFulfillmentEntitled,
    isPaid,
    paidCount,
    paidThroughDate: effectiveFulfillmentEntitled ? paidThroughDate : null,
    nextDelivery: sub.next_delivery,
    mandateStatus: notes.mandateStatus || (state === 'mandate_authorized_awaiting_payment' ? 'authenticated' : null),
    lastPaymentId: notes.lastPaymentId || notes.paymentId || null,
    profileUrl: '/profile.html?tab=subscription',
    message: state === 'active_paid'
      ? 'Subscription is active and paid.'
      : (state === 'mandate_authorized_awaiting_payment'
        ? 'Mandate authorized — awaiting first recurring billing payment.'
        : (state === 'active_unverified'
          ? 'Subscription is awaiting verified billing cycle evidence.'
          : `Subscription is currently in ${state} state.`))
  });
}


// Customer-authenticated read-only subscription status endpoint (routes support both :id/status and status/:id)
app.get('/api/v1/subscriptions/:id/status', { preHandler: app.authenticate }, handleSubscriptionStatus);
app.get('/api/v1/subscriptions/status/:id', { preHandler: app.authenticate }, handleSubscriptionStatus);

// ---------- Server-Authoritative Subscription Management ----------
app.get('/api/v1/subscriptions/:id', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });

  const { rows } = await pool.query(
    `SELECT cs.*, c.phone, c.full_name, c.email
     FROM customer_subscriptions cs
     JOIN customers c ON c.id = cs.customer_id
     WHERE cs.id = $1 AND cs.customer_id = $2`,
    [subId, request.customer.id]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'subscription_not_found' });

  const sub = rows[0];

  // Fetch recent delivery orders
  const { rows: deliveries } = await pool.query(
    `SELECT delivery_order_number, delivery_date, status, delivered_at, failed_reason
     FROM subscription_delivery_orders
     WHERE subscription_id = $1
     ORDER BY delivery_date DESC LIMIT 10`,
    [subId]
  );

  // Fetch active pauses or vacation
  const { rows: activePauses } = await pool.query(
    `SELECT id, pause_start_date, pause_end_date, reason, created_at
     FROM subscription_delivery_pauses
     WHERE subscription_id = $1 AND resumed_at IS NULL
     ORDER BY pause_start_date DESC`,
    [subId]
  );

  return reply.send({
    subscription: sub,
    deliveries,
    activePauses,
    nextDelivery: sub.next_delivery
  });
});

app.post('/api/v1/subscriptions/:id/pause', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { startDate, endDate, reason } = request.body || {};

  const result = await pauseSubscription(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    startDate,
    endDate,
    reason
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.post('/api/v1/subscriptions/:id/resume', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });

  const result = await resumeSubscription(pool, {
    subscriptionId: subId,
    customerId: request.customer.id
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.post('/api/v1/subscriptions/:id/skip-date', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { skipDate, reason } = request.body || {};

  const result = await skipDeliveryDate(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    skipDate,
    reason
  });

  if (!result.success) {
    const status = result.error === 'cutoff_passed' ? 422 : (result.statusCode || 400);
    return reply.code(status).send(result);
  }
  return reply.send(result);
});

app.delete('/api/v1/subscriptions/:id/skip-date', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const skipDate = request.query?.skipDate || request.body?.skipDate;

  const result = await unskipDeliveryDate(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    skipDate
  });

  if (!result.success) {
    const status = result.error === 'cutoff_passed' ? 422 : (result.statusCode || 400);
    return reply.code(status).send(result);
  }
  return reply.send(result);
});

app.post('/api/v1/subscriptions/:id/vacation', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { startDate, endDate, reason } = request.body || {};

  const result = await setVacation(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    startDate,
    endDate,
    reason
  });

  if (!result.success) {
    const status = result.error === 'cutoff_passed' ? 422 : (result.statusCode || 400);
    return reply.code(status).send(result);
  }
  return reply.send(result);
});

app.get('/api/v1/subscriptions/:id/cancellation-preview', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });

  const entitlement = await calculateSubscriptionEntitlement(pool, {
    subscriptionId: subId,
    customerId: request.customer.id
  });

  if (!entitlement) {
    return reply.code(404).send({ error: 'subscription_not_found', statusCode: 404 });
  }

  return reply.send({
    success: true,
    entitlement: {
      ...entitlement,
      totalContractAmount: entitlement.totalContractAmountPaise / 100,
      costPerDay: entitlement.costPerDayPaise / 100,
      deliveredValue: entitlement.deliveredValuePaise / 100,
      unusedBalance: entitlement.unusedBalancePaise / 100,
      estimatedRefundable: entitlement.estimatedRefundablePaise / 100,
      alreadyRefunded: entitlement.alreadyRefundedPaise / 100,
      pendingRefund: entitlement.pendingRefundPaise / 100,
      accruedCredit: entitlement.accruedCreditPaise / 100
    }
  });
});

app.post('/api/v1/subscriptions/:id/cancel-with-refund', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { reason, customerNotes, requestedRefundAmountPaise } = request.body || {};

  const result = await cancelSubscriptionWithRefund(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    reason,
    customerNotes,
    requestedRefundAmountPaise,
    razorpayClient: razorpay
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.post('/api/v1/subscriptions/:id/cancel', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { reason } = request.body || {};

  const result = await cancelSubscription(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    reason
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.delete('/api/v1/subscriptions/:id', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });

  const result = await cancelSubscription(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    reason: 'Subscription deleted by user'
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send({ deleted: true, id: subId });
});

app.get('/api/v1/subscriptions/:id/calendar', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });
  const { year, month } = request.query || {};

  const calendar = await getSubscriptionCalendar(pool, {
    subscriptionId: subId,
    customerId: request.customer.id,
    year,
    month
  });

  if (!calendar) return reply.code(404).send({ error: 'subscription_not_found' });
  return reply.send(calendar);
});

app.get('/api/v1/subscriptions/:id/billing', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const subId = Number(request.params.id);
  if (!Number.isSafeInteger(subId) || subId <= 0) return reply.code(400).send({ error: 'invalid_subscription_id' });

  const { rows: subRows } = await pool.query(
    'SELECT * FROM customer_subscriptions WHERE id = $1 AND customer_id = $2',
    [subId, request.customer.id]
  );
  if (!subRows[0]) return reply.code(404).send({ error: 'subscription_not_found' });

  const { rows: adjustments } = await pool.query(
    'SELECT * FROM subscription_billing_adjustments WHERE subscription_id = $1 ORDER BY created_at DESC',
    [subId]
  );

  const totalExtendedDays = adjustments
    .filter(a => a.adjustment_type === 'extension')
    .reduce((sum, a) => sum + Number(a.days_count || 0), 0);

  const totalCreditPaise = adjustments
    .filter(a => a.adjustment_type === 'credit')
    .reduce((sum, a) => sum + Number(a.amount_paise || 0), 0);

  const isPrepaid = subRows[0].plan_type !== 'continuous' || !subRows[0].razorpay_subscription_id;
  const billingPolicy = isPrepaid
    ? {
        type: 'prepaid_extension',
        description: 'For prepaid subscriptions, skipped delivery dates and vacation days automatically extend your delivery calendar, guaranteeing you receive all paid deliveries.',
        extendedDays: totalExtendedDays
      }
    : {
        type: 'recurring_mandate_credit',
        description: 'For recurring mandate subscriptions with fixed billing cycles, skipped deliveries accrue billing credits rather than shifting gateway charge dates.',
        accruedCreditPaise: totalCreditPaise
      };

  return reply.send({
    subscriptionId: subId,
    planType: subRows[0].plan_type,
    durationLabel: subRows[0].duration_label,
    totalAmountPaise: subRows[0].total_amount_paise,
    costPerDayPaise: subRows[0].cost_per_day_paise,
    totalExtendedDays,
    totalCreditPaise,
    billingPolicy,
    adjustments
  });
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
  if (isPhoneVerificationMandatory() && !request.customer?.phone_verified_at) {
    return reply.code(403).send({
      error: 'phone_verification_required',
      message: 'Mobile number verification is required before placing orders. Please verify your phone number in your profile.'
    });
  }
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
  const itemMetaMap = new Map();
  for (const item of items) {
    const productId = Number(item?.productId), quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25) return reply.code(400).send({ error: 'invalid_item' });
    const totalQuantity = (quantities.get(productId) || 0) + quantity;
    if (totalQuantity > 25) return reply.code(400).send({ error: 'invalid_item' });
    quantities.set(productId, totalQuantity);
    itemMetaMap.set(productId, item);
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
      const itemMeta = itemMetaMap.get(Number(product.id)) || {};
      let pricing;
      try {
        pricing = resolveItemPricing(product, itemMeta);
      } catch (err) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'invalid_item_pricing', message: err.message });
      }
      const unitPricePaise = pricing.unitPricePaise;
      subtotal += unitPricePaise * quantity;
      orderItems.push({
        productId: Number(product.id),
        name: pricing.resolvedName || product.name,
        category: product.category,
        unit: pricing.resolvedUnit || product.selling_unit,
        imageUrl: product.image_url,
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
     FROM customer_orders
     WHERE customer_id = $1 AND order_status != 'cancelled'
     ORDER BY created_at DESC LIMIT 50`,
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

// ---------- Helper: Safe CSV Escaping & Formula Injection Protection ----------
function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  // Formula-injection protection: neutralize =, +, -, @, tab, CR
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatISTDateTime(isoOrDate) {
  if (!isoOrDate) return '';
  try {
    const d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return String(isoOrDate);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).replace(',', '');
  } catch {
    return String(isoOrDate);
  }
}

// ---------- Admin Order Management ----------
// ---------- Customer Order Refund Endpoints ----------
app.get('/api/v1/orders/:orderNumber/refund-eligibility', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { orderNumber } = request.params;
  if (!orderNumber) return reply.code(400).send({ error: 'order_number_required' });

  const eligibility = await calculateOrderRefundEligibility(pool, {
    orderNumber,
    customerId: request.customer.id
  });

  if (eligibility.error === 'order_not_found') {
    return reply.code(404).send(eligibility);
  }
  return reply.send(eligibility);
});

app.post('/api/v1/orders/:orderNumber/refund-request', { preHandler: app.authenticate }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { orderNumber } = request.params;
  if (!orderNumber) return reply.code(400).send({ error: 'order_number_required' });
  const { reasonCategory, reasonDetail, customerNotes, selectedItems } = request.body || {};

  const result = await createOrderRefundRequest(pool, {
    orderNumber,
    customerId: request.customer.id,
    reasonCategory,
    reasonDetail,
    customerNotes,
    selectedItems
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.code(201).send(result);
});

// ---------- Admin Refund Management Endpoints ----------
app.get('/api/v1/admin/refunds', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { status, requestType, limit, offset } = request.query || {};

  const result = await listAdminRefundRequests(pool, {
    status,
    requestType,
    limit,
    offset
  });

  return reply.send(result);
});

app.post('/api/v1/admin/refunds/:id/approve', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const refundId = Number(request.params.id);
  if (!Number.isSafeInteger(refundId) || refundId <= 0) return reply.code(400).send({ error: 'invalid_refund_id' });
  const { approvedAmountPaise, adminNotes } = request.body || {};

  const result = await approveRefundRequest(pool, {
    refundRequestId: refundId,
    adminId: request.customer.id,
    approvedAmountPaise,
    adminNotes,
    razorpayClient: razorpay
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.post('/api/v1/admin/refunds/:id/reject', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const refundId = Number(request.params.id);
  if (!Number.isSafeInteger(refundId) || refundId <= 0) return reply.code(400).send({ error: 'invalid_refund_id' });
  const { adminNotes } = request.body || {};

  const result = await rejectRefundRequest(pool, {
    refundRequestId: refundId,
    adminId: request.customer.id,
    adminNotes
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.get('/api/v1/admin/orders', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');

  const { status, payment_status, search, delivery_date, limit = 50, offset = 0 } = request.query || {};
  const queryParams = [];
  const conditions = [];

  if (status && status !== 'all') {
    queryParams.push(status);
    conditions.push(`co.order_status = $${queryParams.length}`);
  }

  if (payment_status && payment_status !== 'all') {
    queryParams.push(payment_status);
    conditions.push(`co.payment_status = $${queryParams.length}`);
  }

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(co.order_number) LIKE $${queryParams.length} OR
      LOWER(c.full_name) LIKE $${queryParams.length} OR
      LOWER(c.email) LIKE $${queryParams.length} OR
      LOWER(COALESCE(c.phone, '')) LIKE $${queryParams.length} OR
      LOWER(COALESCE(co.address->>'phone', '')) LIKE $${queryParams.length} OR
      LOWER(COALESCE(co.tracking_number, '')) LIKE $${queryParams.length}
    )`);
  }

  if (delivery_date && delivery_date.trim()) {
    queryParams.push(`%${delivery_date.trim()}%`);
    conditions.push(`(
      DATE(co.estimated_delivery)::text LIKE $${queryParams.length} OR
      DATE(co.created_at)::text LIKE $${queryParams.length}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const parsedOffset = Math.max(0, Number(offset) || 0);
  queryParams.push(parsedLimit, parsedOffset);

  const { rows } = await pool.query(
    `SELECT co.id, co.order_number, co.customer_id, c.full_name AS customer_name, c.email AS customer_email,
            c.phone AS customer_phone, co.address, co.items, co.subtotal_paise, co.delivery_charge_paise, co.total_paise,
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

app.get('/api/v1/admin/orders/export', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');

  const { status, payment_status, search, delivery_date } = request.query || {};
  const queryParams = [];
  const conditions = [];

  if (status && status !== 'all') {
    queryParams.push(status);
    conditions.push(`co.order_status = $${queryParams.length}`);
  }

  if (payment_status && payment_status !== 'all') {
    queryParams.push(payment_status);
    conditions.push(`co.payment_status = $${queryParams.length}`);
  }

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(co.order_number) LIKE $${queryParams.length} OR
      LOWER(c.full_name) LIKE $${queryParams.length} OR
      LOWER(c.email) LIKE $${queryParams.length} OR
      LOWER(COALESCE(c.phone, '')) LIKE $${queryParams.length} OR
      LOWER(COALESCE(co.address->>'phone', '')) LIKE $${queryParams.length} OR
      LOWER(COALESCE(co.tracking_number, '')) LIKE $${queryParams.length}
    )`);
  }

  if (delivery_date && delivery_date.trim()) {
    queryParams.push(`%${delivery_date.trim()}%`);
    conditions.push(`(
      DATE(co.estimated_delivery)::text LIKE $${queryParams.length} OR
      DATE(co.created_at)::text LIKE $${queryParams.length}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT co.id, co.order_number, co.customer_id, c.full_name AS customer_name, c.email AS customer_email,
            COALESCE(c.phone, co.address->>'phone', '') AS customer_phone,
            co.address, co.items, co.subtotal_paise, co.delivery_charge_paise, co.total_paise,
            co.order_status, co.payment_status, co.courier_name, co.tracking_number, co.estimated_delivery,
            co.created_at
     FROM customer_orders co
     JOIN customers c ON c.id = co.customer_id
     ${whereClause}
     ORDER BY co.created_at DESC
     LIMIT 10000`,
    queryParams
  );

  const headers = [
    'Order ID',
    'Order Number',
    'Date (IST)',
    'Customer Name',
    'Customer Email',
    'Customer Phone',
    'Order Status',
    'Payment Status',
    'Subtotal (INR)',
    'Delivery Fee (INR)',
    'Total (INR)',
    'Courier',
    'Tracking Number',
    'Estimated Delivery (IST)',
    'Delivery Address',
    'Items'
  ];

  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const addr = typeof row.address === 'object' && row.address !== null ? row.address : {};
    const fullAddress = [addr.house, addr.building, addr.street, addr.landmark, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');

    let itemsStr = '';
    if (Array.isArray(row.items)) {
      itemsStr = row.items.map(i => `${i.name || i.productName || 'Item'} x${i.quantity || 1}`).join('; ');
    }

    const values = [
      row.id,
      row.order_number,
      formatISTDateTime(row.created_at),
      addr.name || addr.recipient_name || row.customer_name,
      row.customer_email,
      row.customer_phone,
      row.order_status,
      row.payment_status,
      ((row.subtotal_paise || 0) / 100).toFixed(2),
      ((row.delivery_charge_paise || 0) / 100).toFixed(2),
      ((row.total_paise || 0) / 100).toFixed(2),
      row.courier_name || '',
      row.tracking_number || '',
      formatISTDateTime(row.estimated_delivery),
      fullAddress,
      itemsStr
    ];

    csvRows.push(values.map(sanitizeCsvCell).join(','));
  }

  const csvContent = csvRows.join('\r\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="milvanta-orders-${Date.now()}.csv"`)
    .send(csvContent);
});

// ---------- Admin Subscriptions Management ----------
app.get('/api/v1/admin/subscriptions', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');

  const { status, search, delivery_date, limit = 50, offset = 0 } = request.query || {};
  const queryParams = [];
  const conditions = [];

  if (status && status !== 'all') {
    queryParams.push(status);
    conditions.push(`cs.status = $${queryParams.length}`);
  }

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(cs.product_name) LIKE $${queryParams.length} OR
      LOWER(c.full_name) LIKE $${queryParams.length} OR
      LOWER(c.email) LIKE $${queryParams.length} OR
      LOWER(COALESCE(c.phone, '')) LIKE $${queryParams.length} OR
      LOWER(COALESCE(cs.razorpay_subscription_id, '')) LIKE $${queryParams.length} OR
      LOWER(cs.id::text) LIKE $${queryParams.length}
    )`);
  }

  if (delivery_date && delivery_date.trim()) {
    queryParams.push(`%${delivery_date.trim()}%`);
    conditions.push(`(
      cs.next_delivery LIKE $${queryParams.length} OR
      cs.notes->>'startDate' LIKE $${queryParams.length} OR
      cs.notes->>'paidThroughDate' LIKE $${queryParams.length}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const parsedOffset = Math.max(0, Number(offset) || 0);
  queryParams.push(parsedLimit, parsedOffset);

  const { rows } = await pool.query(
    `SELECT cs.id, cs.customer_id, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            cs.product_name, cs.quantity, cs.frequency, cs.time_slot, cs.cost_per_day_paise,
            cs.status, cs.next_delivery, cs.plan_type, cs.duration_label, cs.total_amount_paise,
            cs.razorpay_subscription_id, cs.razorpay_plan_id, cs.notes, cs.created_at, cs.updated_at
     FROM customer_subscriptions cs
     JOIN customers c ON c.id = cs.customer_id
     ${whereClause}
     ORDER BY cs.created_at DESC
     LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams
  );

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM customer_subscriptions cs JOIN customers c ON c.id = cs.customer_id ${whereClause}`,
    queryParams.slice(0, -2)
  );

  return { subscriptions: rows, total: Number(countRes.rows[0].total) };
});

app.get('/api/v1/admin/subscriptions/export', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');

  const { status, search, delivery_date } = request.query || {};
  const queryParams = [];
  const conditions = [];

  if (status && status !== 'all') {
    queryParams.push(status);
    conditions.push(`cs.status = $${queryParams.length}`);
  }

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(cs.product_name) LIKE $${queryParams.length} OR
      LOWER(c.full_name) LIKE $${queryParams.length} OR
      LOWER(c.email) LIKE $${queryParams.length} OR
      LOWER(COALESCE(c.phone, '')) LIKE $${queryParams.length} OR
      LOWER(COALESCE(cs.razorpay_subscription_id, '')) LIKE $${queryParams.length} OR
      LOWER(cs.id::text) LIKE $${queryParams.length}
    )`);
  }

  if (delivery_date && delivery_date.trim()) {
    queryParams.push(`%${delivery_date.trim()}%`);
    conditions.push(`(
      cs.next_delivery LIKE $${queryParams.length} OR
      cs.notes->>'startDate' LIKE $${queryParams.length} OR
      cs.notes->>'paidThroughDate' LIKE $${queryParams.length}
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT cs.id, cs.customer_id, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            cs.product_name, cs.quantity, cs.frequency, cs.time_slot, cs.cost_per_day_paise,
            cs.status, cs.next_delivery, cs.plan_type, cs.duration_label, cs.total_amount_paise,
            cs.razorpay_subscription_id, cs.notes, cs.created_at
     FROM customer_subscriptions cs
     JOIN customers c ON c.id = cs.customer_id
     ${whereClause}
     ORDER BY cs.created_at DESC
     LIMIT 10000`,
    queryParams
  );

  const headers = [
    'Subscription ID',
    'Customer Name',
    'Customer Email',
    'Customer Phone',
    'Product',
    'Quantity',
    'Frequency',
    'Time Slot',
    'Daily Rate (INR)',
    'Plan Type',
    'Duration Label',
    'Total Amount (INR)',
    'Status',
    'Next Delivery',
    'Gateway Subscription ID',
    'Last Payment ID',
    'Paid Through Date',
    'Start Date',
    'Created At (IST)'
  ];

  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const notes = typeof row.notes === 'object' && row.notes !== null ? row.notes : {};
    const values = [
      row.id,
      row.customer_name,
      row.customer_email,
      row.customer_phone || '',
      row.product_name,
      row.quantity,
      row.frequency,
      row.time_slot,
      ((row.cost_per_day_paise || 0) / 100).toFixed(2),
      row.plan_type || 'month',
      row.duration_label || '',
      ((row.total_amount_paise || 0) / 100).toFixed(2),
      row.status,
      row.next_delivery || '',
      row.razorpay_subscription_id || '',
      notes.lastPaymentId || notes.paymentId || notes.mandatePaymentId || '',
      notes.paidThroughDate || '',
      notes.startDate || '',
      formatISTDateTime(row.created_at)
    ];

    csvRows.push(values.map(sanitizeCsvCell).join(','));
  }

  const csvContent = csvRows.join('\r\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="milvanta-subscriptions-${Date.now()}.csv"`)
    .send(csvContent);
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
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');

  const [ordersSummary, customerSummary, subSummary] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE order_status IN ('placed', 'confirmed', 'processing')) AS active_orders,
        COUNT(*) FILTER (WHERE order_status = 'delivered') AS delivered_orders,
        COALESCE(SUM(total_paise) FILTER (WHERE payment_status = 'paid'), 0) AS total_revenue_paise
      FROM customer_orders
    `),
    pool.query('SELECT COUNT(*) AS total_customers FROM customers'),
    pool.query(`
      SELECT
        COUNT(*) AS total_subscriptions,
        COUNT(*) FILTER (WHERE status = 'active') AS active_subscriptions,
        COUNT(*) FILTER (WHERE status = 'pending_authorization') AS pending_subscriptions,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused_subscriptions,
        COALESCE(SUM(total_amount_paise) FILTER (WHERE status = 'active'), 0) AS active_contract_value_paise,
        COALESCE(
          SUM(
            CASE
              WHEN (notes->>'authType' = 'recurring_charge' OR notes->>'lastPaymentId' IS NOT NULL)
               AND (notes->>'authAmountPaise') ~ '^[0-9]+$'
              THEN (notes->>'authAmountPaise')::bigint
              ELSE 0
            END
          ),
          0
        ) AS collected_subscription_revenue_paise
      FROM customer_subscriptions
    `)
  ]);

  const orderRevenue = Number(ordersSummary.rows[0].total_revenue_paise);
  const activeContractValue = Number(subSummary.rows[0].active_contract_value_paise || 0);
  const collectedSubRevenue = Number(subSummary.rows[0].collected_subscription_revenue_paise || 0);
  const totalPaidRevenue = orderRevenue + collectedSubRevenue;

  return {
    totalOrders: Number(ordersSummary.rows[0].total_orders),
    activeOrders: Number(ordersSummary.rows[0].active_orders),
    deliveredOrders: Number(ordersSummary.rows[0].delivered_orders),
    totalRevenuePaise: totalPaidRevenue,
    orderRevenuePaise: orderRevenue,
    collectedSubscriptionRevenuePaise: collectedSubRevenue,
    activeSubscriptionContractValuePaise: activeContractValue,
    subscriptionRevenuePaise: activeContractValue,
    combinedRevenuePaise: totalPaidRevenue,
    totalCustomers: Number(customerSummary.rows[0].total_customers),
    totalSubscriptions: Number(subSummary.rows[0].total_subscriptions),
    activeSubscriptions: Number(subSummary.rows[0].active_subscriptions),
    pendingSubscriptions: Number(subSummary.rows[0].pending_subscriptions),
    pausedSubscriptions: Number(subSummary.rows[0].paused_subscriptions)
  };
});

async function dispatchOrderPaidSms(pool, customerOrderId, processNow = true) {
  if (!pool || !customerOrderId) return;
  try {
    const { rows } = await pool.query(
      `SELECT co.id, co.order_number, co.total_paise, co.address, co.customer_id, c.phone, c.sms_notifications_enabled
       FROM customer_orders co
       LEFT JOIN customers c ON c.id = co.customer_id
       WHERE co.id = $1 AND co.payment_status='paid' AND co.order_status='confirmed'`,
      [customerOrderId]
    );
    if (!rows[0] || (notificationProvider()==='twilio' && rows[0].sms_notifications_enabled === false)) return;
    const ord = rows[0];
    let addr = {};
    if (ord.address && typeof ord.address === 'object') {
      addr = ord.address;
    } else if (typeof ord.address === 'string') {
      try { addr = JSON.parse(ord.address); } catch {}
    }
    const targetPhone = notificationProvider()==='whatsapp' ? ord.phone : addr.phone || ord.phone;
    if (!targetPhone) return;

    await queueNotification(pool, {
      customerId: ord.customer_id,
      phone: targetPhone,
      templateKey: 'ORDER_CONFIRMED',
      params: {
        orderNumber: ord.order_number,
        amount: (Number(ord.total_paise || 0) / 100).toFixed(0),
        area: addr.area || addr.city || 'Hyderabad',
        deliveryDate: addr.delivery_date || addr.deliveryDate || 'tomorrow',
        orderLink: 'https://milvanta.in/profile.html?order=' + encodeURIComponent(ord.order_number)
      },
      idempotencyKey: `sms_order_paid_${ord.id}`
    });
    if (processNow) setImmediate(() => processNotificationOutbox(pool, 10, process.env.NODE_ENV==='test' ? {fetchImpl:app.whatsappFetch || undefined} : undefined).catch(() => {}));
  } catch (err) {
    // A failed SQL statement aborts a shared webhook transaction. Propagate so the
    // gateway gets a retryable failure instead of acknowledging a rolled-back payment.
    if (!processNow) throw err;
    app.log.warn({ code: err?.code || 'notification_error' }, 'Failed to queue order notification');
  }
}

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
    `SELECT po.amount_paise, po.customer_order_id FROM payment_orders po
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

    // Send order confirmation emails via Resend to customer & admin
    if (gatewayPayment.status === 'captured') {
      const customerOrderId = paymentOrder.rows[0]?.customer_order_id;
      if (customerOrderId) {
        sendOrderPaidEmails(pool, customerOrderId, paymentId).catch((err) => {
          app.log.error({ err }, '[Resend] Failed to send order emails on payment verify');
        });
        await dispatchOrderPaidSms(pool, customerOrderId);
      }
    }

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

  // Pre-fetch payment evidence OUTSIDE the database transaction with bounded timeout
  // to avoid holding an open PostgreSQL transaction during external network calls
  let preloadedPayments = null;
  const eventName = request.body?.event;
  const subEntity = request.body?.payload?.subscription?.entity;
  const rawPaymentEntity = request.body?.payload?.payment?.entity;
  const rawInvoiceEntity = request.body?.payload?.invoice?.entity;

  if (
    ['subscription.activated', 'subscription.charged'].includes(eventName) &&
    subEntity?.id &&
    !rawPaymentEntity?.id &&
    !rawInvoiceEntity?.id &&
    Number.isInteger(subEntity.paid_count) &&
    subEntity.paid_count > 0 &&
    razorpay
  ) {
    try {
      preloadedPayments = await Promise.race([
        razorpay.subscriptions.fetchPayments(subEntity.id),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Razorpay fetchPayments timeout')), 4000))
      ]);
    } catch (err) {
      request.log.warn({ err: err?.message, subId: subEntity.id }, '[Webhook] Preload subscription payments timed out or failed');
      preloadedPayments = null;
    }
  }

  let client;
  try {
    client = await pool.connect();
  } catch (dbErr) {
    request.log.error({ dbErr }, 'Webhook failed to acquire DB client');
    return reply.code(503).send({ error: 'database_unavailable' });
  }

  try {
    await client.query('BEGIN');
    const seen = await client.query('INSERT INTO payment_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
    if (seen.rowCount) {
      const eventName = request.body?.event;
      // A. Standard Order Payment Events
      const entity = request.body?.payload?.payment?.entity;
      if (entity?.order_id && entity?.id) {
        const status = request.body.event === 'payment.captured' ? 'captured'
          : request.body.event === 'payment.failed' ? 'failed'
            : request.body.event === 'payment.authorized' ? 'authorized' : null;
        if (status) {
          await applyPaymentStatus(client, entity.order_id, entity.id, status, entity.amount, entity.currency);
          if (status === 'captured') {
            const foundOrder = await client.query('SELECT customer_order_id FROM payment_orders WHERE razorpay_order_id = $1', [entity.order_id]);
            const orderId = foundOrder.rows[0]?.customer_order_id;
            if (orderId) {
              sendOrderPaidEmails(pool, orderId, entity.id).catch((err) => {
                app.log.error({ err }, '[Resend] Failed to send order emails on webhook capture');
              });
              if (notificationProvider()==='whatsapp') await dispatchOrderPaidSms(client, orderId, false);
              else dispatchOrderPaidSms(pool, orderId).catch(() => {});
            }
          }
        }
      }

      // C. Razorpay Refund Lifecycle Events
      if (['refund.processed', 'refund.failed'].includes(eventName)) {
        const refundEntity = request.body?.payload?.refund?.entity;
        if (refundEntity?.id) {
          const newStatus = eventName === 'refund.processed' ? 'processed' : 'failed';
          const updateRes = await client.query(
            `UPDATE refund_requests
             SET status = $2, gateway_refund_id = $1, gateway_response = $3::jsonb, updated_at = NOW()
             WHERE gateway_refund_id = $1 OR payment_id = $4
             RETURNING id, status, customer_id, subscription_id`,
            [refundEntity.id, newStatus, JSON.stringify(refundEntity), refundEntity.payment_id]
          );
          if (updateRes.rows.length > 0) {
            const rf = updateRes.rows[0];
            await client.query(
              `INSERT INTO refund_request_history (refund_request_id, previous_status, new_status, actor_type, note, payload)
               VALUES ($1, $2, $3, 'webhook', $4, $5::jsonb)`,
              [rf.id, rf.status, newStatus, `Razorpay webhook ${eventName}`, JSON.stringify(refundEntity)]
            );
          }
        }
      }

      // B. Razorpay Subscription Lifecycle Events
      const subEntity = request.body?.payload?.subscription?.entity;
      if (subEntity?.id) {
        if (['subscription.authenticated'].includes(eventName)) {
          // Mandate authorization alone must NOT authorize unpaid deliveries.
          // Record authenticated gateway state in notes without activating deliveries.
          await client.query(
            `UPDATE customer_subscriptions 
             SET notes = jsonb_set(
                   COALESCE(notes, '{}'::jsonb),
                   '{gatewayStatus}',
                   '"authenticated"'
                 ),
                 updated_at = NOW() 
             WHERE razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1`,
            [subEntity.id]
          );
        } else if (['subscription.activated', 'subscription.charged'].includes(eventName)) {
          // Confirm payment evidence before activating fulfillment
          const paymentEntity = rawPaymentEntity;
          const invoiceEntity = rawInvoiceEntity;
          const rawPaidCount = subEntity.paid_count;
          const hasPositivePaidCount = Number.isInteger(rawPaidCount) && rawPaidCount > 0;

          // Defensible captured billing-cycle evidence requirement:
          // Must match subscription ID, be captured/paid, and belong to current billing cycle.
          let hasPaymentEvidence = false;
          let confirmedPaymentId = null;

          if (rawPaymentEntity?.id && typeof rawPaymentEntity.id === 'string' && rawPaymentEntity.id.startsWith('pay_')) {
            const isCaptured = rawPaymentEntity.status === 'captured';
            const subMatches = !rawPaymentEntity.subscription_id || rawPaymentEntity.subscription_id === subEntity.id;
            let cycleMatches = true;
            if (subEntity.current_start && Number.isFinite(Number(subEntity.current_start)) && rawPaymentEntity.created_at) {
              const cycleStartThreshold = Number(subEntity.current_start) - 86400;
              cycleMatches = Number(rawPaymentEntity.created_at) >= cycleStartThreshold;
              if (subEntity.current_end && Number.isFinite(Number(subEntity.current_end))) {
                const cycleEndThreshold = Number(subEntity.current_end) + 86400;
                cycleMatches = cycleMatches && Number(rawPaymentEntity.created_at) <= cycleEndThreshold;
              }
            }
            if (isCaptured && subMatches && cycleMatches) {
              hasPaymentEvidence = true;
              confirmedPaymentId = rawPaymentEntity.id;
            }
          } else if (rawInvoiceEntity?.id && typeof rawInvoiceEntity.id === 'string' && rawInvoiceEntity.id.startsWith('inv_')) {
            const isPaid = rawInvoiceEntity.status === 'paid';
            const subMatches = !rawInvoiceEntity.subscription_id || rawInvoiceEntity.subscription_id === subEntity.id;
            let cycleMatches = true;
            if (subEntity.current_start && Number.isFinite(Number(subEntity.current_start)) && rawInvoiceEntity.billing_start) {
              const cycleStartThreshold = Number(subEntity.current_start) - 86400;
              cycleMatches = Number(rawInvoiceEntity.billing_start) >= cycleStartThreshold;
            }
            if (isPaid && subMatches && cycleMatches) {
              hasPaymentEvidence = true;
              confirmedPaymentId = rawInvoiceEntity.payment_id || null;
            }
          } else if (preloadedPayments?.items && Array.isArray(preloadedPayments.items)) {
            const matchingItem = preloadedPayments.items.find(p => {
              if (p.status !== 'captured') return false;
              if (p.subscription_id && p.subscription_id !== subEntity.id) return false;
              if (subEntity.current_start && Number.isFinite(Number(subEntity.current_start)) && p.created_at) {
                const cycleStartThreshold = Number(subEntity.current_start) - 86400;
                if (Number(p.created_at) < cycleStartThreshold) return false;
                if (subEntity.current_end && Number.isFinite(Number(subEntity.current_end))) {
                  const cycleEndThreshold = Number(subEntity.current_end) + 86400;
                  if (Number(p.created_at) > cycleEndThreshold) return false;
                }
              }
              return true;
            });
            if (matchingItem) {
              hasPaymentEvidence = true;
              confirmedPaymentId = matchingItem.id;
            }
          }

          if (!hasPaymentEvidence) {
            // Mandate activated on gateway or 0 paid_count: DO NOT default paid_count to 1!
            // Record gateway status and 0 paidCount without activating fulfillment
            await client.query(
              `UPDATE customer_subscriptions 
               SET notes = jsonb_set(
                     jsonb_set(
                       jsonb_set(
                         COALESCE(notes, '{}'::jsonb),
                         '{gatewayStatus}',
                         to_jsonb($2::text)
                       ),
                       '{mandateStatus}',
                       '"authenticated"'
                     ),
                     '{paidCount}',
                     '0'::jsonb
                   ),
                   updated_at = NOW() 
               WHERE (razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1)`,
              [subEntity.id, subEntity.status || 'activated']
            );
          } else {
            // Payment evidence confirmed: activate fulfillment!
            const actualPaidCount = hasPositivePaidCount ? rawPaidCount : 1;

            const { rows: currentRows } = await client.query(
              `SELECT id, cost_per_day_paise, total_amount_paise, notes, created_at
               FROM customer_subscriptions
               WHERE (razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1)`,
              [subEntity.id]
            );
            const currentSub = currentRows[0];
            const currNotes = typeof currentSub?.notes === 'object' && currentSub?.notes !== null ? currentSub.notes : {};

            const startDate = currNotes.startDate || (currentSub?.created_at ? formatDateYMD(new Date(currentSub.created_at)) : null);
            const paidThroughYMD = derivePaidThroughDate({
              startDate,
              paidThroughDate: currNotes.paidThroughDate,
              current_end: subEntity.current_end,
              cost_per_day_paise: currentSub?.cost_per_day_paise,
              total_amount_paise: currentSub?.total_amount_paise,
              paidCount: actualPaidCount,
              months: currNotes.months || 1
            });

            await client.query(
              `UPDATE customer_subscriptions 
               SET status = 'active', 
                   razorpay_subscription_id = COALESCE(razorpay_subscription_id, $1), 
                   notes = jsonb_set(
                     jsonb_set(
                       jsonb_set(
                         jsonb_set(
                           jsonb_set(
                             COALESCE(notes, '{}'::jsonb),
                             '{gatewayStatus}',
                             to_jsonb($2::text)
                           ),
                           '{paidCount}',
                           to_jsonb($3::integer)
                         ),
                         '{paidThroughDate}',
                         COALESCE(to_jsonb($4::text), notes->'paidThroughDate', 'null'::jsonb)
                       ),
                       '{fulfillmentEntitled}',
                       'true'::jsonb
                     ),
                     '{lastPaymentId}',
                     COALESCE(to_jsonb($5::text), notes->'lastPaymentId', 'null'::jsonb)
                   ),
                   updated_at = NOW() 
               WHERE (razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1)
                 AND status NOT IN ('cancelled', 'paused')`,
              [
                subEntity.id,
                subEntity.status || 'active',
                actualPaidCount,
                paidThroughYMD,
                confirmedPaymentId || (rawPaymentEntity?.status === 'captured' ? rawPaymentEntity.id : null)
              ]
            );
          }
        } else if (['subscription.resumed'].includes(eventName)) {
          // Resume paused subscriptions, but never cancelled/expired
          await client.query(
            `UPDATE customer_subscriptions 
             SET status = 'active', 
                 razorpay_subscription_id = COALESCE(razorpay_subscription_id, $1), 
                 notes = jsonb_set(
                   COALESCE(notes, '{}'::jsonb),
                   '{gatewayStatus}',
                   '"active"'
                 ),
                 updated_at = NOW() 
             WHERE (razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1)
               AND status NOT IN ('cancelled', 'expired')`,
            [subEntity.id]
          );
        } else if (['subscription.cancelled'].includes(eventName)) {
          await client.query(
            `UPDATE customer_subscriptions 
             SET status = 'cancelled', 
                 notes = jsonb_set(
                   COALESCE(notes, '{}'::jsonb),
                   '{gatewayStatus}',
                   '"cancelled"'
                 ),
                 updated_at = NOW() 
             WHERE razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1`,
            [subEntity.id]
          );
        } else if (['subscription.halted', 'subscription.pending', 'subscription.paused'].includes(eventName)) {
          // Recoverable billing failure or customer pause: transition to paused so deliveries hold without permanent loss
          await client.query(
            `UPDATE customer_subscriptions 
             SET status = 'paused', 
                 notes = jsonb_set(
                   COALESCE(notes, '{}'::jsonb),
                   '{gatewayStatus}',
                   to_jsonb($2::text)
                 ),
                 updated_at = NOW() 
             WHERE razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1`,
            [subEntity.id, eventName.replace('subscription.', '')]
          );
        } else if (['subscription.completed'].includes(eventName)) {
          // CRITICAL: Separate Razorpay billing-cycle completion from fulfillment entitlement.
          // For subscriptions with total_count = 1, Razorpay marks subscription.completed immediately
          // after charging the first (and only) month.
          // The month is FULLY PAID through its paid-through date; deliveries MUST remain ACTIVE!
          const { rows: subRows } = await client.query(
            `SELECT id, status, notes, cost_per_day_paise, total_amount_paise, created_at, next_delivery
             FROM customer_subscriptions
             WHERE razorpay_subscription_id = $1 OR notes->>'subscriptionId' = $1 OR notes->>'razorpay_subscription_id' = $1`,
            [subEntity.id]
          );
          if (subRows.length > 0) {
            const sub = subRows[0];
            const notes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
            const isMandateOnly = notes.authType === 'mandate_only' || notes.fulfillmentEntitled === false;
            const hasCapturedCyclePayment = Boolean(
              (subEntity.paid_count && Number(subEntity.paid_count) > 0) ||
              (notes.paidCount && Number(notes.paidCount) > 0) ||
              (notes.fulfillmentEntitled === true && notes.authType !== 'mandate_only' && (notes.lastPaymentId || notes.paymentId))
            );
            const isPaid = hasCapturedCyclePayment && !isMandateOnly;

            const startDate = notes.startDate || (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null);
            const paidThroughDate = isPaid
              ? derivePaidThroughDate({
                  startDate,
                  paidThroughDate: notes.paidThroughDate,
                  current_end: subEntity.current_end,
                  cost_per_day_paise: sub.cost_per_day_paise,
                  total_amount_paise: sub.total_amount_paise,
                  paidCount: Number(subEntity.paid_count) || Number(notes.paidCount) || (isPaid ? 1 : 0),
                  months: notes.months || 1
                })
              : null;

            const nowYMD = new Date().toISOString().slice(0, 10);
            const isStillWithinPaidPeriod = Boolean(paidThroughDate && paidThroughDate >= nowYMD);

            if (isPaid && isStillWithinPaidPeriod && sub.status !== 'cancelled' && sub.status !== 'paused') {
              // Fulfillment entitlement remains ACTIVE through paid-through period, while billingStatus is marked completed
              await client.query(
                `UPDATE customer_subscriptions
                 SET status = 'active',
                     notes = jsonb_set(
                       jsonb_set(
                         jsonb_set(
                           COALESCE(notes, '{}'::jsonb),
                           '{billingStatus}',
                           '"completed"'
                         ),
                         '{gatewayStatus}',
                         '"completed"'
                       ),
                       '{paidThroughDate}',
                       to_jsonb($2::text)
                     ),
                     updated_at = NOW()
                 WHERE id = $1`,
                [sub.id, paidThroughDate || '']
              );
            } else if (!isPaid) {
              // Mandate ended without any cycle payment captured
              await client.query(
                `UPDATE customer_subscriptions
                 SET status = 'expired',
                     notes = jsonb_set(
                       jsonb_set(COALESCE(notes, '{}'::jsonb), '{billingStatus}', '"completed_unpaid"'),
                       '{gatewayStatus}',
                       '"completed"'
                     ),
                     updated_at = NOW()
                 WHERE id = $1`,
                [sub.id]
              );
            } else {
              // Paid-through date has truly elapsed
              await client.query(
                `UPDATE customer_subscriptions
                 SET status = 'expired',
                     notes = jsonb_set(
                       jsonb_set(COALESCE(notes, '{}'::jsonb), '{billingStatus}', '"completed"'),
                       '{gatewayStatus}',
                       '"completed"'
                     ),
                     updated_at = NOW()
                 WHERE id = $1`,
                [sub.id]
              );
            }
          }
        }
      }
    }
    if (seen.rowCount && notificationProvider()==='whatsapp' && subEntity?.id) {
      const {rows: notificationSubs}=await client.query(`SELECT s.*,c.phone FROM customer_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.razorpay_subscription_id=$1 OR s.notes->>'subscriptionId'=$1 OR s.notes->>'razorpay_subscription_id'=$1`,[subEntity.id]);
      for(const s of notificationSubs) {
        if(['subscription.activated','subscription.charged'].includes(eventName)) await queuePaidSubscriptionActivation(client,s.id);
        else {
          const templateKey=({'subscription.cancelled':'SUBSCRIPTION_CANCELLED','subscription.paused':'SUBSCRIPTION_PAUSED','subscription.resumed':'SUBSCRIPTION_RESUMED','subscription.halted':'BILLING_ISSUE','subscription.pending':'BILLING_ISSUE'})[eventName];
          if(templateKey) await queueNotification(client,{customerId:s.customer_id,phone:s.phone,templateKey,params:{productName:s.product_name,dueDate:s.notes?.paidThroughDate},idempotencyKey:templateKey==='SUBSCRIPTION_CANCELLED'?`sms_sub_cancel_${s.id}`:`gateway_${eventName}_${s.id}_${eventId}`});
        }
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

// Explicit endpoint to trigger or resend order confirmation emails (authenticated)
app.post('/api/v1/orders/:orderNumber/send-confirmation', { preHandler: app.authenticate }, async (request, reply) => {
  const { orderNumber } = request.params;
  const paymentId = request.body?.paymentId || '';
  if (pool) {
    const { rows } = await pool.query('SELECT customer_id FROM customer_orders WHERE order_number = $1', [orderNumber]);
    if (!rows.length || (Number(rows[0].customer_id) !== Number(request.customer.id) && !request.isAdmin)) {
      return reply.code(403).send({ error: 'forbidden', message: 'You do not have permission to trigger confirmation for this order.' });
    }
  }
  const result = await sendOrderPaidEmails(pool, orderNumber, paymentId);
  return reply.send(result);
});

// ---------- Internal Operations & Dispatch APIs (Admin Protected) ----------
app.get('/api/v1/operations/deliveries', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { date, status, limit, offset } = request.query || {};
  const data = await getDailyDeliveries(pool, {
    date,
    status,
    limit: Number(limit) || 100,
    offset: Number(offset) || 0
  });
  return reply.send(data);
});

app.post('/api/v1/operations/deliveries/generate', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { targetDate } = request.body || {};
  try {
    const result = await generateDailyDeliveries(pool, targetDate);
    return reply.send(result);
  } catch (err) {
    request.log.error({ err }, 'Operations: failed to generate daily deliveries');
    return reply.code(500).send({ error: 'delivery_generation_failed', message: err.message });
  }
});

app.post('/api/v1/operations/deliveries/:id/status', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const deliveryOrderId = Number(request.params.id);
  if (!Number.isSafeInteger(deliveryOrderId) || deliveryOrderId <= 0) {
    return reply.code(400).send({ error: 'invalid_delivery_order_id' });
  }

  const { status, actor, notes, reason } = request.body || {};
  const result = await updateDeliveryStatus(pool, {
    deliveryOrderId,
    status,
    actor: actor || 'admin',
    notes,
    reason
  });

  if (!result.success) {
    return reply.code(result.statusCode || 400).send(result);
  }
  return reply.send(result);
});

app.post('/api/v1/operations/notifications/process', { preHandler: app.requireAdmin }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { limit } = request.body || {};
  try {
    const result = await processNotificationOutbox(pool, Number(limit) || 25);
    return reply.send({ success: true, processed: result.processed });
  } catch (err) {
    return reply.code(500).send({ error: 'notification_processing_failed', message: err.message });
  }
});

// ---------- Twilio SMS Status Webhook Callback ----------
app.post('/api/v1/notifications/twilio-callback', async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });

  const signature = request.headers['x-twilio-signature'] || request.headers['X-Twilio-Signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const host = request.headers['x-forwarded-host'] || request.headers.host || 'milvanta-backend.onrender.com';
  const fullUrl = `${protocol}://${host}${request.raw.url}`;

  // In production, strictly require valid Twilio signature
  if (process.env.NODE_ENV === 'production') {
    if (!authToken) {
      return reply.code(503).send({ error: 'twilio_service_unavailable' });
    }
    const isValid = validateTwilioWebhookSignature({
      authToken,
      signature,
      url: fullUrl,
      params: request.body
    });
    if (!isValid) {
      return reply.code(403).send({ error: 'invalid_twilio_signature' });
    }
  }

  const payload = request.body || {};
  const result = await handleTwilioStatusCallback(pool, payload);
  return reply.send(result);
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
let outboxSweep = null;
if (process.env.NODE_ENV !== 'test') {
  // 1. Controlled migration execution before HTTP listener is opened
  if (pool) {
    if (process.env.APP_ENV === 'staging') {
      try {
        assertStagingDatabaseIsolation(normalizedDbUrl);
        app.log.info('Verified staging database isolation: target does NOT match production.');
      } catch (isolationErr) {
        app.log.fatal(isolationErr.message);
        process.exit(1);
      }
    }

    try {
      const applied = await runMigrations(pool);
      if (applied && applied.length > 0) {
        app.log.info({ applied }, 'Database migrations applied successfully');
      } else {
        app.log.info('Database schema is up to date');
      }
      const { rows } = await pool.query('SELECT COUNT(*) FROM products');
      if (Number(rows[0].count) === 0) {
        await seedProducts(pool);
        app.log.info('Initial product catalog seeded into database');
      }
    } catch (err) {
      app.log.fatal({ err: err?.message || err }, 'FATAL STARTUP ERROR: Database migrations failed! Blocking application readiness.');
      process.exit(1);
    }
  }

  // 2. Open HTTP listener only after database migrations succeed
  await app.listen({ port, host });
  reservationSweep = setInterval(releaseExpiredReservations, 60_000);
  reservationSweep.unref();

  outboxSweep = setInterval(async () => {
    try {
      if (pool) await processNotificationOutbox(pool, 25);
    } catch (err) {
      app.log.warn({ err: err?.message || err }, 'Background outbox sweep error');
    }
  }, 30_000);
  outboxSweep.unref();

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (reservationSweep) clearInterval(reservationSweep);
      if (outboxSweep) clearInterval(outboxSweep);
      await app.close();
      await pool?.end();
      process.exit(0);
    });
  }
}

export { app, pool, razorpay };

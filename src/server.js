import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import Razorpay from 'razorpay';
import nodemailer from 'nodemailer';
import { createHmac, createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const { Pool } = pg;
const scryptAsync = promisify(scrypt);
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 1_048_576 });
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } })
  : null;
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;
const mailer = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

await app.register(helmet);
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body;
  try { done(null, JSON.parse(body.toString('utf8'))); }
  catch (error) { done(error); }
});
await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS || 'https://solitary-firefly-ef06.akhilrajuvarma.workers.dev,https://milvanta.in,https://www.milvanta.in').split(',').map((item) => item.trim()).filter(Boolean),
  credentials: true
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

function cookieValue(request, name) {
  const entry = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return '';
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ''; }
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
const otpDigest = (email, otp) => createHmac('sha256', process.env.SMTP_PASS || '').update(`${email}:${otp}`).digest('hex');
function setSessionCookies(reply, token, csrf) {
  const base = 'Path=/; Secure; SameSite=None';
  reply.header('Set-Cookie', [
    `milvanta_session=${encodeURIComponent(token)}; ${base}; HttpOnly; Max-Age=2592000`,
    `milvanta_csrf=${encodeURIComponent(csrf)}; ${base}; Max-Age=2592000`
  ]);
}
function clearSessionCookies(reply) {
  reply.header('Set-Cookie', [
    'milvanta_session=; Path=/; Secure; SameSite=None; HttpOnly; Max-Age=0',
    'milvanta_csrf=; Path=/; Secure; SameSite=None; Max-Age=0'
  ]);
}
async function createSession(customerId, reply) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO customer_sessions (token_hash, customer_id, csrf_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
    [digest(token), customerId, digest(csrf)]
  );
  setSessionCookies(reply, token, csrf);
}
async function requireCustomer(request, reply) {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const token = cookieValue(request, 'milvanta_session');
  if (!token) return reply.code(401).send({ error: 'authentication_required' });
  const { rows } = await pool.query(
    `SELECT c.id, c.full_name, c.phone, c.email, s.csrf_hash
     FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [digest(token)]
  );
  if (!rows[0]) return reply.code(401).send({ error: 'session_expired' });
  request.customer = rows[0];
}
function requireCsrf(request, reply) {
  const cookie = cookieValue(request, 'milvanta_csrf');
  const header = request.headers['x-csrf-token'];
  const actual = Buffer.from(digest(cookie || ''));
  const expected = Buffer.from(request.customer.csrf_hash);
  if (typeof header !== 'string' || header !== cookie || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return reply.code(403).send({ error: 'csrf_validation_failed' });
  }
}
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}
function safeAddress(input) {
  if (!input || typeof input !== 'object') return null;
  const fields = ['name', 'phone', 'house', 'building', 'street', 'landmark', 'city', 'state', 'pincode'];
  const address = Object.fromEntries(fields.map((key) => [key, String(input[key] || '').trim()]));
  if (fields.some((key) => key !== 'landmark' && !address[key]) || fields.some((key) => address[key].length > 160)) return null;
  address.phone = normalizePhone(address.phone);
  if (!/^[6-9]\d{9}$/.test(address.phone) || !/^\d{6}$/.test(address.pincode)) return null;
  return address;
}
async function applyPaymentStatus(client, orderId, paymentId, status, amount, currency) {
  if (!['authorized', 'captured', 'failed'].includes(status)) return false;
  const found = await client.query(
    'SELECT customer_order_id, razorpay_payment_id, amount_paise, currency, status FROM payment_orders WHERE razorpay_order_id = $1 FOR UPDATE', [orderId]
  );
  const payment = found.rows[0];
  if (!payment || Number(payment.amount_paise) !== Number(amount) || payment.currency !== currency) return false;
  if (['captured', 'refunded'].includes(payment.status)) return payment.status === status && payment.razorpay_payment_id === paymentId;
  await client.query('UPDATE payment_orders SET razorpay_payment_id = $2, status = $3, updated_at = NOW() WHERE razorpay_order_id = $1', [orderId, paymentId, status]);
  if (!payment.customer_order_id) return true;
  const orderResult = await client.query('SELECT items, payment_status, reservation_expires_at FROM customer_orders WHERE id = $1 FOR UPDATE', [payment.customer_order_id]);
  const order = orderResult.rows[0];
  if (!order || ['paid', 'failed', 'expired'].includes(order.payment_status)) {
    if (status === 'captured' && order?.payment_status === 'expired') {
      await client.query("UPDATE customer_orders SET payment_status = 'paid', order_status = 'payment_review', updated_at = NOW() WHERE id = $1", [payment.customer_order_id]);
    }
    return true;
  }
  if (status === 'failed') return true;
  if (status === 'captured') {
    if (new Date(order.reservation_expires_at) > new Date()) {
      for (const item of order.items) {
        const changed = await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $2, reserved_stock = reserved_stock - $2, updated_at = NOW() WHERE id = $1 AND stock_quantity >= $2 AND reserved_stock >= $2',
          [item.productId, item.quantity]
        );
        if (!changed.rowCount) throw new Error('reserved_stock_invariant_failed');
      }
      await client.query("UPDATE customer_orders SET payment_status = 'paid', order_status = 'confirmed', updated_at = NOW() WHERE id = $1", [payment.customer_order_id]);
    } else {
      await client.query("UPDATE customer_orders SET payment_status = 'paid', order_status = 'payment_review', updated_at = NOW() WHERE id = $1", [payment.customer_order_id]);
    }
  } else {
    await client.query("UPDATE customer_orders SET payment_status = 'authorized', updated_at = NOW() WHERE id = $1 AND payment_status = 'pending'", [payment.customer_order_id]);
  }
  return true;
}

app.post('/api/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  if (!mailer) return reply.code(503).send({ error: 'email_not_configured' });
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) {
    return reply.code(400).send({ error: 'invalid_registration', message: 'Enter a valid email and a password of at least 12 characters.' });
  }
  if ((await pool.query('SELECT 1 FROM customers WHERE email = $1', [email])).rowCount) return reply.code(409).send({ error: 'account_already_exists' });
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scryptAsync(password, salt, 64)).toString('hex');
  const existing = await pool.query('SELECT resend_after FROM email_registration_codes WHERE email = $1', [email]);
  if (existing.rows[0] && new Date(existing.rows[0].resend_after) > new Date()) {
    return reply.code(429).send({ error: 'otp_resend_too_soon' });
  }
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await pool.query(
    `INSERT INTO email_registration_codes (email, otp_hash, password_salt, password_hash, expires_at, resend_after, attempts)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes', NOW() + INTERVAL '60 seconds', 0)
     ON CONFLICT (email) DO UPDATE SET otp_hash = EXCLUDED.otp_hash, password_salt = EXCLUDED.password_salt,
       password_hash = EXCLUDED.password_hash, expires_at = EXCLUDED.expires_at,
       resend_after = EXCLUDED.resend_after, attempts = 0`,
    [email, otpDigest(email, otp), salt, passwordHash]
  );
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM, to: email, subject: 'Your Milvanta verification code',
      text: `Your Milvanta email verification code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your Milvanta email verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>`
    });
  } catch (error) {
    await pool.query('DELETE FROM email_registration_codes WHERE email = $1', [email]);
    request.log.error({ err: error }, 'Email verification delivery failed');
    return reply.code(502).send({ error: 'otp_delivery_failed' });
  }
  return reply.code(202).send({ verificationRequired: true, email });
});

app.post('/api/v1/auth/verify-email', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const email = String(request.body?.email || '').trim().toLowerCase();
  const otp = String(request.body?.otp || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(otp)) return reply.code(400).send({ error: 'invalid_verification_code' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM email_registration_codes WHERE email = $1 FOR UPDATE', [email]);
    const pending = rows[0];
    if (!pending || new Date(pending.expires_at) <= new Date() || pending.attempts >= 5) {
      await client.query('DELETE FROM email_registration_codes WHERE email = $1', [email]);
      await client.query('COMMIT');
      return reply.code(400).send({ error: 'verification_expired_or_invalid' });
    }
    if (pending.otp_hash !== otpDigest(email, otp)) {
      await client.query('UPDATE email_registration_codes SET attempts = attempts + 1 WHERE email = $1', [email]);
      await client.query('COMMIT');
      return reply.code(400).send({ error: 'verification_expired_or_invalid' });
    }
    const result = await client.query(
      `INSERT INTO customers (full_name, email, password_salt, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id, full_name, phone, email`,
      [email.split('@')[0].slice(0, 100) || 'Customer', email, pending.password_salt, pending.password_hash]
    );
    await client.query('DELETE FROM email_registration_codes WHERE email = $1', [email]);
    await client.query('COMMIT');
    await createSession(result.rows[0].id, reply);
    return reply.code(201).send({ customer: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return reply.code(409).send({ error: 'account_already_exists' });
    throw error;
  } finally { client.release(); }
});

app.post('/api/v1/auth/login', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const identity = String(request.body?.email || request.body?.identity || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  if (identity.length > 254 || password.length < 12 || password.length > 128) return reply.code(401).send({ error: 'invalid_credentials' });
  const { rows } = await pool.query(
    'SELECT id, full_name, phone, email, password_salt, password_hash FROM customers WHERE email = $1 AND email_verified = TRUE LIMIT 1',
    [identity]
  );
  const customer = rows[0];
  const salt = customer?.password_salt || 'invalid-account-salt';
  const actual = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(customer?.password_hash || '0'.repeat(128), 'hex');
  if (!customer || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({ error: 'invalid_credentials' });
  await createSession(customer.id, reply);
  return { customer: { id: customer.id, full_name: customer.full_name, phone: customer.phone, email: customer.email } };
});

app.get('/api/v1/auth/me', { preHandler: requireCustomer }, async (request) => ({
  customer: { id: request.customer.id, full_name: request.customer.full_name, phone: request.customer.phone, email: request.customer.email },
  csrfToken: cookieValue(request, 'milvanta_csrf')
}));

app.patch('/api/v1/auth/me', { preHandler: requireCustomer }, async (request, reply) => {
  if (requireCsrf(request, reply)) return;
  const fullName = String(request.body?.fullName || '').trim();
  if (fullName.length < 2 || fullName.length > 100) return reply.code(400).send({ error: 'invalid_customer_name' });
  const { rows } = await pool.query('UPDATE customers SET full_name = $2 WHERE id = $1 RETURNING id, full_name, phone, email', [request.customer.id, fullName]);
  return { customer: rows[0] };
});

app.get('/api/v1/addresses', { preHandler: requireCustomer }, async (request) => {
  const { rows } = await pool.query(
    `SELECT id, recipient_name AS name, phone, house, building, street, landmark, city, state, pincode, is_default, created_at
     FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, updated_at DESC`,
    [request.customer.id]
  );
  return { addresses: rows };
});

app.post('/api/v1/auth/logout', { preHandler: requireCustomer }, async (request, reply) => {
  if (requireCsrf(request, reply)) return;
  await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [digest(cookieValue(request, 'milvanta_session'))]);
  clearSessionCookies(reply);
  return { loggedOut: true };
});

app.get('/health', async (_request, reply) => {
  let database = 'not_configured';
  if (pool) {
    try { await pool.query('SELECT 1'); database = 'connected'; }
    catch { database = 'unavailable'; return reply.code(503).send({ status: 'degraded', database }); }
  }
  return { status: 'ok', service: 'milvanta-api', database };
});

app.get('/api/v1/products', async (_request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const { rows } = await pool.query(
    'SELECT id, name, description, category, price_paise, selling_unit, image_url, GREATEST(0, stock_quantity - reserved_stock) AS stock_quantity FROM products WHERE active = TRUE ORDER BY name'
  );
  return { products: rows };
});

app.post('/api/v1/orders', { preHandler: requireCustomer, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
  if (requireCsrf(request, reply)) return;
  if (!pool || !razorpay) return reply.code(503).send({ error: 'checkout_not_configured' });
  const serviceablePins = new Set((process.env.SERVICEABLE_PIN_CODES || '').split(',').map((pin) => pin.trim()).filter(Boolean));
  if (!serviceablePins.size) return reply.code(503).send({ error: 'delivery_area_not_configured' });
  const deliveryCharge = Number(process.env.DELIVERY_CHARGE_PAISE);
  if (!Number.isSafeInteger(deliveryCharge) || deliveryCharge < 0) return reply.code(503).send({ error: 'delivery_charge_not_configured' });
  const address = safeAddress(request.body?.address);
  const items = request.body?.items;
  if (!address || !Array.isArray(items) || items.length < 1 || items.length > 50) return reply.code(400).send({ error: 'invalid_checkout' });
  const idempotencyKey = request.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return reply.code(400).send({ error: 'missing_idempotency_key' });
  if (!serviceablePins.has(address.pincode)) return reply.code(422).send({ error: 'outside_delivery_area', message: 'We do not currently deliver to this PIN code.' });
  const quantities = new Map();
  for (const item of items) {
    const productId = Number(item?.productId), quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25) return reply.code(400).send({ error: 'invalid_item' });
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [String(request.customer.id), idempotencyKey]);
    const previous = await client.query(
      `SELECT co.order_number, co.payment_status, co.reservation_expires_at, po.razorpay_order_id, po.amount_paise, po.currency
       FROM customer_orders co JOIN payment_orders po ON po.customer_order_id = co.id
       WHERE co.customer_id = $1 AND co.idempotency_key = $2`, [request.customer.id, idempotencyKey]
    );
    if (previous.rows[0]) {
      const oldOrder = previous.rows[0];
      if (new Date(oldOrder.reservation_expires_at) <= new Date() || ['expired', 'paid'].includes(oldOrder.payment_status)) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'checkout_already_processed', orderNumber: oldOrder.order_number });
      }
      await client.query('COMMIT');
      return { orderNumber: oldOrder.order_number, orderId: oldOrder.razorpay_order_id, amount: oldOrder.amount_paise, currency: oldOrder.currency, keyId: process.env.RAZORPAY_KEY_ID };
    }
    const ids = [...quantities.keys()];
    const { rows: products } = await client.query(
      'SELECT id, name, category, price_paise, selling_unit, stock_quantity, reserved_stock FROM products WHERE active = TRUE AND id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]
    );
    if (products.length !== ids.length) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'product_unavailable' }); }
    let subtotal = 0;
    const orderItems = [];
    for (const product of products) {
      const quantity = quantities.get(Number(product.id));
      if (Number(product.stock_quantity) - Number(product.reserved_stock) < quantity) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'insufficient_stock', productId: Number(product.id) }); }
      const unitPricePaise = Number(product.price_paise);
      subtotal += unitPricePaise * quantity;
      orderItems.push({ productId: Number(product.id), name: product.name, category: product.category, unit: product.selling_unit, quantity, unitPricePaise, lineTotalPaise: unitPricePaise * quantity });
    }
    const total = subtotal + deliveryCharge;
    if (!Number.isSafeInteger(total) || total < 100 || total > 10_000_000) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_order_total' }); }

    const inserted = await client.query(
      `INSERT INTO customer_orders (customer_id, idempotency_key, address, items, subtotal_paise, delivery_charge_paise, total_paise, reservation_expires_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, NOW() + INTERVAL '15 minutes') RETURNING id, created_at`,
      [request.customer.id, idempotencyKey, JSON.stringify(address), JSON.stringify(orderItems), subtotal, deliveryCharge, total]
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
    for (const [productId, quantity] of quantities) await client.query(
      'UPDATE products SET reserved_stock = reserved_stock + $2, updated_at = NOW() WHERE id = $1', [productId, quantity]
    );

    const gatewayOrder = await razorpay.orders.create({
      amount: total, currency: 'INR', receipt: `mv-${row.id}-${randomBytes(4).toString('hex')}`,
      notes: { order_number: orderNumber, customer_id: String(request.customer.id) }
    });
    await client.query('UPDATE customer_orders SET order_number = $2, razorpay_order_id = $3 WHERE id = $1', [row.id, orderNumber, gatewayOrder.id]);
    await client.query(
      `INSERT INTO payment_orders (razorpay_order_id, customer_order_id, amount_paise, currency, items, status)
       VALUES ($1, $2, $3, 'INR', $4::jsonb, 'created')`,
      [gatewayOrder.id, row.id, total, JSON.stringify(orderItems)]
    );
    await client.query('COMMIT');
    return reply.code(201).send({ orderNumber, orderId: gatewayOrder.id, amount: gatewayOrder.amount, currency: gatewayOrder.currency, keyId: process.env.RAZORPAY_KEY_ID, subtotalPaise: subtotal, deliveryChargePaise: deliveryCharge });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

app.get('/api/v1/orders', { preHandler: requireCustomer }, async (request) => {
  const { rows } = await pool.query(
    `SELECT order_number, items, subtotal_paise, delivery_charge_paise, total_paise, order_status, payment_status, created_at
     FROM customer_orders WHERE customer_id = $1 ORDER BY created_at DESC`, [request.customer.id]
  );
  return { orders: rows };
});

app.get('/api/v1/orders/:orderNumber', { preHandler: requireCustomer }, async (request, reply) => {
  const { rows } = await pool.query(
    `SELECT order_number, items, address, subtotal_paise, delivery_charge_paise, total_paise, order_status, payment_status, created_at
     FROM customer_orders WHERE customer_id = $1 AND order_number = $2`, [request.customer.id, request.params.orderNumber]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'order_not_found' });
  return { order: rows[0] };
});

app.post('/api/v1/payments/orders', async (_request, reply) => reply.code(410).send({ error: 'use_authenticated_checkout', endpoint: '/api/v1/orders' }));

app.post('/api/v1/payments/verify', async (request, reply) => {
  if (!process.env.RAZORPAY_KEY_SECRET) return reply.code(503).send({ error: 'payments_not_configured' });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = request.body || {};
  if (![orderId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0)) {
    return reply.code(400).send({ error: 'invalid_payment_proof' });
  }
  const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'hex'); } catch { supplied = Buffer.alloc(0); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reply.code(400).send({ verified: false, error: 'invalid_payment_signature' });
  }
  if (!pool || !razorpay) return reply.code(503).send({ error: 'payments_not_configured' });
  const paymentOrder = await pool.query('SELECT amount_paise FROM payment_orders WHERE razorpay_order_id = $1', [orderId]);
  if (!paymentOrder.rowCount) return reply.code(404).send({ verified: false, error: 'payment_order_not_found' });
  const [gatewayOrder, gatewayPayment] = await Promise.all([razorpay.orders.fetch(orderId), razorpay.payments.fetch(paymentId)]);
  if (gatewayPayment.order_id !== orderId || gatewayOrder.amount !== Number(paymentOrder.rows[0].amount_paise)) {
    return reply.code(400).send({ verified: false, error: 'payment_details_mismatch' });
  }
  if (gatewayPayment.amount !== Number(paymentOrder.rows[0].amount_paise) || gatewayPayment.currency !== 'INR') return reply.code(400).send({ verified: false, error: 'payment_details_mismatch' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const applied = await applyPaymentStatus(client, orderId, paymentId, gatewayPayment.status, gatewayPayment.amount, gatewayPayment.currency);
    await client.query('COMMIT');
    if (!applied) return reply.code(409).send({ verified: false, error: 'payment_state_not_applicable' });
    return { verified: true, orderId, paymentId, status: gatewayPayment.status };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

app.post('/api/v1/payments/webhook', async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'database_not_configured' });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return reply.code(503).send({ error: 'webhook_not_configured' });
  const signature = request.headers['x-razorpay-signature'];
  if (typeof signature !== 'string' || !request.rawBody) return reply.code(400).send({ error: 'invalid_webhook' });
  const expected = createHmac('sha256', secret).update(request.rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(400).send({ error: 'invalid_webhook_signature' });
  const eventId = request.headers['x-razorpay-event-id'];
  if (typeof eventId !== 'string' || !eventId) return reply.code(400).send({ error: 'missing_event_id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seen = await client.query('INSERT INTO payment_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
    if (seen.rowCount) {
      const entity = request.body?.payload?.payment?.entity;
      if (entity?.order_id && entity?.id) {
        const nextStatus = request.body.event === 'payment.captured' ? 'captured'
          : request.body.event === 'payment.failed' ? 'failed'
            : request.body.event === 'payment.authorized' ? 'authorized' : null;
        if (nextStatus) await applyPaymentStatus(client, entity.order_id, entity.id, nextStatus, entity.amount, entity.currency);
      }
    }
    await client.query('COMMIT');
    return reply.code(200).send({ received: true, duplicate: !seen.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? 'internal_server_error' : error.message });
});

async function releaseExpiredReservations() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, items FROM customer_orders
       WHERE payment_status IN ('pending', 'authorized') AND reservation_expires_at <= NOW()
       ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`
    );
    for (const order of rows) {
      for (const item of order.items) await client.query(
        'UPDATE products SET reserved_stock = GREATEST(0, reserved_stock - $2), updated_at = NOW() WHERE id = $1', [item.productId, item.quantity]
      );
      await client.query("UPDATE customer_orders SET payment_status = 'expired', order_status = 'cancelled', updated_at = NOW() WHERE id = $1", [order.id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    app.log.error(error, 'Failed to release expired inventory reservations');
  } finally { client.release(); }
}

const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });
const reservationSweep = setInterval(releaseExpiredReservations, 60_000);
reservationSweep.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(reservationSweep);
    await app.close();
    await pool?.end();
    process.exit(0);
  });
}

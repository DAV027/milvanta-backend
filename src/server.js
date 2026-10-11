import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';

const { Pool } = pg;
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 1_048_576 });
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } })
  : null;
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

await app.register(helmet);
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body;
  try { done(null, JSON.parse(body.toString('utf8'))); }
  catch (error) { done(error); }
});
await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean),
  credentials: true
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

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
    'SELECT id, name, description, category, price_paise, selling_unit, image_url, stock_quantity FROM products WHERE active = TRUE ORDER BY name'
  );
  return { products: rows };
});

app.post('/api/v1/payments/orders', async (request, reply) => {
  if (!pool || !razorpay) return reply.code(503).send({ error: 'payments_not_configured' });
  const items = request.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) return reply.code(400).send({ error: 'invalid_items' });

  const quantities = new Map();
  for (const item of items) {
    const id = Number(item?.productId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25) {
      return reply.code(400).send({ error: 'invalid_item' });
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }

  const ids = [...quantities.keys()];
  const { rows } = await pool.query(
    'SELECT id, price_paise, stock_quantity FROM products WHERE active = TRUE AND id = ANY($1::bigint[])', [ids]
  );
  if (rows.length !== ids.length) return reply.code(400).send({ error: 'product_unavailable' });
  let amount = 0;
  for (const product of rows) {
    const quantity = quantities.get(Number(product.id));
    if (product.stock_quantity < quantity) return reply.code(409).send({ error: 'insufficient_stock', productId: Number(product.id) });
    amount += Number(product.price_paise) * quantity;
    if (!Number.isSafeInteger(amount) || amount > 10_000_000) return reply.code(400).send({ error: 'order_amount_limit' });
  }
  if (amount < 100) return reply.code(400).send({ error: 'amount_below_payment_minimum' });

  const order = await razorpay.orders.create({ amount, currency: 'INR', receipt: `mv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
  await pool.query(
    `INSERT INTO payment_orders (razorpay_order_id, amount_paise, currency, items, status)
     VALUES ($1, $2, 'INR', $3::jsonb, 'created')`,
    [order.id, amount, JSON.stringify([...quantities].map(([productId, quantity]) => ({ productId, quantity })))]
  );
  return reply.code(201).send({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
});

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
  const status = gatewayPayment.status;
  await pool.query(
    `UPDATE payment_orders SET razorpay_payment_id = $2, status = $3, updated_at = NOW()
     WHERE razorpay_order_id = $1 AND status NOT IN ('captured', 'refunded')`,
    [orderId, paymentId, status]
  );
  return { verified: true, orderId, paymentId, status };
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
        if (nextStatus) await client.query(
          `UPDATE payment_orders SET razorpay_payment_id = $2, status = $3, updated_at = NOW()
           WHERE razorpay_order_id = $1 AND amount_paise = $4 AND currency = $5
             AND status NOT IN ('captured', 'refunded')`,
          [entity.order_id, entity.id, nextStatus, entity.amount, entity.currency]
        );
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

const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    await pool?.end();
    process.exit(0);
  });
}

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';

const { Pool } = pg;
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 1_048_576 });
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } })
  : null;

await app.register(helmet);
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

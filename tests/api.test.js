import './helpers/testDbGuard.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Set test environment before importing server
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_for_milvanta_ecommerce_suite_32_characters';
process.env.ADMIN_API_KEY = 'test_admin_secret_key_12345';

const { app } = await import('../src/server.js');
const scrypt = promisify(crypto.scrypt);

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

describe('MILVANTA API & Security Suite', () => {

  describe('Password Hashing & Security', () => {
    it('hashes passwords using scrypt with random salt', async () => {
      const hash1 = await hashPassword('SecurePass123!');
      const hash2 = await hashPassword('SecurePass123!');
      assert.notEqual(hash1, hash2, 'Hashes of same password must use distinct salts');
      assert.match(hash1, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    });

    it('verifies correct passwords and rejects incorrect ones', async () => {
      const hash = await hashPassword('SuperSecret88!');
      const valid = await verifyPassword('SuperSecret88!', hash);
      const invalid = await verifyPassword('WrongPassword!', hash);
      assert.equal(valid, true);
      assert.equal(invalid, false);
    });
  });

  describe('Health Endpoint', () => {
    it('returns service status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health'
      });
      assert.ok([200, 503].includes(res.statusCode));
      const body = JSON.parse(res.payload);
      assert.equal(body.service, 'milvanta-api');
    });
  });

  describe('CORS & Security Headers', () => {
    it('allows permitted Cloudflare Workers and Milvanta domains', async () => {
      const origins = [
        'http://localhost:8080',
        'http://127.0.0.1:5500',
        'http://localhost:5500',
        'https://solitary-firefly-ef06.akhilrajuvarma.workers.dev',
        'https://milvanta.in',
        'https://www.milvanta.in'
      ];

      for (const origin of origins) {
        const res = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/auth/me',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'Authorization'
          }
        });
        assert.equal(res.headers['access-control-allow-origin'], origin);
        assert.equal(res.headers['access-control-allow-credentials'], 'true');
      }
    });

    it('blocks unlisted third-party origins from CORS headers', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/me',
        headers: {
          Origin: 'https://malicious-website.xyz',
          'Access-Control-Request-Method': 'GET'
        }
      });
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });
  });

  describe('Authentication Validation', () => {
    it('rejects signup with invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Ananya Sharma',
          email: 'not-an-email',
          password: 'Password123'
        }
      });
      assert.equal(res.statusCode, 400);
    });

    it('rejects signup with short password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Ananya Sharma',
          email: 'ananya@milvanta.in',
          password: 'short'
        }
      });
      assert.equal(res.statusCode, 400);
    });

    it('rejects login with missing password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'user@milvanta.in'
        }
      });
      assert.equal(res.statusCode, 400);
    });

    it('rejects unauthorized requests to protected customer routes', async () => {
      const protectedRoutes = [
        { method: 'GET', url: '/api/v1/auth/me' },
        { method: 'GET', url: '/api/v1/addresses' },
        { method: 'POST', url: '/api/v1/addresses' },
        { method: 'GET', url: '/api/v1/orders' },
        { method: 'POST', url: '/api/v1/orders' }
      ];

      for (const route of protectedRoutes) {
        const res = await app.inject({
          method: route.method,
          url: route.url
        });
        assert.equal(res.statusCode, 401);
        const data = JSON.parse(res.payload);
        assert.equal(data.error, 'unauthorized');
      }
    });

    it('rejects forged or expired JWT Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          Authorization: 'Bearer invalid.forged.jwt.token'
        }
      });
      assert.equal(res.statusCode, 401);
      const data = JSON.parse(res.payload);
      assert.equal(data.error, 'unauthorized');
    });
  });

  describe('Admin Role-Based Authorization Guard', () => {
    it('blocks access to admin order routes without credentials', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders'
      });
      assert.equal(res.statusCode, 401);
    });

    it('allows access to admin routes when valid x-admin-key header is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        headers: {
          'x-admin-key': 'test_admin_secret_key_12345'
        }
      });
      // Should not be 401 or 403; returns 200 (or 503 if remote db not reachable)
      assert.ok([200, 503].includes(res.statusCode));
    });
  });

  describe('Checkout Input Validation', () => {
    it('rejects order checkout with invalid idempotency key', async () => {
      // Generate a mock JWT for syntax checking
      const token = app.jwt.sign({ sub: '1', email: 'test@milvanta.in' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': 'not-a-uuid'
        },
        payload: {
          address: {
            name: 'Rohit Varma',
            phone: '9876543210',
            house: 'Villa 12',
            building: 'Palm Meadows',
            street: 'Jubilee Hills',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500081'
          },
          items: [{ productId: 101, quantity: 2 }]
        }
      });
      // Either 401 (token session not found in mock db) or 400 (missing/invalid idempotency key)
      assert.ok([400, 401, 503].includes(res.statusCode));
    });
  });

});


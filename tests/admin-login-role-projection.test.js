import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';

// Uses a guarded disposable PostgreSQL schema. Never run against production.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin_login_role_test_secret_minimum_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_login_role_key';

const fixture = await setupDisposableTestSchema();
const { app, pool } = await import('../src/server.js');
const scrypt = promisify(crypto.scrypt);

after(async () => {
  await app.close();
  await pool.end();
  await cleanupDisposableTestSchema(fixture.pool, fixture.schemaName);
});

async function seedCustomer(email, isAdmin) {
  const password = 'TestPassword#8354';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
  const { rows: [customer] } = await fixture.pool.query(
    'INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, is_admin',
    [isAdmin ? 'Admin Login Fixture' : 'Customer Login Fixture',
      isAdmin ? '9876500011' : '9876500012', email, salt, hash, isAdmin]
  );
  return { customer, password };
}

describe('Admin login reads the authoritative PostgreSQL role', () => {
  it('returns admin role on login and allows the protected admin endpoint', async () => {
    const { customer, password } = await seedCustomer('admin-login-fixture@milvanta.test', true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: customer.email, password }
    });
    assert.equal(res.statusCode, 200, res.payload);
    const { token, user, customer: responseCustomer } = res.json();
    assert.equal(user.is_admin, true);
    assert.equal(responseCustomer.is_admin, true);
    assert.equal(typeof token, 'string');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Authorization: 'Bearer ' + token }
    });
    assert.equal(me.statusCode, 200, me.payload);
    assert.equal(me.json().customer.is_admin, true);

    const adminRoute = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers?limit=1',
      headers: { Authorization: 'Bearer ' + token }
    });
    assert.equal(adminRoute.statusCode, 200, adminRoute.payload);
  });

  it('returns nonadmin role on login and denies access to admin endpoint', async () => {
    const { customer, password } = await seedCustomer('nonadmin-login-fixture@milvanta.test', false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: customer.email, password }
    });
    assert.equal(res.statusCode, 200, res.payload);
    const { token, user, customer: responseCustomer } = res.json();
    assert.equal(user.is_admin, false);
    assert.equal(responseCustomer.is_admin, false);

    const adminRoute = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers?limit=1',
      headers: { Authorization: 'Bearer ' + token }
    });
    assert.equal(adminRoute.statusCode, 403, adminRoute.payload);
    assert.equal(adminRoute.json().error, 'forbidden_admin_required');
  });
});

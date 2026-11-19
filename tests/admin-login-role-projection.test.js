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

describe('Dedicated administrator authentication: real role, no customer session leakage', () => {
  it('accepts admin credentials, provides no-store response, and revokes on logout', async () => {
    const { customer, password } = await seedCustomer('admin-only-login@milvanta.test', true);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { email: customer.email.toUpperCase(), password }
    });
    assert.equal(login.statusCode, 200, login.payload);
    assert.match(login.headers['cache-control'], /no-store/);
    const { token, user, customer: responseCustomer } = login.json();
    assert.equal(user.is_admin, true);
    assert.equal(responseCustomer.is_admin, true);
    assert.equal(typeof token, 'string');
    const active = await app.inject({
      method:'GET',url:'/api/v1/admin/stats',
      headers:{Authorization:'Bearer ' + token}
    });
    assert.equal(active.statusCode,200,active.payload);
    const logout = await app.inject({
      method:'POST',url:'/api/v1/auth/logout',
      headers:{Authorization:'Bearer ' + token}
    });
    assert.equal(logout.statusCode,200,logout.payload);
    const afterLogout = await app.inject({
      method:'GET',url:'/api/v1/auth/me',
      headers:{Authorization:'Bearer ' + token}
    });
    assert.equal(afterLogout.statusCode,401,afterLogout.payload);
  });

  it('rejects correct customer credentials without creating an admin session', async () => {
    const { customer, password } = await seedCustomer('customer-no-admin-token@milvanta.test', false);
    const count = async () => Number((await fixture.pool.query(
      'SELECT count(*) AS n FROM customer_sessions WHERE customer_id = $1', [customer.id]
    )).rows[0].n);
    const before = await count();
    const res = await app.inject({
      method:'POST',url:'/api/v1/admin/auth/login',
      payload:{email:customer.email,password}
    });
    assert.equal(res.statusCode,403,res.payload);
    assert.equal(res.json().error,'forbidden_admin_required');
    assert.equal('token' in res.json(),false);
    assert.equal(await count(),before,'Denied login must not create a session');
  });

  it('wrong credentials and unknown users never create sessions or disclose a token', async () => {
    const { customer } = await seedCustomer('wrong-admin-password@milvanta.test', true);
    for(const email of [customer.email,'missing-admin@milvanta.test']){
      const response = await app.inject({
        method:'POST',url:'/api/v1/admin/auth/login',
        payload:{email,password:'incorrect password'}
      });
      assert.equal(response.statusCode,401,response.payload);
      assert.equal(response.json().error,'invalid_email_or_password');
      assert.equal('token' in response.json(),false);
    }
  });

  it('immediately rejects admin requests when an operator loses the role', async () => {
    const { customer, password } = await seedCustomer('revoked-admin@milvanta.test',true);
    const login = await app.inject({
      method:'POST',url:'/api/v1/admin/auth/login',
      payload:{email:customer.email,password}
    });
    assert.equal(login.statusCode,200,login.payload);
    const token=login.json().token;
    await fixture.pool.query('UPDATE customers SET is_admin = FALSE WHERE id = $1',[customer.id]);
    const denied=await app.inject({
      method:'GET',url:'/api/v1/admin/stats',
      headers:{Authorization:'Bearer ' + token}
    });
    assert.equal(denied.statusCode,403,denied.payload);
  });
});

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

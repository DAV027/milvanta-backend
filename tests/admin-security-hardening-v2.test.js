import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';

// Enforce test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin_security_v2_polish_secret_minimum_32_chars';
process.env.ADMIN_API_KEY = 'test_admin_security_v2_key';

const fixture = await setupDisposableTestSchema();
const { app, pool } = await import('../src/server.js');
const scrypt = promisify(crypto.scrypt);

after(async () => {
  await app.close();
  await pool.end();
  await cleanupDisposableTestSchema(fixture.pool, fixture.schemaName);
});

async function seedTestUser(email, isAdmin) {
  const password = 'TestSecurePassword#999!';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
  const phone = '9' + Math.floor(100000000 + Math.random() * 900000000);
  const { rows: [customer] } = await fixture.pool.query(
    'INSERT INTO customers (full_name, phone, email, password_salt, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, is_admin',
    [isAdmin ? 'Admin Test User' : 'Regular Customer User', phone, email, salt, hash, isAdmin]
  );
  return { customer, password };
}

describe('MILVANTA ADMIN V2 — Security Hardening, CSP, URL Isolation & UX Polish Suite', () => {

  // =========================================================================
  // 1. API Configuration & Production URL Isolation
  // =========================================================================
  describe('1. API Configuration & Production Backend URL Isolation', () => {
    it('verifies frontend/js/config.js and frontend/cloudflare-upload/js/config.js are byte-for-byte identical', () => {
      const p1 = path.resolve('frontend/js/config.js');
      const p2 = path.resolve('frontend/cloudflare-upload/js/config.js');
      assert.equal(fs.readFileSync(p1, 'utf8'), fs.readFileSync(p2, 'utf8'));
    });

    it('locks production domain (milvanta.in) strictly to https://milvanta-backend.onrender.com and rejects malicious query overrides', async () => {
      await import('../frontend/js/config.js');
      const resolveConfig = globalThis.resolveMilvantaConfig;
      assert.equal(typeof resolveConfig, 'function', 'resolveMilvantaConfig must be attached to global scope for testing');

      // Attacker passes ?backend=https://attacker.com on production domain
      const prodConfig = resolveConfig({
        hostname: 'milvanta.in',
        search: '?backend=https://attacker-domain.example.com&api=https://evil.com',
        storedApiUrl: 'https://evil-override.example.com'
      });

      assert.equal(prodConfig.apiUrl, 'https://milvanta-backend.onrender.com', 'Production must strictly resolve to official backend');
      assert.equal(prodConfig.isProduction, true, 'milvanta.in must be detected as production');
    });

    it('locks www.milvanta.in strictly to production backend', async () => {
      await import('../frontend/js/config.js');
      const resolveConfig = globalThis.resolveMilvantaConfig;

      const config = resolveConfig({
        hostname: 'www.milvanta.in',
        search: '?backend=https://attacker.com'
      });
      assert.equal(config.apiUrl, 'https://milvanta-backend.onrender.com');
      assert.equal(config.isProduction, true);
    });

    it('allows loopback port override only on localhost/127.0.0.1 and rejects remote URLs on localhost', async () => {
      await import('../frontend/js/config.js');
      const resolveConfig = globalThis.resolveMilvantaConfig;

      // Allowed local port override
      const localAllowed = resolveConfig({
        hostname: 'localhost',
        search: '?backend=http://127.0.0.1:3000'
      });
      assert.equal(localAllowed.apiUrl, 'http://127.0.0.1:3000');

      // Rejected remote attacker URL on localhost falls back to safe local port 10000
      const localRejected = resolveConfig({
        hostname: 'localhost',
        search: '?backend=https://malicious.evil.com'
      });
      assert.equal(localRejected.apiUrl, 'http://127.0.0.1:10000');
    });

    it('suppresses hardcoded rzp_test key fallback on production domains', async () => {
      await import('../frontend/js/config.js');
      const resolveConfig = globalThis.resolveMilvantaConfig;

      const config = resolveConfig({
        hostname: 'milvanta.in',
        search: ''
        // No liveKeyId or keyId configured
      });
      assert.equal(config.keyId, null, 'Must NOT use test key fallback in production');
    });
  });

  // =========================================================================
  // 2. Content Security Policy & Cloudflare Security Headers
  // =========================================================================
  describe('2. Content Security Policy & Security Headers', () => {
    it('verifies frontend/_headers and frontend/cloudflare-upload/_headers are byte-for-byte identical', () => {
      const h1 = path.resolve('frontend/_headers');
      const h2 = path.resolve('frontend/cloudflare-upload/_headers');
      assert.equal(fs.readFileSync(h1, 'utf8'), fs.readFileSync(h2, 'utf8'));
    });

    it('verifies CSP contains NO unsafe-eval and includes required Razorpay & Backend endpoints', () => {
      const headersContent = fs.readFileSync(path.resolve('frontend/_headers'), 'utf8');
      assert.ok(headersContent.includes('Content-Security-Policy:'), 'Must include CSP header');
      assert.ok(!headersContent.includes("'unsafe-eval'"), 'Must NOT contain unsafe-eval in CSP');
      assert.ok(headersContent.includes('https://milvanta-backend.onrender.com'), 'Must whitelist official backend URL');
      assert.ok(headersContent.includes('https://checkout.razorpay.com'), 'Must whitelist Razorpay checkout');
      assert.ok(headersContent.includes('https://api.razorpay.com'), 'Must whitelist Razorpay API');
      assert.ok(headersContent.includes("object-src 'none'"), 'Must set object-src none');
    });

    it('verifies /admin.html has strict private, no-store Cache-Control header and noindex robot tag', () => {
      const headersContent = fs.readFileSync(path.resolve('frontend/_headers'), 'utf8');
      assert.ok(headersContent.includes('/admin.html'), 'Must define /admin.html rules');
      assert.ok(headersContent.includes('no-store, no-cache, must-revalidate, private'), 'Must prevent caching of admin portal');
      assert.ok(headersContent.includes('X-Robots-Tag: noindex, nofollow, noarchive'), 'Must disallow indexing of admin portal');
    });
  });

  // =========================================================================
  // 3. Frontend Admin Dashboard UI/UX, Navigation & Safe DOM
  // =========================================================================
  describe('3. Admin Dashboard UI/UX, Navigation & Safe DOM Integrity', () => {
    const adminPath = path.resolve('frontend/admin.html');
    const cfAdminPath = path.resolve('frontend/cloudflare-upload/admin.html');
    const adminHtml = fs.readFileSync(adminPath, 'utf8');

    it('verifies frontend/admin.html and frontend/cloudflare-upload/admin.html match 100% byte-for-byte', () => {
      const cfHtml = fs.readFileSync(cfAdminPath, 'utf8');
      assert.equal(adminHtml, cfHtml, 'Must be 100% byte-for-byte identical');
    });

    it('verifies all 8 sections are present with exact section IDs', () => {
      const sections = [
        'id="overviewSection"',
        'id="deliveriesSection"',
        'id="subscriptionsSection"',
        'id="ordersSection"',
        'id="refundsSection"',
        'id="customersSection"',
        'id="demandSection"',
        'id="reportsSection"'
      ];
      for (const sec of sections) {
        assert.ok(adminHtml.includes(sec), `Section ${sec} must exist in admin.html`);
      }
    });

    it('verifies mobile drawer toggle, desktop collapse toggle and backdrop overlay exist', () => {
      assert.ok(adminHtml.includes('id="btnSidebarToggle"'), 'Mobile sidebar toggle must exist');
      assert.ok(adminHtml.includes('id="btnCollapseSidebarDesktop"'), 'Desktop sidebar collapse button must exist');
      assert.ok(adminHtml.includes('id="sidebarBackdrop"'), 'Sidebar backdrop overlay must exist');
      assert.ok(adminHtml.includes('aria-label="Toggle navigation sidebar"'), 'Aria label for mobile toggle must exist');
    });

    it('verifies live auto-refresh controls and status elements exist', () => {
      assert.ok(adminHtml.includes('id="btnManualRefresh"'), 'Manual refresh button must exist');
      assert.ok(adminHtml.includes('id="refreshTimerLabel"'), 'Refresh timer label indicator must exist');
    });

    it('verifies strict safe DOM practices: 0 innerHTML assignments and 0 inline onclick attributes', () => {
      const scriptMatches = adminHtml.match(/<script>([\s\S]*?)<\/script>/i);
      assert.ok(scriptMatches, 'Main script block must exist');
      const innerHtmlMatches = scriptMatches[1].match(/\.innerHTML\s*=/g) || [];
      assert.equal(innerHtmlMatches.length, 0, 'No innerHTML assignments allowed in admin script');

      const onclickMatches = adminHtml.match(/onclick\s*=/gi) || [];
      assert.equal(onclickMatches.length, 0, 'No inline onclick handlers allowed anywhere in admin.html');
    });
  });

  // =========================================================================
  // 4. Server-Authoritative RBAC & End-to-End Route Access Control
  // =========================================================================
  describe('4. Server-Authoritative RBAC: 401 Unauthenticated, 403 Non-Admin & 200 Admin', () => {
    let regularToken;
    let adminToken;
    const adminEmail = `sec_admin_${Date.now()}@milvanta.test`;
    const regularEmail = `sec_cust_${Date.now()}@milvanta.test`;

    it('authenticates admin and non-admin users via POST /api/v1/auth/login and projects authoritative is_admin flag', async () => {
      const { customer: adminCust, password: adminPass } = await seedTestUser(adminEmail, true);
      const { customer: regularCust, password: regPass } = await seedTestUser(regularEmail, false);

      // Login as Admin
      const adminLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: adminCust.email, password: adminPass }
      });
      assert.equal(adminLoginRes.statusCode, 200);
      const adminData = adminLoginRes.json();
      assert.equal(adminData.user.is_admin, true);
      assert.equal(adminData.customer.is_admin, true);
      adminToken = adminData.token;

      // Login as Regular Customer
      const regLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: regularCust.email, password: regPass }
      });
      assert.equal(regLoginRes.statusCode, 200);
      const regData = regLoginRes.json();
      assert.equal(regData.user.is_admin, false);
      assert.equal(regData.customer.is_admin, false);
      regularToken = regData.token;
    });

    const protectedEndpoints = [
      { method: 'GET', url: '/api/v1/admin/stats' },
      { method: 'GET', url: '/api/v1/admin/orders' },
      { method: 'GET', url: '/api/v1/admin/subscriptions' },
      { method: 'GET', url: '/api/v1/admin/customers' },
      { method: 'GET', url: '/api/v1/admin/demand-forecast' },
      { method: 'GET', url: '/api/v1/admin/reports' },
      { method: 'GET', url: '/api/v1/operations/deliveries' },
      { method: 'GET', url: '/api/v1/operations/deliveries/generate-preview' }
    ];

    for (const ep of protectedEndpoints) {
      it(`rejects unauthenticated request to ${ep.method} ${ep.url} with 401`, async () => {
        const res = await app.inject({ method: ep.method, url: ep.url });
        assert.equal(res.statusCode, 401);
      });

      it(`rejects non-admin customer request to ${ep.method} ${ep.url} with 403`, async () => {
        const res = await app.inject({
          method: ep.method,
          url: ep.url,
          headers: { Authorization: `Bearer ${regularToken}` }
        });
        assert.equal(res.statusCode, 403);
        assert.equal(res.json().error, 'forbidden_admin_required');
      });

      it(`allows authorized admin request to ${ep.method} ${ep.url} with 200`, async () => {
        const res = await app.inject({
          method: ep.method,
          url: ep.url,
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(res.statusCode, 200);
      });
    }
  });
});

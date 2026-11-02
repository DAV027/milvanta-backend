import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Source-level regressions complement the existing auth/API PostgreSQL suites.
// Browser interaction tests are still required before deployment.
const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('Customer and admin login/logout UX protections', () => {
  const admin = read('frontend/admin.html');
  const storefront = read('frontend/js/script.js');
  const profile = read('frontend/js/profile.js');
  const checkout = read('frontend/js/checkout.js');
  const backend = read('src/server.js');

  it('keeps Cloudflare deployment-source copies identical', () => {
    for (const p of ['admin.html', 'js/script.js', 'js/profile.js', 'js/checkout.js']) {
      assert.equal(read('frontend/' + p), read('frontend/cloudflare-upload/' + p), p);
    }
  });

  it('isolates admin credentials from customer tokens', () => {
    assert.match(admin, /let currentToken = sessionStorage\.getItem\(ADMIN_TOKEN_KEY\) \|\| '';/);
    assert.doesNotMatch(admin, /sessionStorage\.setItem\('milvanta-auth-token', currentToken\)/);
    assert.match(admin, /sessionStorage\.setItem\(ADMIN_TOKEN_KEY, currentToken\)/);
  });

  it('disables duplicate admin sign-in submissions and handles HTTP 429', () => {
    assert.match(admin, /if \(adminLoginInFlight\) return;/);
    assert.match(admin, /submitButton\.disabled = true;/);
    assert.match(admin, /res\.status === 429/);
    assert.match(admin, /res\.headers\.get\('retry-after'\)/);
    assert.match(admin, /adminLoginController/);
  });

  it('admin logout immediately removes local credential and requests revocation', () => {
    assert.match(admin, /const tokenToRevoke = currentToken;/);
    assert.match(admin, /sessionStorage\.removeItem\(ADMIN_TOKEN_KEY\);/);
    assert.match(admin, /revokeAdminSessionBestEffort\(tokenToRevoke\);/);
    assert.match(admin, /api\/v1\/auth\/logout/);
  });

  it('uses the customer returned by login without a sequential /auth/me fetch', () => {
    assert.match(storefront, /const session = await apiRequest\('\/api\/v1\/auth\/login'/);
    assert.doesNotMatch(storefront, /const session = await apiRequest\('\/api\/v1\/auth\/me'/);
    assert.match(storefront, /if \(accountAuthInFlight\) return;/);
  });

  it('all customer logout entrypoints clear local credentials promptly and revoke in best effort', () => {
    assert.match(storefront, /clearCustomerSessionImmediately\(\)/);
    assert.match(storefront, /revokeCustomerSessionBestEffort\(previousToken\)/);
    assert.match(profile, /const tokenToRevoke = authToken;/);
    assert.match(profile, /setAuthToken\(''\);/);
    assert.match(profile, /api\/v1\/auth\/logout/);
    assert.match(checkout, /const tokenToRevoke = authToken;/);
    assert.match(checkout, /api\/v1\/auth\/logout/);
  });

  it('retains server-side login throttling to protect against credential guessing', () => {
    assert.match(backend, /const authLimit =/);
    assert.match(backend, /rateLimit: \{ max:/);
  });
});
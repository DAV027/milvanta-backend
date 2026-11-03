/**
 * Read-only Razorpay gateway diagnostic.
 *
 * Reads ONLY GET /v1/orders, /v1/plans, and /v1/subscriptions using exactly
 * the credentials supplied to Milvanta. Never prints secrets, auth headers,
 * request/response bodies, customer records, or payment identifiers.
 *
 * Run in a trusted environment where RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET are already configured:
 *
 *   node scripts/razorpay-readonly-diagnostic.mjs
 *
 * Do NOT paste credentials into a terminal command or GitHub issues.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const READ_ENDPOINTS = Object.freeze(['orders', 'plans', 'subscriptions']);

export function classifyReadAccess(results) {
  const byName = Object.fromEntries(results.map(result => [result.endpoint, result.status]));
  const orders = byName.orders;
  const plans = byName.plans;
  const subscriptions = byName.subscriptions;
  if ([orders, plans, subscriptions].every(code => code === 200)) {
    return 'READ_ACCESS_OK: All three read APIs accepted these credentials. An earlier 401 during a create operation requires separate investigation; this probe does not test POST permissions.';
  }
  if (orders === 401) {
    return 'AUTH_REJECTED: Basic authentication failed on ordinary orders GET. Verify key ID/secret pairing, hidden whitespace and key rotation in this process.';
  }
  if (orders === 200 && [401, 403].includes(plans)) {
    return 'PLAN_ACCESS_REJECTED: Orders API works, but Plans API is denied. Investigate Razorpay subscription API permissions/account restrictions.';
  }
  if (orders === 200 && plans === 200 && [401, 403].includes(subscriptions)) {
    return 'SUBSCRIPTION_ACCESS_REJECTED: Orders and Plans GET work, but Subscriptions GET is denied. Investigate gateway account permissions.';
  }
  return 'INCONCLUSIVE: One or more read APIs failed or were unavailable. Review HTTP status codes and contact Razorpay support if persistent.';
}

export async function checkRazorpayReadAccess({ env = process.env, fetchImpl = fetch } = {}) {
  const keyId = String(env.RAZORPAY_KEY_ID || '');
  const keySecret = String(env.RAZORPAY_KEY_SECRET || '');
  const keyMode = keyId.startsWith('rzp_test_') ? 'test'
    : (keyId.startsWith('rzp_live_') ? 'live' : 'unrecognized');
  const configurationWarnings = [];
  if (!keyId || !keySecret) {
    throw new Error('Missing Razorpay credentials in environment. No request was sent.');
  }
  if (keyMode === 'unrecognized') {
    throw new Error('Unrecognized Razorpay key prefix. No request was sent.');
  }
  if (keyId !== keyId.trim() || keySecret !== keySecret.trim()) {
    configurationWarnings.push('Leading/trailing whitespace detected in a Razorpay environment variable; requests use the exact untrimmed values.');
  }
  const basicAuth = Buffer.from(keyId + ':' + keySecret, 'utf8').toString('base64');
  const results = [];
  for (const endpoint of READ_ENDPOINTS) {
    try {
      const response = await fetchImpl('https://api.razorpay.com/v1/' + endpoint + '?count=1', {
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + basicAuth,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
      results.push({ endpoint, status: response.status });
    } catch {
      // Avoid logging caught provider errors, which may include credentials or URLs.
      results.push({ endpoint, status: 'network_error' });
    }
  }
  return {
    keyMode,
    configurationWarnings,
    results,
    diagnosis: classifyReadAccess(results)
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  checkRazorpayReadAccess()
    .then(report => {
      // Deliberately output only mode, sanitised warnings, HTTP codes, and diagnosis.
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (!report.results.every(item => item.status === 200)) process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write('Unable to run safe Razorpay read-only diagnostic. Check environment configuration.\n');
      process.exitCode = 1;
    });
}

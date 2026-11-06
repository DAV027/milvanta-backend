/**
 * Milvanta subscription browser acceptance. Local mock HTTP only: no customer
 * credentials, Render, Razorpay, WhatsApp, Cloudflare deploy or payment calls.
 * Run: node scripts/verify-subscription-browser.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(repo, 'frontend', 'cloudflare-upload');
const screenshots = path.resolve(repo, 'tests', 'browser-artifacts', 'subscription-qa');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
let attemptedMutations = 0;
let offsiteRequests = 0;

function response(res, status, object) {
  const body = JSON.stringify(object);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function calendarData(query) {
  const year = Number(query.get('year') || 2026);
  const month = Number(query.get('month') ?? 10);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const statuses = new Map([
    ['2026-11-07', ['eligible', 'Paid day, order not generated yet']],
    ['2026-11-08', ['scheduled', 'Delivery order generated']],
    ['2026-11-09', ['skipped', 'Customer skipped']],
    ['2026-11-10', ['delivered', 'Delivered at 6:30 AM']],
    ['2026-11-11', ['test_mode', 'Test Mode, no dispatch']],
  ]);
  return {
    subscriptionId: 123, productName: 'Pure Cow Milk', quantity: '1 Litre', year, month,
    days: Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(Date.UTC(year, month, i + 1)).toISOString().slice(0, 10);
      const [status, detail] = statuses.get(date) || ['past', 'No order recorded'];
      return {
        date, day: i + 1, dayOfWeek: 'Sat', status, detail,
        isToday: date === '2026-11-06', isEditable: ['eligible', 'scheduled'].includes(status),
        productName: 'Pure Cow Milk', quantity: '1 Litre',
        hasGeneratedDeliveryOrder: ['scheduled', 'delivered'].includes(status),
        deliveryOrderNumber: ['scheduled', 'delivered'].includes(status) ? 'MV-SYNTHETIC' : null
      };
    })
  };
}
const sampleSubscription = {
  id: 123, product_name: 'Pure Cow Milk', status: 'active', quantity: '1 Litre',
  plan_type: 'custom', cost_per_day_paise: 10500, total_amount_paise: 315000,
  last_delivery_status: null, last_delivered_at: null, delivered_count: 0,
  next_delivery: 'Tomorrow, 6:00 AM',
  next_eligible_delivery: 'Pending delivery scheduling'
};
const sampleCustomer = {
  id: 42, full_name: 'QA Example Customer', email: 'qa@example.invalid',
  phone: '9000000000', phone_verified: true, is_admin: false
};

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); }
  catch { return response(res, 400, { error: 'invalid_url' }); }
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    if (req.method !== 'GET') {
      attemptedMutations++;
      return response(res, 405, { error: 'mock_read_only' });
    }
    if (pathname === '/api/v1/auth/me') return response(res, 200, { user: sampleCustomer, customer: sampleCustomer });
    if (pathname === '/api/v1/subscriptions') return response(res, 200, { subscriptions: [sampleSubscription] });
    if (/^\/api\/v1\/subscriptions\/123\/calendar$/.test(pathname)) return response(res, 200, calendarData(url.searchParams));
    if (pathname === '/api/v1/addresses') return response(res, 200, { addresses: [] });
    if (pathname === '/api/v1/orders') return response(res, 200, { orders: [] });
    if (pathname === '/api/v1/products') return response(res, 200, { products: [] });
    if (pathname === '/api/v1/customers/notifications/preferences') return response(res, 200, { enabled: false });
    return response(res, 200, {});
  }
  const resolved = path.resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!(resolved === site || resolved.startsWith(site + path.sep))) {
    return response(res, 403, { error: 'path_outside_fixture' });
  }
  try {
    const data = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(resolved)] || 'application/octet-stream' });
    res.end(data);
  } catch { return response(res, 404, { error: 'file_not_found' }); }
});

await fs.mkdir(screenshots, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions++; }
function sample(name, value) { process.stdout.write(name + ': ' + JSON.stringify(value) + '\n'); }
async function createPage({ width, height, timestamp, timezone = 'Asia/Kolkata', authenticated = false }) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: timezone,
    reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith(origin + '/')) return route.continue();
    offsiteRequests++;
    return route.abort();
  });
  if (authenticated) {
    await context.addInitScript(() => {
      sessionStorage.setItem('milvanta-auth-token', 'qa_loopback_only');
      localStorage.setItem('milvanta-auth-token', 'qa_loopback_only');
      localStorage.setItem('milvanta-user', JSON.stringify({ id:42, full_name:'QA Example Customer',
        email:'qa@example.invalid', phone:'9000000000' }));
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (timestamp) await page.clock.install({ time: new Date(timestamp) });
  return { context, page, errors };
}
async function assertNoPageErrors(errors, name) {
  check(errors.length === 0, name + ' uncaught browser errors: ' + errors.join('; '));
}
async function storefront({ viewport, time, expectedDay, name, timezone = 'Asia/Kolkata' }) {
  const { context, page, errors } = await createPage({
    width: viewport[0], height: viewport[1], timestamp: time, timezone
  });
  try {
    await page.goto(origin + '/index.html?backend=' + encodeURIComponent(origin), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.MilvantaSubscriptionSchedule) &&
      typeof window.openProductModal === 'function');
    await page.evaluate(() => window.openProductModal(101, 'subscription'));
    const start = await page.locator('#subPeriodStartDate').innerText();
    const paidThrough = await page.locator('#subPeriodEndDate').innerText();
    const badge = await page.locator('#subPeriodDaysBadge').innerText();
    check(start.includes(expectedDay) && start.includes('estimate'), name + ' first date was ' + start);
    equal(paidThrough, 'Confirmed after payment', name + ' premature entitlement');
    check(/days priced/i.test(badge), name + ' badge did not distinguish priced versus delivered days');
    if (name === 'cross-timezone-month-boundary') {
      check(badge.startsWith('31 '), 'December IST must price 31 days, not device-local November: ' + badge);
      const selected = await page.locator('#subStartMonthSelect option').first().innerText();
      check(selected.includes('December 2026'), 'starting-month chooser must use IST December: ' + selected);
    }
    check(await page.locator('#subPeriodCard').isVisible(), name + ' card hidden');
    const rect = await page.locator('#subPeriodCard').boundingBox();
    check(rect && rect.width <= viewport[0] + 12, name + ' card wider than viewport');
    await assertNoPageErrors(errors, name);
    await page.locator('#subPeriodCard').screenshot({path: path.join(screenshots, name + '.png')});
    sample(name, { start, paidThrough, badge, width: viewport[0], timezone });
  } finally { await context.close(); }
}
async function profileCalendar(width, height, name) {
  const { context, page, errors } = await createPage({
    width, height, timestamp: '2026-11-06T07:00:00Z', authenticated: true
  });
  try {
    await page.goto(origin + '/profile.html?tab=calendar&backend=' + encodeURIComponent(origin),
      {waitUntil: 'domcontentloaded'});
    await page.locator('#profileMonthlyCalendarGrid [data-status="eligible"]').first().waitFor({timeout:15000});
    equal(await page.locator('[data-date-key="2026-11-07"]').first().getAttribute('data-status'),
      'eligible', 'paid date without order must not show scheduled');
    equal(await page.locator('[data-date-key="2026-11-08"]').first().getAttribute('data-status'),
      'scheduled', 'generated order must be scheduled');
    const stats = await page.locator('#calMonthStatsBar').innerText();
    check(stats.includes('Orders Scheduled'), 'missing actual order count');
    check(stats.includes('Paid Days — Not Yet Scheduled'), 'missing ungenerated eligible count');
    await page.locator('#profileMonthlyCalendarGrid [data-date-key="2026-11-07"]').click();
    check((await page.locator('#calSelectedDayCard').innerText()).includes('Order Pending'),
      'eligible inspector falsely scheduled');
    await page.locator('#profileMonthlyCalendarGrid [data-date-key="2026-11-08"]').click();
    check((await page.locator('#calSelectedDayCard').innerText()).includes('Scheduled Morning Drop'),
      'actual delivery order inspector not scheduled');

    await page.locator('#profileMonthlyCalendarCard').screenshot({
      path: path.join(screenshots, name + '-calendar.png')
    });
    await page.evaluate(() => window.switchTab('subscription'));
    await page.locator('#btnOpenCreateSubModal').click({ timeout: 10000 });
    const start = await page.locator('#profileSubPeriodStartDate').innerText();
    const end = await page.locator('#profileSubPeriodEndDate').innerText();
    check(start.includes('7 Nov 2026') && start.includes('estimate'),
      'profile modal inaccurate first date: ' + start);
    equal(end, 'Confirmed after payment', 'profile modal mislabels paid through');
    await page.locator('#profileSubPeriodCard').screenshot({
      path: path.join(screenshots, name + '-profile-modal.png')
    });
    await assertNoPageErrors(errors, name);
    sample(name, { start, end, stats: stats.slice(0,170), width });
  } finally { await context.close(); }
}

try {
  browser = await chromium.launch({ headless: true });
  await storefront({name:'mobile-1959', viewport:[390,844],
    time:'2026-11-05T14:29:59Z', expectedDay:'6 Nov 2026'});
  await storefront({name:'mobile-2000', viewport:[390,844],
    time:'2026-11-05T14:30:00Z', expectedDay:'7 Nov 2026'});
  await storefront({name:'desktop-2000', viewport:[1440,900],
    time:'2026-11-05T14:30:00Z', expectedDay:'7 Nov 2026'});
  await storefront({name:'tablet-2000', viewport:[768,1024],
    time:'2026-11-05T14:30:00Z', expectedDay:'7 Nov 2026'});
  await storefront({name:'cross-timezone-midnight', viewport:[360,740],
    time:'2026-11-05T18:30:00Z', timezone:'America/Los_Angeles', expectedDay:'7 Nov 2026'});
  await storefront({name:'cross-timezone-month-boundary', viewport:[390,844],
    time:'2026-11-30T18:30:00Z', timezone:'America/Los_Angeles', expectedDay:'2 Dec 2026'});
  await profileCalendar(390, 844, 'mobile');
  await profileCalendar(1440, 900, 'desktop');
  equal(attemptedMutations, 0, 'mock browser attempted POST/PATCH/DELETE');
  sample('RESULT', { assertions, screenshots, attemptedMutations, blockedOffsiteRequests:offsiteRequests,
    backend:'loopback-only; no production access' });
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

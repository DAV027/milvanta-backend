import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../frontend/js/subscriptionDeliveryEstimate.js');
const context = { Date, Intl };
vm.runInNewContext(js, context, { filename: 'subscriptionDeliveryEstimate.js' });
const { earliestFirstDeliveryYMD: estimate, formatYMD } = context.MilvantaSubscriptionSchedule;

test('client estimate respects server 20:00 IST cutoff and midnight', () => {
  assert.equal(estimate({ now: new Date('2026-11-05T14:29:59Z') }), '2026-11-06');
  assert.equal(estimate({ now: new Date('2026-11-05T14:30:00Z') }), '2026-11-07');
  assert.equal(estimate({ now: new Date('2026-11-05T18:29:59Z') }), '2026-11-07');
  assert.equal(estimate({ now: new Date('2026-11-05T18:30:00Z') }), '2026-11-07');
});

test('client date estimate handles month/year rollovers and future start months', () => {
  assert.equal(estimate({ now: new Date('2026-11-30T14:30:00Z') }), '2026-12-02');
  assert.equal(estimate({ now: new Date('2026-12-31T14:30:00Z') }), '2027-01-02');
  assert.equal(estimate({ now: new Date('2026-11-05T14:45:00Z'), startOffset: 1 }), '2026-12-01');
  assert.equal(estimate({ now: new Date('2026-11-30T14:45:00Z'), startOffset: 1 }), '2026-12-02'); // cutoff wins over Dec 1
  assert.equal(formatYMD('2026-11-07').includes('Nov'), true);
});

test('customer pricing month comes from IST, not device timezone', () => {
  const before = context.MilvantaSubscriptionSchedule.currentIstYearMonth(new Date('2026-11-30T18:29:59Z'));
  const after = context.MilvantaSubscriptionSchedule.currentIstYearMonth(new Date('2026-11-30T18:30:00Z'));
  assert.equal(before.year, 2026);
  assert.equal(before.monthIndex, 10);
  assert.equal(after.year, 2026);
  assert.equal(after.monthIndex, 11);

  const storefront = read('../frontend/js/script.js');
  const profile = read('../frontend/js/profile.js');
  assert.match(storefront, /const \{ year, monthIndex \} = window\.MilvantaSubscriptionSchedule\.currentIstYearMonth\(\)/);
  assert.match(profile, /const \{ year, monthIndex \} = window\.MilvantaSubscriptionSchedule\.currentIstYearMonth\(\)/);
});

test('helper fails closed on bad dates and offsets', () => {
  assert.throws(() => estimate({ now: new Date(NaN) }), /invalid_delivery_estimate_clock/);
  assert.throws(() => estimate({ startOffset: -1 }), /invalid_delivery_start_month_offset/);
  assert.throws(() => estimate({ startOffset: 1.5 }), /invalid_delivery_start_month_offset/);
  assert.throws(() => formatYMD('2026-02-30'), /invalid_delivery_estimate_date/);
});

test('Cloudflare upload JS mirrors the source and loads before subscription scripts', () => {
  assert.equal(read('../frontend/js/subscriptionDeliveryEstimate.js'),
    read('../frontend/cloudflare-upload/js/subscriptionDeliveryEstimate.js'));
  for (const filename of ['script.js', 'profile.js']) {
    assert.equal(read('../frontend/js/' + filename),
      read('../frontend/cloudflare-upload/js/' + filename));
  }
  for (const filename of ['index.html', 'profile.html']) {
    const html = read('../frontend/' + filename);
    assert.equal(html, read('../frontend/cloudflare-upload/' + filename));
    assert.ok(html.indexOf('js/subscriptionDeliveryEstimate.js?v=20261105-1') <
      html.indexOf('js/' + (filename === 'index.html' ? 'script.js' : 'profile.js') + '?v=20261105-1'));
    assert.match(html, /8:00 PM IST cutoff applies/);
    assert.doesNotMatch(html, /Tomorrow, 17 Oct 2026/);
    assert.match(html, /Confirmed after payment/);
  }
});

test('subscription profile gives backend eligibility priority over stale next-delivery text', () => {
  const profile = read('../frontend/js/profile.js');
  assert.match(profile, /next_eligible_delivery/);
  assert.match(profile, /Pending delivery scheduling/);
  assert.doesNotMatch(profile, /Tomorrow, 19 Oct/);
  assert.doesNotMatch(profile, /nextDelivery \|\| 'Tomorrow'/);
});

test('subscription storefront and profile do not invent recurring paid-through dates', () => {
  const storefront = read('../frontend/js/script.js');
  const profile = read('../frontend/js/profile.js');
  assert.match(storefront, /endLabel: 'Confirmed after payment'/);
  assert.match(profile, /endFormatted = 'Confirmed after payment'/);
  assert.match(storefront, /days priced/);
  assert.match(profile, /days priced/);
});

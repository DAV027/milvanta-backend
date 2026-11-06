import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getEarliestPermittedDeliveryDateYMD } from '../src/services/deliveryCronPolicy.js';
import { addDaysToYMD, calculateNextDeliveryDate } from '../src/services/subscriptionService.js';
import fs from 'node:fs';

const utc = timestamp => new Date(timestamp);

test('first delivery respects the exact 20:00 IST cutoff (inclusive)', () => {
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T14:29:59Z')), '2026-11-06'); // 19:59:59 IST
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T14:30:00Z')), '2026-11-07'); // 20:00:00 IST
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T18:29:59Z')), '2026-11-07');
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T18:30:00Z')), '2026-11-07'); // 00:00 IST next day
});

test('first delivery correctly crosses month and year boundaries', () => {
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-11-30T14:29:59Z')), '2026-12-01');
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-11-30T14:30:00Z')), '2026-12-02');
  assert.equal(getEarliestPermittedDeliveryDateYMD(utc('2026-12-31T14:30:00Z')), '2027-01-02');
});

test('a future requested start is never moved earlier or backdated', () => {
  const now = utc('2026-11-05T14:45:00Z');
  assert.equal(getEarliestPermittedDeliveryDateYMD(now, '2026-12-01'), '2026-12-01');
  assert.equal(getEarliestPermittedDeliveryDateYMD(now, '2026-11-06'), '2026-11-07');
  assert.equal(getEarliestPermittedDeliveryDateYMD(now, '2026-11-07'), '2026-11-07');
});

test('invalid injected dates are rejected, not silently normalized', () => {
  assert.throws(() => getEarliestPermittedDeliveryDateYMD(new Date(NaN)), /invalid_delivery_schedule_clock/);
  assert.throws(() => getEarliestPermittedDeliveryDateYMD('2026-11-05'), /invalid_delivery_schedule_clock/);
  assert.throws(() => getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T14:45:00Z'), '2026-02-30'), /invalid_planned_delivery_start_date/);
  assert.throws(() => getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T14:45:00Z'), 'tomorrow'), /invalid_planned_delivery_start_date/);
});

test('prepaid delivered-day entitlement uses the actual earliest eligible start', () => {
  const start = getEarliestPermittedDeliveryDateYMD(utc('2026-11-05T14:45:00Z'));
  assert.equal(start, '2026-11-07');
  assert.equal(addDaysToYMD(start, 29), '2026-12-06');
  const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const idx = source.indexOf('async function materializeCustomDaysPlans');
  const section = source.slice(idx, idx + 1600);
  assert.ok(idx >= 0);
  assert.match(section, /const startDate = getEarliestPermittedDeliveryDateYMD\(\)/);
  assert.match(section, /const paidThroughDate = addDaysToYMD\(startDate, days - 1\)/);
});

test('next-delivery lookup never advertises a date for unpaid/mandate-only subscriptions', async () => {
  const sub = {id: 4, status: 'active', notes: { fulfillmentEntitled: false, paidCount: 1 }};
  const db = {async query() { return {rows: [sub]}; }};
  assert.equal(await calculateNextDeliveryDate(db, 4), 'Pending Billing Cycle Payment');
});

test('next-delivery lookup never treats paidCount alone as payment evidence', async () => {
  const sub = {id: 4, status: 'active', notes: { fulfillmentEntitled: true, paidCount: 1 }};
  const db = {async query() { return {rows: [sub]}; }};
  assert.equal(await calculateNextDeliveryDate(db, 4), 'Pending Billing Cycle Payment');
});

test('next-delivery lookup never promises a physical date for Test Mode or legacy gateway modes', async () => {
  for (const [keyMode, expected] of [
    ['test', 'Test Mode — No Physical Delivery'],
    [null, 'Payment Gateway Verification Required'],
    ['unrecognized', 'Payment Gateway Verification Required'],
    ['LIVE', 'Payment Gateway Verification Required']
  ]) {
    const notes = {
      fulfillmentEntitled: true, lastPaymentId: 'pay_synthetic',
      paidThroughDate: '2026-12-31', paidCount: 1, startDate: '2026-11-01'
    };
    if (keyMode !== null) notes.keyMode = keyMode;
    const db = {async query() { return {rows: [{
      id: 123, status: 'active', notes, plan_type: 'custom'
    }]}; }};
    assert.equal(await calculateNextDeliveryDate(db, 123), expected);
  }
});

test('newly captured custom-day subscriptions record the payment gateway mode', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = server.indexOf('async function materializeCustomDaysPlans');
  const end = server.indexOf('async function applyPaymentStatus', start);
  assert.ok(start > 0 && end > start);
  const text = server.slice(start, end);
  assert.match(text, /const keyMode = razorpayKeyId\.startsWith\('rzp_live_'\)/);
  assert.match(text, /keyMode,/);
  assert.match(text, /lastPaymentId: capturedPaymentId/);
});

test('next-delivery lookup fails closed on missing records and database errors', async () => {
  const missing = { async query() { return {rows: []}; }};
  const failed = { async query() { throw new Error('database_unavailable'); }};
  assert.equal(await calculateNextDeliveryDate(missing, 4), 'Pending delivery scheduling');
  assert.equal(await calculateNextDeliveryDate(failed, 4), 'Pending delivery scheduling');
});

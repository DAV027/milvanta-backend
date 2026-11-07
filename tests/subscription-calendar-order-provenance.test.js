import test from 'node:test';
import assert from 'node:assert/strict';
import { getEarliestPermittedDeliveryDateYMD } from '../src/services/deliveryCronPolicy.js';
import { addDaysToYMD, getSubscriptionCalendar } from '../src/services/subscriptionService.js';
import fs from 'node:fs';

const target = getEarliestPermittedDeliveryDateYMD();
const year = Number(target.slice(0, 4));
const month = Number(target.slice(5, 7)) - 1;
const paymentNotes = {
  fulfillmentEntitled: true,
  lastPaymentId: 'pay_synthetic_calendar_test',
  paidCount: 1,
  startDate: addDaysToYMD(target, -1),
  paidThroughDate: addDaysToYMD(target, 30),
  keyMode: 'live'
};

function mockedCalendar({ notes = paymentNotes, status = 'active', orders = [], skips = [], pauses = [] } = {}) {
  const subscription = {
    id: 123, customer_id: 42, product_name: 'Cow Milk', quantity: '500 ml',
    plan_type: 'custom', status, notes, cost_per_day_paise: 5500,
    total_amount_paise: 170500, created_at: new Date('2026-01-01T00:00:00Z')
  };
  const pool = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('FROM customer_subscriptions cs')) return { rows: [subscription] };
      if (statement.includes('FROM subscription_delivery_orders')) return { rows: orders };
      if (statement.includes('FROM subscription_skipped_dates')) return { rows: skips };
      if (statement.includes('FROM subscription_delivery_pauses')) return { rows: pauses };
      if (statement.includes('FROM subscription_billing_adjustments')) return { rows: [{ total_extension_days: 0 }] };
      throw new Error('Unexpected query in calendar provenance test');
    }
  };
  return getSubscriptionCalendar(pool, { subscriptionId: 123, customerId: 42, year, month });
}

function dayFor(calendar, day = target) {
  const found = calendar.days.find(d => d.date === day);
  assert.ok(found, 'expected date must exist in calendar');
  return found;
}

test('paid eligible future morning is NOT labeled scheduled without a persisted order', async () => {
  const day = dayFor(await mockedCalendar());
  assert.equal(day.status, 'eligible');
  assert.match(day.detail, /order not generated yet/i);
  assert.equal(day.hasGeneratedDeliveryOrder, false);
  assert.equal(day.deliveryOrderNumber, null);
  assert.equal(day.isEditable, true);
});

test('actual persisted scheduled order is labeled scheduled with provenance', async () => {
  const ord = { delivery_date: target, status: 'scheduled', delivery_order_number: 'MV-DEL-SYNTHETIC-123' };
  const day = dayFor(await mockedCalendar({ orders: [ord] }));
  assert.equal(day.status, 'scheduled');
  assert.equal(day.hasGeneratedDeliveryOrder, true);
  assert.equal(day.deliveryOrderNumber, 'MV-DEL-SYNTHETIC-123');
});

test('delivered and failed records remain historical facts even after account pause', async () => {
  for (const status of ['delivered', 'failed']) {
    const order = { delivery_date: target, status, delivery_order_number: 'TEST-ORDER',
      failed_reason: status === 'failed' ? 'Gate locked' : null,
      delivered_at: status === 'delivered' ? new Date() : null };
    const day = dayFor(await mockedCalendar({ orders: [order], status: 'paused' }));
    assert.equal(day.status, status);
    assert.equal(day.hasGeneratedDeliveryOrder, true);
  }
});

test('customer skip has precedence over an existing cancelled order', async () => {
  const day = dayFor(await mockedCalendar({
    orders: [{ delivery_date: target, status: 'cancelled', delivery_order_number: 'TEST-CANCELLED', failed_reason: 'Delivery date skipped by customer' }],
    skips: [{ skip_date: target, reason: 'Vacation trip' }]
  }));
  assert.equal(day.status, 'skipped');
  assert.equal(day.detail, 'Vacation trip');
  assert.equal(day.hasGeneratedDeliveryOrder, true);
});

test('unpaid or mandate-only and missing capture never show eligible', async () => {
  const variations = [
    { fulfillmentEntitled: false, paidThroughDate: addDaysToYMD(target, 30), lastPaymentId: 'pay_auth_only' },
    { fulfillmentEntitled: true, paidCount: 1, paidThroughDate: addDaysToYMD(target, 30) },
    { ...paymentNotes, authType: 'mandate_only' }
  ];
  for (const notes of variations) {
    const day = dayFor(await mockedCalendar({ notes }));
    assert.equal(day.status, 'pending_payment');
    assert.equal(day.hasGeneratedDeliveryOrder, false);
  }
});

test('Test Mode is explicitly marked not dispatchable even if paid', async () => {
  const day = dayFor(await mockedCalendar({ notes: { ...paymentNotes, keyMode: 'test' } }));
  assert.equal(day.status, 'test_mode');
  assert.match(day.detail, /no physical delivery order/i);
  assert.equal(day.hasGeneratedDeliveryOrder, false);
});

test('absent, invalid and legacy gateway modes never appear eligible even with payment evidence', async () => {
  const invalidModes = [undefined, null, '', 'unknown', 'unrecognized', 'LIVE', 'legacy'];
  for (const keyMode of invalidModes) {
    const notes = { ...paymentNotes };
    if (keyMode === undefined) delete notes.keyMode;
    else notes.keyMode = keyMode;
    const day = dayFor(await mockedCalendar({ notes }));
    assert.equal(day.status, 'mode_unverified', 'mode ' + String(keyMode));
    assert.match(day.detail, /requires verification/i);
    assert.equal(day.isEditable, false);
    assert.equal(day.hasGeneratedDeliveryOrder, false);
  }
});

test('an accidentally generated order in test or unknown mode is visible but NOT dispatch-ready', async () => {
  const order = {
    delivery_date: target, status: 'scheduled',
    delivery_order_number: 'MV-LEGACY-SYNTHETIC'
  };
  for (const [keyMode, expected] of [['test', 'test_mode'], ['unrecognized', 'mode_unverified']]) {
    const day = dayFor(await mockedCalendar({
      notes: { ...paymentNotes, keyMode },
      orders: [order]
    }));
    assert.equal(day.status, expected);
    assert.equal(day.hasGeneratedDeliveryOrder, true);
    assert.equal(day.deliveryOrderNumber, 'MV-LEGACY-SYNTHETIC');
    assert.equal(day.isEditable, false);
    assert.match(day.detail, /dispatch|operator verification/i);
  }
});

test('future dates in vacation and customer skips are not called eligible', async () => {
  const pause = { pause_start_date: target, pause_end_date: addDaysToYMD(target, 2), reason: 'Family trip' };
  const vac = dayFor(await mockedCalendar({ pauses: [pause] }));
  assert.equal(vac.status, 'vacation');
  const skipped = dayFor(await mockedCalendar({ skips: [{ skip_date: target, reason: 'Skip' }] }));
  assert.equal(skipped.status, 'skipped');
});

test('cancelled and paused subscriptions are not projected as eligible without orders', async () => {
  for (const status of ['cancelled', 'paused']) {
    const day = dayFor(await mockedCalendar({ status }));
    assert.equal(day.status, status);
    assert.equal(day.hasGeneratedDeliveryOrder, false);
  }
});

test('profile UI preserves source/upload parity and distinct eligible/actual-order labels', () => {
  const profile = fs.readFileSync(new URL('../frontend/js/profile.js', import.meta.url), 'utf8');
  const mirrored = fs.readFileSync(new URL('../frontend/cloudflare-upload/js/profile.js', import.meta.url), 'utf8');
  assert.equal(profile, mirrored);
  assert.match(profile, /status === 'eligible'/);
  assert.match(profile, /statusType === 'eligible'/);
  assert.match(profile, /Paid Days — Not Yet Scheduled/);
  assert.match(profile, /Orders Scheduled/);
  assert.match(profile, /status === 'test_mode'/);
  assert.match(profile, /status === 'mode_unverified'/);
  assert.match(profile, /statusType === 'mode_unverified'/);
  assert.doesNotMatch(profile, /fresh delivery starts tomorrow at 6:00 AM/i);
});

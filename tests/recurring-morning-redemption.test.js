import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessRecurringMorningRedemption, previewRecurringMorningRedemption,
  approveRecurringMorningObligation } from '../src/services/recurringMorningRedemption.js';

const now = new Date('2026-11-07T06:00:00Z');
const subscription = {
  id: 12, customer_id: 14, status: 'active', plan_type: 'month',
  razorpay_subscription_id: 'sub_approved_synthetic_1', cost_per_day_paise: 10500,
  notes: {
    keyMode: 'live', fulfillmentEntitled: true, paidCount: 1, months: 1,
    lastPaymentId: 'pay_approved_synthetic_1',
    startDate: '2026-11-06', paidThroughDate: '2026-12-05',
    planFirstCycleStartYMD: '2026-11-01', planFirstCycleEndYMD: '2026-11-30'
  },
  delivery_address: { street: 'Test Address Road', house: '42', pincode: '500033' }
};
const obligation = {
  id: 31, subscription_id: 12, customer_id: 14,
  razorpay_subscription_id: subscription.razorpay_subscription_id,
  payment_id: 'pay_approved_synthetic_1', status: 'approved',
  first_eligible_delivery: '2026-11-08',
  first_cycle_start: '2026-11-01', first_cycle_end: '2026-11-30',
  owed_mornings: 2, fulfilled_mornings: 0, refunded_mornings: 0,
  daily_rate_paise: 10500
};
function check(patch = {}) {
  return assessRecurringMorningRedemption({
    subscription, obligation, targetDate: '2026-12-06',
    effectivePaidThroughDate: '2026-12-05', now,
    validDeliveryAddress: true, ...patch
  });
}

test('an approved owed morning is only an informational candidate, NEVER dispatch authorization', () => {
  const value = check();
  assert.equal(value.eligible, true);
  assert.equal(value.availableMornings, 2);
  assert.equal(value.canGeneratePhysicalOrder, false);
  assert.match(value.note, /not dispatch authorization/);
});

test('renewals, existing paid cover, captured-identity mismatch and Test Mode fail closed', () => {
  const cases = [
    [{ subscription: { ...subscription, notes: { ...subscription.notes, paidCount: 2 } } }, 'renewal_or_multimonth_requires_reconciliation'],
    [{ subscription: { ...subscription, notes: { ...subscription.notes, months: 3 } } }, 'renewal_or_multimonth_requires_reconciliation'],
    [{ effectivePaidThroughDate: '2026-12-31' }, 'covered_by_existing_payment'],
    [{ subscription: { ...subscription, notes: { ...subscription.notes, keyMode: 'test' } } }, 'gateway_not_live'],
    [{ subscription: { ...subscription, notes: { ...subscription.notes, keyMode: undefined } } }, 'gateway_not_live'],
    [{ subscription: { ...subscription, notes: { ...subscription.notes, lastPaymentId: 'pay_other_captured' } } }, 'obligation_payment_or_identity_mismatch'],
    [{ subscription: { ...subscription, status: 'cancelled' } }, 'subscription_not_active'],
    [{ obligation: { ...obligation, status: 'pending_reconciliation' } }, 'finance_approval_required'],
    [{ obligation: { ...obligation, fulfilled_mornings: 2 } }, 'no_remaining_mornings'],
    [{ obligation: { ...obligation, fulfilled_mornings: 1, refunded_mornings: 1 } }, 'no_remaining_mornings'],
    [{ obligation: { ...obligation, daily_rate_paise: 10000 } }, 'obligation_payment_or_identity_mismatch'],
    [{ existingDeliveryOrder: true }, 'delivery_order_already_exists'],
    [{ skipped: true }, 'date_skipped'],
    [{ paused: true }, 'subscription_paused_for_date'],
    [{ pendingRefund: true }, 'refund_reconciliation_required'],
    [{ validDeliveryAddress: false }, 'delivery_address_not_verified'],
    [{ targetDate: '2026-11-07' }, 'covered_by_existing_payment'],
    [{ targetDate: '2026-02-30' }, 'invalid_delivery_date'],
    [{ effectivePaidThroughDate: null }, 'paid_through_unverified']
  ];
  for (const [patch, reason] of cases) {
    const result = check(patch);
    assert.equal(result.eligible, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(result.canGeneratePhysicalOrder, false);
  }
});

test('read-only database preview checks approved ledger, new billing and operational conflicts', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      const q = String(sql);
      queries.push(q);
      if (q.includes('FROM customer_subscriptions WHERE id')) return { rows: [subscription] };
      if (q.includes('FROM subscription_recurring_morning_obligations WHERE subscription_id')) return { rows: [obligation] };
      if (q.includes('FROM subscription_delivery_orders WHERE subscription_id')) return { rows: [] };
      if (q.includes('FROM subscription_skipped_dates')) return { rows: [] };
      if (q.includes('FROM subscription_delivery_pauses')) return { rows: [] };
      if (q.includes('FROM refund_requests')) return { rows: [] };
      if (q.includes('FROM customer_addresses')) return { rows: [] };
      throw Error('Unexpected preview SQL: ' + q);
    }
  };
  const preview = await previewRecurringMorningRedemption(client, {
    subscriptionId: 12, targetDate: '2026-12-06', now
  });
  assert.equal(preview.eligible, true);
  assert.equal(preview.canGeneratePhysicalOrder, false);
  assert.equal(preview.availableMornings, 2);
  assert.equal(preview.obligationId, obligation.id);
  assert.ok(queries.length >= 7);
  assert.ok(queries.every(q => /^\s*SELECT\b/.test(q)), 'Preview must not mutate SQL tables');
});

test('preview refuses renewed cycle before reading address or operational data', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      const q = String(sql);
      queries.push(q);
      if (q.includes('FROM customer_subscriptions WHERE id')) return {
        rows: [{ ...subscription, notes: { ...subscription.notes, paidCount: 2, paidThroughDate: '2027-01-05' } }]
      };
      if (q.includes('FROM subscription_recurring_morning_obligations WHERE subscription_id')) return { rows: [obligation] };
      throw Error('Must fail before other reads: ' + q);
    }
  };
  const result = await previewRecurringMorningRedemption(client, {
    subscriptionId: 12, targetDate: '2026-12-06', now
  });
  assert.equal(result.reason, 'renewal_or_multimonth_requires_reconciliation');
  assert.equal(result.canGeneratePhysicalOrder, false);
  assert.equal(queries.length, 2);
});

test('approval path is disabled by default without a database connection or writes', async () => {
  const client = {
    async query() { throw Error('No SQL permitted when approval is disabled'); }
  };
  const result = await approveRecurringMorningObligation(client, {
    obligationId: 31, reviewerId: 42, caseReference: 'FIN-2026-REC-1'
  });
  assert.equal(result.approved, false);
  assert.equal(result.reason, 'approval_feature_disabled');
});

test('the code does not connect approval or preview to an API, generation loop, or automatic dispatch', () => {
  const code = fs.readFileSync(new URL('../src/services/recurringMorningRedemption.js', import.meta.url), 'utf8');
  assert.match(code, /RECURRING_MORNING_REDEMPTION_APPROVAL_ENABLED/);
  assert.doesNotMatch(code, /INSERT INTO subscription_delivery_orders/);
  assert.doesNotMatch(code, /razorpay\.(subscriptions|payments|refunds)/);
  const engine = fs.readFileSync(new URL('../src/services/deliveryEngine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(engine, /approveRecurringMorningObligation|previewRecurringMorningRedemption/);
});

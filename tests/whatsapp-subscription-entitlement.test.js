import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';
import { configureMockWhatsApp } from './helpers/mockWhatsApp.js';
import { queuePaidSubscriptionActivation, queueBillingReminders } from '../src/services/notificationService.js';
import { setWhatsAppPreferences } from '../src/services/whatsappService.js';
import { getNowInIST, formatDateYMD, addDaysToYMD } from '../src/services/subscriptionService.js';

process.env.NODE_ENV = 'test';
configureMockWhatsApp();
let setup, pool, customer, today, renewalDate;
before(async () => {
  setup = await setupDisposableTestSchema();
  pool = setup.pool;
  customer = (await pool.query(`INSERT INTO customers(full_name,email,phone,password_salt,password_hash,phone_verified_at)
    VALUES('Entitlement Test','entitlement@test.invalid','9876543210','salt','hash',NOW()) RETURNING *`)).rows[0];
  await setWhatsAppPreferences(pool, customer, { enabled: true });
});
beforeEach(async () => {
  await pool.query('DELETE FROM notification_outbox');
  await pool.query('DELETE FROM customer_subscriptions');
  today = formatDateYMD(getNowInIST());
  renewalDate = addDaysToYMD(today, 3);
});
after(async () => { if (setup) await cleanupDisposableTestSchema(pool, setup.schemaName); });

async function subscription(patch = {}, status = 'active') {
  const notes = { fulfillmentEntitled: true, lastPaymentId: 'pay_captured_test', authType: 'recurring_charge',
    startDate: today, paidThroughDate: renewalDate, paidCount: 1, ...patch };
  const { rows } = await pool.query(`INSERT INTO customer_subscriptions(customer_id,product_name,quantity,plan_type,
    cost_per_day_paise,total_amount_paise,status,notes) VALUES($1,'Milk','1 Litre','month',10000,300000,$2,$3) RETURNING id`,
  [customer.id, status, notes]);
  return rows[0].id;
}
async function assertNeitherQueued(id) {
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).queued, false);
  assert.equal((await queueBillingReminders(pool)).queued, 0);
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM notification_outbox')).rows[0].count), 0);
}

for (const [name, patch] of [
  ['missing entitlement metadata with a payment reference', { fulfillmentEntitled: undefined }],
  ['explicitly unpaid fulfillment', { fulfillmentEntitled: false }],
  ['null fulfillment entitlement', { fulfillmentEntitled: null }],
  ['string true is not verified boolean entitlement', { fulfillmentEntitled: 'true' }],
  ['expired paid-through date', { paidThroughDate: '2020-01-01' }],
  ['zero paid cycles despite payment reference', { paidCount: 0 }],
  ['mandate-only authorization', { authType: 'mandate_only', mandatePaymentId: 'pay_authorization' }],
  ['no captured-payment reference', { lastPaymentId: null, paymentId: null }],
  ['blank captured-payment references', { lastPaymentId: ' ', paymentId: '' }],
  ['malformed nonstring payment reference', { lastPaymentId: { id: 'pay_untrusted' } }],
  ['no authoritative paid-through schedule', { paidThroughDate: null, startDate: 'invalid' }],
  ['invalid calendar paid-through date', { paidThroughDate: '2099-02-30' }]
]) {
  test(`no activation or renewal for ${name}`, async () => assertNeitherQueued(await subscription(patch)));
}
for (const status of ['paused', 'cancelled', 'expired', 'pending_payment', 'pending_authorization']) {
  test(`no activation or renewal for ${status} subscriptions`, async () => assertNeitherQueued(await subscription({}, status)));
}
test('valid captured paid subscription queues activation and renewal once', async () => {
  const id = await subscription();
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).queued, true);
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).duplicate, true);
  assert.equal((await queueBillingReminders(pool)).queued, 1);
  assert.equal((await queueBillingReminders(pool)).queued, 0);
  const { rows } = await pool.query('SELECT channel,template_name,template_parameters,idempotency_key FROM notification_outbox ORDER BY id');
  assert.deepEqual(rows.map(r => r.template_name), ['milvanta_subscription_activated', 'milvanta_billing_reminder']);
  assert.ok(rows.every(r => r.channel === 'whatsapp'));
  assert.equal(rows[1].template_parameters.values[1], renewalDate);
  assert.equal(rows[0].idempotency_key, `sms_sub_activated_${id}`);
});
test('server-recorded paymentId is supported when lastPaymentId is absent', async () => {
  const id = await subscription({ lastPaymentId: null, paymentId: 'pay_captured_prepaid' });
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).queued, true);
  assert.equal((await queueBillingReminders(pool)).queued, 1);
});
test('paid-through today is still eligible for activation but not a three-day renewal', async () => {
  const id = await subscription({ paidThroughDate: today });
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).queued, true);
  assert.equal((await queueBillingReminders(pool)).queued, 0);
});
test('prepaid extensions determine effective activation and renewal dates', async () => {
  const id = await subscription({ paidThroughDate: addDaysToYMD(today, -1) });
  await pool.query(`INSERT INTO subscription_billing_adjustments(subscription_id,customer_id,adjustment_type,days_count)
    VALUES($1,$2,'extension',4)`, [id, customer.id]);
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).queued, true);
  assert.equal((await queueBillingReminders(pool)).queued, 1);
  const reminder = (await pool.query("SELECT template_parameters,idempotency_key FROM notification_outbox WHERE template_name='milvanta_billing_reminder'")).rows[0];
  assert.equal(reminder.template_parameters.values[1], renewalDate);
  assert.equal(reminder.idempotency_key, `billing_reminder_${id}_${renewalDate}`);
});
test('prepaid extension defers reminders beyond a stale raw renewal date', async () => {
  const id = await subscription();
  await pool.query(`INSERT INTO subscription_billing_adjustments(subscription_id,customer_id,adjustment_type,days_count)
    VALUES($1,$2,'extension',2)`, [id, customer.id]);
  assert.equal((await queueBillingReminders(pool)).queued, 0);
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM notification_outbox')).rows[0].count), 0);
});
test('recurring plans do not acquire prepaid-only extensions', async () => {
  const id = await subscription();
  await pool.query("UPDATE customer_subscriptions SET razorpay_subscription_id='sub_recurring_test' WHERE id=$1", [id]);
  await pool.query(`INSERT INTO subscription_billing_adjustments(subscription_id,customer_id,adjustment_type,days_count)
    VALUES($1,$2,'extension',2)`, [id, customer.id]);
  assert.equal((await queueBillingReminders(pool)).queued, 1);
});
test('expiry and three-day renewal use the IST date after UTC midnight divergence', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-22T20:00:00Z') });
  today = formatDateYMD(getNowInIST());
  renewalDate = addDaysToYMD(today, 3);
  assert.equal(today, '2026-10-23');
  assert.equal(renewalDate, '2026-10-26');
  await assertNeitherQueued(await subscription({ paidThroughDate: '2026-10-22' }));
  const id = await subscription({ paidThroughDate: '2026-10-26' });
  assert.equal((await queuePaidSubscriptionActivation(pool, id)).queued, true);
  assert.equal((await queueBillingReminders(pool)).queued, 1);
});
test('out-of-range schedule metadata cannot queue activation or renewal', async () => {
  await assertNeitherQueued(await subscription({ startDate: null, start_at: 1e20 }));
});
test('one invalid schedule does not prevent eligible subscriptions receiving renewal reminders', async () => {
  await subscription({ startDate: null, start_at: 1e20 });
  const id = await subscription();
  assert.equal((await queueBillingReminders(pool)).queued, 1);
  const { rows } = await pool.query('SELECT idempotency_key FROM notification_outbox');
  assert.deepEqual(rows.map(row => row.idempotency_key), [`billing_reminder_${id}_${renewalDate}`]);
});

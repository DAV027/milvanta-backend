/**
 * Finance-approved review of owed recurring mornings.
 *
 * No physical orders, Razorpay charges/refunds, paid-through extensions or
 * notifications are generated here. Preview is read-only; approval is gated
 * and currently NOT wired to any API or automatic scheduler.
 */
import {
  acquireClient, getEffectivePaidThroughDate, getSubscriptionGatewayMode
} from './subscriptionService.js';
import { extractValidDeliveryAddress } from './deliveryEngine.js';
import { getEarliestPermittedDeliveryDateYMD } from './deliveryCronPolicy.js';

function validYMD(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function assessRecurringMorningRedemption({
  subscription, obligation, targetDate, effectivePaidThroughDate,
  now = new Date(), existingDeliveryOrder = false,
  skipped = false, paused = false, validDeliveryAddress = false,
  pendingRefund = false
} = {}) {
  const fail = reason => ({ eligible: false, reason, canGeneratePhysicalOrder: false });
  if (!validYMD(targetDate)) return fail('invalid_delivery_date');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return fail('invalid_clock');
  if (!subscription || !obligation) return fail('missing_subscription_or_obligation');
  if (subscription.status !== 'active') return fail('subscription_not_active');
  const notes = subscription.notes && typeof subscription.notes === 'object' ? subscription.notes : {};
  if (getSubscriptionGatewayMode(notes) !== 'live') return fail('gateway_not_live');
  if (notes.fulfillmentEntitled !== true || notes.authType === 'mandate_only') return fail('not_captured_entitlement');
  if (Number(notes.paidCount) !== 1 || Number(notes.months) !== 1) return fail('renewal_or_multimonth_requires_reconciliation');
  if (obligation.status !== 'approved') return fail('finance_approval_required');
  if (Number(obligation.subscription_id) !== Number(subscription.id) ||
      Number(obligation.customer_id) !== Number(subscription.customer_id) ||
      obligation.razorpay_subscription_id !== subscription.razorpay_subscription_id ||
      obligation.payment_id !== (notes.lastPaymentId || notes.paymentId) ||
      Number(obligation.daily_rate_paise) !== Number(subscription.cost_per_day_paise)) {
    return fail('obligation_payment_or_identity_mismatch');
  }
  const owed = Number(obligation.owed_mornings);
  const settled = Number(obligation.fulfilled_mornings) + Number(obligation.refunded_mornings);
  if (![owed, settled].every(Number.isSafeInteger) || owed <= 0 || settled < 0 || settled >= owed) {
    return fail('no_remaining_mornings');
  }
  if (!validYMD(effectivePaidThroughDate)) return fail('paid_through_unverified');
  if (targetDate <= effectivePaidThroughDate) return fail('covered_by_existing_payment');
  if (!validYMD(obligation.first_eligible_delivery) ||
      targetDate < obligation.first_eligible_delivery) return fail('before_obligation_start');
  if (targetDate < getEarliestPermittedDeliveryDateYMD(now)) return fail('outside_ist_delivery_cutoff');
  if (existingDeliveryOrder) return fail('delivery_order_already_exists');
  if (pendingRefund) return fail('refund_reconciliation_required');
  if (skipped) return fail('date_skipped');
  if (paused) return fail('subscription_paused_for_date');
  if (!validDeliveryAddress) return fail('delivery_address_not_verified');
  return {
    eligible: true, reason: 'review_candidate_only',
    availableMornings: owed - settled,
    targetDate, canGeneratePhysicalOrder: false,
    note: 'Manual financial review candidate, not dispatch authorization; renewal race must be rechecked in a separate atomic reservation design.'
  };
}

/**
 * Read-only preview. Queries same-cycle obligation and current captured
 * entitlement, renewal state, skips/pauses, refund requests, and real address.
 * This never creates an order. No customer-identifying details returned.
 */
export async function previewRecurringMorningRedemption(pool, {
  subscriptionId, targetDate, now = new Date()
} = {}) {
  if (!Number.isSafeInteger(Number(subscriptionId)) || Number(subscriptionId) <= 0) {
    return { eligible: false, reason: 'invalid_subscription_id', canGeneratePhysicalOrder: false };
  }
  if (!validYMD(targetDate)) {
    return { eligible: false, reason: 'invalid_delivery_date', canGeneratePhysicalOrder: false };
  }
  const { client, release } = await acquireClient(pool);
  try {
    const { rows: subscriptions } = await client.query(
      'SELECT * FROM customer_subscriptions WHERE id = $1',
      [subscriptionId]
    );
    const subscription = subscriptions[0];
    if (!subscription) return { eligible: false, reason: 'subscription_not_found', canGeneratePhysicalOrder: false };
    const { rows: obligations } = await client.query(
      "SELECT *, first_eligible_delivery::text AS first_eligible_delivery FROM subscription_recurring_morning_obligations WHERE subscription_id = $1 AND status = 'approved' ORDER BY first_cycle_start ASC LIMIT 1",
      [subscriptionId]
    );
    const obligation = obligations[0];
    if (!obligation) return { eligible: false, reason: 'no_approved_obligation', canGeneratePhysicalOrder: false };

    // Prefer strict fail-closed authentication before any schedule/PII reads.
    const precheck = assessRecurringMorningRedemption({
      subscription, obligation, targetDate,
      effectivePaidThroughDate: await getEffectivePaidThroughDate(client, subscription),
      now
    });
    if (!['delivery_address_not_verified', 'covered_by_existing_payment'].includes(precheck.reason)) {
      // The pure assessor defaults to no verified address. Any other reason
      // means the candidate is already ineligible, and no further DB reads help.
      return { ...precheck, subscriptionId: Number(subscriptionId) };
    }
    if (precheck.reason === 'covered_by_existing_payment') {
      return { ...precheck, subscriptionId: Number(subscriptionId) };
    }

    const { rows: orders } = await client.query(
      'SELECT id FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2 LIMIT 1',
      [subscriptionId, targetDate]
    );
    const { rows: skips } = await client.query(
      'SELECT id FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2 LIMIT 1',
      [subscriptionId, targetDate]
    );
    const { rows: pauses } = await client.query(
      "SELECT id FROM subscription_delivery_pauses WHERE subscription_id = $1 AND pause_start_date <= $2 AND (pause_end_date IS NULL OR pause_end_date >= $2) AND resumed_at IS NULL LIMIT 1",
      [subscriptionId, targetDate]
    );
    const { rows: refunds } = await client.query(
      "SELECT id FROM refund_requests WHERE subscription_id = $1 AND status IN ('pending','approved','processing','processed') LIMIT 1",
      [subscriptionId]
    );
    const { rows: addresses } = await client.query(
      'SELECT recipient_name,phone,house,building,street,landmark,city,state,pincode FROM customer_addresses WHERE customer_id = $1 AND is_default = TRUE LIMIT 1',
      [subscription.customer_id]
    );
    const address = extractValidDeliveryAddress(subscription, addresses[0], null);
    return {
      ...assessRecurringMorningRedemption({
        subscription, obligation, targetDate,
        effectivePaidThroughDate: await getEffectivePaidThroughDate(client, subscription),
        now, existingDeliveryOrder: orders.length > 0,
        skipped: skips.length > 0, paused: pauses.length > 0,
        validDeliveryAddress: Boolean(address),
        pendingRefund: refunds.length > 0
      }),
      subscriptionId: Number(subscriptionId),
      obligationId: Number(obligation.id)
    };
  } finally { release(); }
}

/**
 * Finance review approval only. Does NOT generate delivery entitlement.
 * No route calls this function. Production cannot opt-in via arguments alone:
 * RECURRING_MORNING_REDEMPTION_APPROVAL_ENABLED=true must be configured and
 * an authorized caller with reviewer ID + case reference must be added later.
 */
export async function approveRecurringMorningObligation(pool, {
  obligationId, reviewerId, caseReference,
  enabled = false
} = {}) {
  if (!enabled || (process.env.NODE_ENV !== 'test' &&
      process.env.RECURRING_MORNING_REDEMPTION_APPROVAL_ENABLED !== 'true')) {
    return { approved: false, reason: 'approval_feature_disabled' };
  }
  if (!Number.isSafeInteger(Number(obligationId)) || Number(obligationId) <= 0 ||
      !Number.isSafeInteger(Number(reviewerId)) || Number(reviewerId) <= 0 ||
      typeof caseReference !== 'string' || !/^[A-Za-z0-9_/-]{8,120}$/.test(caseReference)) {
    return { approved: false, reason: 'invalid_finance_approval_evidence' };
  }
  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT o.*, s.status AS subscription_status, s.notes AS subscription_notes, s.razorpay_subscription_id AS subscription_gateway_id, s.cost_per_day_paise AS subscription_daily_rate FROM subscription_recurring_morning_obligations o JOIN customer_subscriptions s ON s.id = o.subscription_id WHERE o.id = $1 FOR UPDATE OF o",
      [obligationId]
    );
    const ob = rows[0];
    if (!ob) {
      await client.query('ROLLBACK');
      return { approved: false, reason: 'obligation_not_found' };
    }
    if (ob.status === 'approved') {
      await client.query('COMMIT');
      return { approved: false, reason: 'already_approved', obligationId: ob.id };
    }
    const notes = ob.subscription_notes || {};
    if (ob.status !== 'pending_reconciliation' ||
        ob.subscription_status !== 'active' ||
        notes.keyMode !== 'live' ||
        notes.fulfillmentEntitled !== true ||
        Number(notes.paidCount) !== 1 ||
        Number(notes.months) !== 1 ||
        (notes.lastPaymentId || notes.paymentId) !== ob.payment_id ||
        ob.subscription_gateway_id !== ob.razorpay_subscription_id ||
        Number(ob.subscription_daily_rate) !== Number(ob.daily_rate_paise)) {
      await client.query('ROLLBACK');
      return { approved: false, reason: 'financial_evidence_or_status_not_verified' };
    }
    const { rows: reviewer } = await client.query(
      'SELECT id FROM customers WHERE id = $1 AND is_admin = TRUE LIMIT 1',
      [reviewerId]
    );
    if (!reviewer.length) {
      await client.query('ROLLBACK');
      return { approved: false, reason: 'finance_reviewer_not_admin' };
    }
    const { rows: refunds } = await client.query(
      "SELECT id FROM refund_requests WHERE subscription_id = $1 AND status IN ('pending','approved','processing','processed') LIMIT 1",
      [ob.subscription_id]
    );
    if (refunds.length) {
      await client.query('ROLLBACK');
      return { approved: false, reason: 'refund_reconciliation_required' };
    }
    const updated = await client.query(
      "UPDATE subscription_recurring_morning_obligations SET status = 'approved', updated_at = NOW() WHERE id = $1 AND status = 'pending_reconciliation' RETURNING id",
      [obligationId]
    );
    if (updated.rowCount !== 1) throw new Error('finance_obligation_approval_race');
    await client.query(
      "INSERT INTO subscription_recurring_morning_obligation_events (obligation_id,event_key,event_type,days_delta,notes,evidence) VALUES ($1,$2,'adjusted',0,$3,$4::jsonb)",
      [obligationId, 'approval:' + obligationId,
        'Approval for finance-review planning only; no delivery entitlement created',
        JSON.stringify({ caseReference, reviewerId: Number(reviewerId), action: 'finance_approved' })]
    );
    await client.query('COMMIT');
    return { approved: true, obligationId: Number(obligationId), status: 'approved', dispatchAuthorized: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { release(); }
}

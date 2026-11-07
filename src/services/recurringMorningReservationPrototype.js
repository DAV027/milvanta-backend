/**
 * TEST-ONLY prototype of transactional owed-morning reservation and settlement.
 * Permanently rejects non-test environments in this phase, even with flag=true.
 * NOT an operational dispatch API. No messaging, refunds or Razorpay operations.
 */
import crypto from 'node:crypto';
import { acquireClient, getEffectivePaidThroughDate } from './subscriptionService.js';
import { getEarliestPermittedDeliveryDateYMD } from './deliveryCronPolicy.js';
import { extractValidDeliveryAddress, VALID_STATUS_TRANSITIONS } from './deliveryEngine.js';
import { assessRecurringMorningRedemption } from './recurringMorningRedemption.js';

const testModeEnabled = () =>
  process.env.NODE_ENV === 'test' &&
  process.env.RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED === 'true';
const invalid = reason => ({ success: false, reason, dispatchAuthorized: false });

function asYMD(date) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return '';
}
function validId(id) { return Number.isSafeInteger(Number(id)) && Number(id) > 0; }
async function rollback(client, reason) {
  await client.query('ROLLBACK');
  return invalid(reason);
}

/**
 * Reserve exactly one candidate date against exactly one uniquely-linked
 * delivery-order row under the same Postgres transaction. Lock order:
 * customer_subscriptions -> obligation -> delivery order/reservation.
 * This serializes against a webhook updating paidCount / paidThrough.
 */
export async function reservePrototypeOwedMorning(pool, {
  subscriptionId, targetDate, now = new Date()
} = {}) {
  if (!testModeEnabled()) return invalid('prototype_disabled');
  if (!validId(subscriptionId) || typeof targetDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return invalid('invalid_request');
  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const subscriptionRes = await client.query(
      'SELECT * FROM customer_subscriptions WHERE id = $1 FOR UPDATE',
      [subscriptionId]
    );
    const sub = subscriptionRes.rows[0];
    if (!sub) return await rollback(client, 'subscription_not_found');

    const owedRes = await client.query(
      "SELECT *, first_eligible_delivery::text AS first_eligible_delivery "+
      "FROM subscription_recurring_morning_obligations "+
      "WHERE subscription_id = $1 AND status = 'approved' "+
      "ORDER BY first_cycle_start ASC LIMIT 1 FOR UPDATE",
      [subscriptionId]
    );
    const obligation = owedRes.rows[0];
    if (!obligation) return await rollback(client, 'no_approved_obligation');
    const paidThrough = await getEffectivePaidThroughDate(client, sub);
    const notes = sub.notes || {};
    const candidate = assessRecurringMorningRedemption({
      subscription: sub, obligation, targetDate,
      effectivePaidThroughDate: paidThrough, now, validDeliveryAddress: true
    });
    if (!candidate.eligible) return await rollback(client, candidate.reason);

    // Confirm no other full-price entitlement order or prototype exists.
    const existing = await client.query(
      'SELECT id FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2 LIMIT 1',
      [subscriptionId, targetDate]
    );
    if (existing.rows.length) return await rollback(client, 'delivery_order_already_exists');

    const active = await client.query(
      "SELECT COUNT(*)::int AS reserved_count "+
      "FROM subscription_recurring_morning_reservations WHERE obligation_id = $1 AND status = 'reserved'",
      [obligation.id]
    );
    const reserved = Number(active.rows[0]?.reserved_count || 0);
    const available = Number(obligation.owed_mornings) -
      Number(obligation.fulfilled_mornings) -
      Number(obligation.refunded_mornings) - reserved;
    if (!Number.isSafeInteger(available) || available < 1) {
      return await rollback(client, 'no_unreserved_mornings');
    }

    const refunds = await client.query(
      "SELECT id FROM refund_requests WHERE subscription_id = $1 "+
      "AND status IN ('pending','approved','processing','processed') LIMIT 1",
      [subscriptionId]
    );
    if (refunds.rows.length) return await rollback(client, 'refund_reconciliation_required');
    const skipped = await client.query(
      'SELECT id FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2 LIMIT 1',
      [subscriptionId, targetDate]
    );
    if (skipped.rows.length) return await rollback(client, 'date_skipped');
    const paused = await client.query(
      "SELECT id FROM subscription_delivery_pauses WHERE subscription_id = $1 "+
      "AND pause_start_date <= $2 AND (pause_end_date IS NULL OR pause_end_date >= $2) "+
      "AND resumed_at IS NULL LIMIT 1",
      [subscriptionId, targetDate]
    );
    if (paused.rows.length) return await rollback(client, 'subscription_paused_for_date');
    const addresses = await client.query(
      'SELECT recipient_name,phone,house,building,street,landmark,city,state,pincode '+
      'FROM customer_addresses WHERE customer_id = $1 AND is_default = TRUE LIMIT 1',
      [sub.customer_id]
    );
    const address = extractValidDeliveryAddress(sub, addresses.rows[0], null);
    if (!address) return await rollback(client, 'delivery_address_not_verified');

    const ref = crypto.randomBytes(6).toString('hex').toUpperCase();
    const number = 'MV-OWED-TEST-' + targetDate.replaceAll('-', '') + '-' + sub.id + '-' + ref;
    const order = await client.query(
      "INSERT INTO subscription_delivery_orders "+
      "(delivery_order_number,subscription_id,customer_id,delivery_date,product_id,"+
      "product_name,quantity,quantity_num,status,delivery_address,fulfillment_source) "+
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9::jsonb,'owed_morning_prototype') "+
      "ON CONFLICT (subscription_id,delivery_date) DO NOTHING RETURNING id",
      [number,sub.id,sub.customer_id,targetDate,sub.product_id || null,
       sub.product_name,sub.quantity,sub.quantity_num || 1,JSON.stringify(address)]
    );
    if (order.rowCount !== 1) return await rollback(client, 'delivery_order_race');

    const row = await client.query(
      "INSERT INTO subscription_recurring_morning_reservations "+
      "(obligation_id,subscription_id,customer_id,delivery_order_id,delivery_date) "+
      "VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [obligation.id,sub.id,sub.customer_id,order.rows[0].id,targetDate]
    );
    await client.query('COMMIT');
    return {
      success: true, reservationId: row.rows[0].id, deliveryOrderId: order.rows[0].id,
      status: 'reserved', dispatchAuthorized: false,
      reason: 'test_only_prototype_not_connected_to_live_fulfillment'
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { release(); }
}

/**
 * TEST-ONLY status progression for linked prototype orders. Requires actual
 * delivery state-machine progression and revalidates paidCount/paidThrough
 * before any physical-state transition. Never calls production status API.
 *
 * Locks same order as reservation: subscription -> obligation -> order,
 * avoiding lock-order inversion with payment-webhook subscription updates.
 */
export async function transitionPrototypeOwedMorning(pool, {
  deliveryOrderId, status, actor = 'disposable_test', now = new Date()
} = {}) {
  if (!testModeEnabled()) return invalid('prototype_disabled');
  if (!validId(deliveryOrderId) ||
      !['packed','out_for_delivery','delivered','failed','cancelled'].includes(status)) {
    return invalid('invalid_request');
  }
  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const id = await client.query(
      'SELECT subscription_id FROM subscription_delivery_orders '+
      "WHERE id = $1 AND fulfillment_source = 'owed_morning_prototype'",
      [deliveryOrderId]
    );
    if (!id.rows.length) return await rollback(client, 'prototype_order_not_found');
    const subRes = await client.query(
      'SELECT * FROM customer_subscriptions WHERE id = $1 FOR UPDATE',
      [id.rows[0].subscription_id]
    );
    const sub = subRes.rows[0];
    if (!sub) return await rollback(client, 'subscription_not_found');
    const obRes = await client.query(
      "SELECT o.*, r.id AS reservation_id, r.status AS reservation_status, "+
      "r.delivery_date::text AS reserved_date FROM subscription_recurring_morning_reservations r "+
      "JOIN subscription_recurring_morning_obligations o ON o.id = r.obligation_id "+
      "WHERE r.delivery_order_id = $1 FOR UPDATE OF o, r",
      [deliveryOrderId]
    );
    const ob = obRes.rows[0];
    if (!ob) return await rollback(client, 'reservation_not_found');
    const orderRes = await client.query(
      'SELECT * FROM subscription_delivery_orders WHERE id = $1 FOR UPDATE',
      [deliveryOrderId]
    );
    const order = orderRes.rows[0];
    if (!order || order.fulfillment_source !== 'owed_morning_prototype' ||
        order.subscription_id !== sub.id || ob.subscription_id !== sub.id) {
      return await rollback(client, 'order_obligation_mismatch');
    }
    if (ob.reservation_status !== 'reserved' ||
        ob.status !== 'approved') return await rollback(client, 'reservation_not_active');
    if (!(VALID_STATUS_TRANSITIONS[order.status] || []).includes(status)) {
      return await rollback(client, 'invalid_status_transition');
    }
    const cancellation = status === 'failed' || status === 'cancelled';
    if (!cancellation) {
      const notes = sub.notes || {};
      if (sub.status !== 'active' ||
          notes.keyMode !== 'live' || notes.fulfillmentEntitled !== true ||
          Number(notes.paidCount) !== 1 || Number(notes.months) !== 1 ||
          (notes.lastPaymentId || notes.paymentId) !== ob.payment_id ||
          sub.razorpay_subscription_id !== ob.razorpay_subscription_id ||
          Number(sub.cost_per_day_paise) !== Number(ob.daily_rate_paise)) {
        return await rollback(client, 'renewal_or_payment_changed');
      }
      const paidThrough = await getEffectivePaidThroughDate(client, sub);
      if (!paidThrough || asYMD(order.delivery_date) <= paidThrough) {
        return await rollback(client, 'now_covered_by_existing_payment');
      }
      const refunds = await client.query(
        "SELECT id FROM refund_requests WHERE subscription_id=$1 "+
        "AND status IN ('pending','approved','processing','processed') LIMIT 1",
        [sub.id]
      );
      if (refunds.rows.length) return await rollback(client, 'refund_reconciliation_required');
      if (status === 'packed' || status === 'out_for_delivery') {
        const activePause = await client.query(
          "SELECT id FROM subscription_delivery_pauses WHERE subscription_id=$1 "+
          "AND pause_start_date <= $2 AND (pause_end_date IS NULL OR pause_end_date >= $2) "+
          "AND resumed_at IS NULL LIMIT 1",
          [sub.id,asYMD(order.delivery_date)]
        );
        if (activePause.rows.length) return await rollback(client, 'subscription_paused_for_date');
        const skip = await client.query(
          'SELECT id FROM subscription_skipped_dates WHERE subscription_id=$1 AND skip_date=$2 LIMIT 1',
          [sub.id,asYMD(order.delivery_date)]
        );
        if (skip.rows.length) return await rollback(client, 'date_skipped');
      }
    }

    const changes = await client.query(
      "UPDATE subscription_delivery_orders SET status=$2, "+
      "dispatched_at=CASE WHEN $2='out_for_delivery' THEN NOW() ELSE dispatched_at END, "+
      "delivered_at=CASE WHEN $2='delivered' THEN NOW() ELSE delivered_at END, "+
      "failed_reason=CASE WHEN $2='failed' THEN 'Prototype delivery failed' ELSE failed_reason END, "+
      "updated_at=NOW() WHERE id=$1 AND status=$3 RETURNING id",
      [deliveryOrderId,status,order.status]
    );
    if (changes.rowCount !== 1) throw Error('prototype_delivery_transition_race');

    if (status === 'delivered') {
      const settled = await client.query(
        "UPDATE subscription_recurring_morning_obligations "+
        "SET fulfilled_mornings=fulfilled_mornings+1,updated_at=NOW() "+
        "WHERE id=$1 AND status='approved' "+
        "AND fulfilled_mornings + refunded_mornings < owed_mornings RETURNING id",
        [ob.id]
      );
      if (settled.rowCount !== 1) throw Error('owed_morning_balance_violation');
      await client.query(
        "UPDATE subscription_recurring_morning_reservations "+
        "SET status='fulfilled',updated_at=NOW() WHERE id=$1 AND status='reserved'",
        [ob.reservation_id]
      );
      await client.query(
        "INSERT INTO subscription_recurring_morning_obligation_events "+
        "(obligation_id,event_key,event_type,days_delta,notes,evidence) "+
        "VALUES ($1,$2,'fulfilled',-1,$3,$4::jsonb)",
        [ob.id,'prototype_fulfilled:'+ob.reservation_id,
         'Disposal-only prototype transition; not a live delivery',
         JSON.stringify({deliveryOrderId,actor,source:'test_only_reservation'})]
      );
    } else if (cancellation) {
      await client.query(
        "UPDATE subscription_recurring_morning_reservations "+
        "SET status='released',release_reason=$2,updated_at=NOW() "+
        "WHERE id=$1 AND status='reserved'",
        [ob.reservation_id,'prototype_'+status]
      );
      await client.query(
        "INSERT INTO subscription_recurring_morning_obligation_events "+
        "(obligation_id,event_key,event_type,days_delta,notes,evidence) "+
        "VALUES ($1,$2,'adjusted',0,$3,$4::jsonb)",
        [ob.id,'prototype_released:'+ob.reservation_id,
         'Released unpaid physical morning prototype reservation',
         JSON.stringify({deliveryOrderId,actor,releaseReason:status})]
      );
    }
    await client.query('COMMIT');
    return {success:true,deliveryOrderId,status,
      reservationStatus: status === 'delivered' ? 'fulfilled' :
        cancellation ? 'released' : 'reserved',
      dispatchAuthorized:false};
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { release(); }
}

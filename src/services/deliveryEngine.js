/**
 * Milvanta Automated Daily Delivery Engine
 * Generates daily milk delivery orders in Asia/Kolkata timezone with strict cutoff,
 * duplicate prevention, pause/vacation exclusion, driver dispatch lists, and status transitions.
 */

import crypto from 'node:crypto';
import {
  getNowInIST,
  formatDateYMD,
  DAILY_DELIVERY_CUTOFF_HOUR_IST,
  acquireClient,
  derivePaidThroughDate,
  getEffectivePaidThroughDate
} from './subscriptionService.js';
import { queueNotification } from './twilioService.js';

// Valid delivery lifecycle status transitions
export const VALID_STATUS_TRANSITIONS = {
  scheduled: ['packed', 'cancelled'],
  packed: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'failed'],
  delivered: [],
  failed: ['scheduled'], // Can be rescheduled by ops
  cancelled: []
};

/**
 * Determine target delivery date (Default: tomorrow morning in IST)
 */
export function getTomorrowDeliveryDateYMD() {
  const istNow = getNowInIST();
  const tomorrow = new Date(istNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateYMD(tomorrow);
}

/**
 * GENERATE DAILY DELIVERY ORDERS
 * Idempotent: safe to run multiple times, uses ON CONFLICT DO NOTHING and pre-checks
 */
export async function generateDailyDeliveries(pool, targetDateYMD = null) {
  if (!pool) throw new Error('Database pool required');
  const targetDate = targetDateYMD || getTomorrowDeliveryDateYMD();

  const { client, release } = await acquireClient(pool);
  let generatedCount = 0;
  let skippedCount = 0;

  try {
    await client.query('BEGIN');

    // 1. Fetch all currently active subscriptions with payment & schedule attributes
    const { rows: activeSubs } = await client.query(
      `SELECT cs.id, cs.customer_id, cs.product_id, cs.product_name, cs.quantity, cs.quantity_num,
              cs.cost_per_day_paise, cs.total_amount_paise, cs.notes, cs.next_delivery, cs.created_at,
              c.full_name, c.phone, c.email
       FROM customer_subscriptions cs
       JOIN customers c ON c.id = cs.customer_id
       WHERE cs.status = 'active'
       ORDER BY cs.id ASC`
    );

    for (const sub of activeSubs) {
      const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};

      // 1a. Require verified payment evidence (fail closed if active row lacks payment proof)
      const hasPaymentEvidence = Boolean(
        (subNotes.lastPaymentId || subNotes.paymentId) &&
        subNotes.fulfillmentEntitled !== false &&
        subNotes.authType !== 'mandate_only'
      );
      if (!hasPaymentEvidence) {
        skippedCount++;
        continue;
      }

      // 1b. Enforce valid subscription start date
      const subStartDate = subNotes.startDate || subNotes.start_date ||
        (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
          ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
          : null) ||
        (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null);

      if (!subStartDate || targetDate < subStartDate) {
        skippedCount++;
        continue;
      }

      // 1c. Derive and enforce authenticated paid-through end date
      const paidThroughEndDate = await getEffectivePaidThroughDate(client, sub);

      // Fail closed if paid-through entitlement cannot be established
      if (!paidThroughEndDate) {
        skippedCount++;
        continue;
      }

      // Do not generate deliveries outside the paid entitlement
      if (targetDate > paidThroughEndDate) {
        skippedCount++;
        continue;
      }

      // 2. Check if skipped for target date
      const { rows: skipped } = await client.query(
        'SELECT id FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
        [sub.id, targetDate]
      );
      if (skipped.length > 0) {
        skippedCount++;
        continue;
      }

      // 3. Check if in vacation or pause
      const { rows: paused } = await client.query(
        `SELECT id FROM subscription_delivery_pauses 
         WHERE subscription_id = $1 
           AND pause_start_date <= $2 
           AND (pause_end_date IS NULL OR pause_end_date >= $2)
           AND resumed_at IS NULL`,
        [sub.id, targetDate]
      );
      if (paused.length > 0) {
        skippedCount++;
        continue;
      }

      // 4. Fetch customer default delivery address
      const { rows: addrRows } = await client.query(
        `SELECT recipient_name, phone, house, building, street, landmark, city, state, pincode
         FROM customer_addresses
         WHERE customer_id = $1 AND is_default = TRUE
         LIMIT 1`,
        [sub.customer_id]
      );

      let deliveryAddress;
      if (addrRows.length > 0) {
        deliveryAddress = addrRows[0];
      } else {
        // Fallback to customer's latest order address if available
        const { rows: orderAddr } = await client.query(
          `SELECT address FROM customer_orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [sub.customer_id]
        );
        deliveryAddress = orderAddr[0]?.address || {
          recipient_name: sub.full_name,
          phone: sub.phone,
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500049'
        };
      }

      // 5. Generate unique delivery order number: MV-DEL-YYYYMMDD-XXXXXX
      const randHex = crypto.randomBytes(3).toString('hex').toUpperCase();
      const cleanDateTag = targetDate.replaceAll('-', '');
      const deliveryOrderNumber = `MV-DEL-${cleanDateTag}-${String(sub.id).padStart(4, '0')}-${randHex}`;

      // 6. Insert with duplicate prevention via UNIQUE(subscription_id, delivery_date)
      const insertRes = await client.query(
        `INSERT INTO subscription_delivery_orders (
           delivery_order_number, subscription_id, customer_id, delivery_date,
           product_id, product_name, quantity, quantity_num, status, delivery_address
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9::jsonb)
         ON CONFLICT (subscription_id, delivery_date) DO NOTHING
         RETURNING id`,
        [
          deliveryOrderNumber,
          sub.id,
          sub.customer_id,
          targetDate,
          sub.product_id,
          sub.product_name,
          sub.quantity,
          sub.quantity_num || 1,
          JSON.stringify(deliveryAddress)
        ]
      );

      if (insertRes.rowCount > 0) {
        generatedCount++;

        // Queue next-day reminder notification for 9:00 PM IST (if customer has phone)
        if (sub.phone) {
          const idempotencyKey = `sms_reminder_${sub.id}_${targetDate}`;
          queueNotification(client, {
            customerId: sub.customer_id,
            phone: sub.phone,
            templateKey: 'NEXT_DAY_REMINDER',
            params: {
              productName: sub.product_name,
              quantity: sub.quantity
            },
            idempotencyKey
          }).catch(() => {});
        }
      } else {
        skippedCount++; // Already exists
      }
    }

    await client.query('COMMIT');

    return {
      success: true,
      targetDate,
      generatedCount,
      skippedCount,
      totalActiveSubscriptions: activeSubs.length
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * Get daily delivery orders for operations dispatch
 */
export async function getDailyDeliveries(pool, dateOrOptions = null) {
  let targetDate;
  let status = null;
  let limit = 100;
  let offset = 0;

  if (dateOrOptions && typeof dateOrOptions === 'object') {
    targetDate = dateOrOptions.date || getTomorrowDeliveryDateYMD();
    status = dateOrOptions.status || null;
    limit = dateOrOptions.limit || 100;
    offset = dateOrOptions.offset || 0;
  } else if (typeof dateOrOptions === 'string') {
    targetDate = dateOrOptions;
  } else {
    targetDate = getTomorrowDeliveryDateYMD();
  }

  let query = `
    SELECT sdo.*, c.full_name AS customer_name, c.phone AS customer_phone
    FROM subscription_delivery_orders sdo
    JOIN customers c ON c.id = sdo.customer_id
    WHERE sdo.delivery_date = $1
  `;
  const params = [targetDate];

  if (status) {
    params.push(status);
    query += ` AND sdo.status = $${params.length}`;
  }

  query += ` ORDER BY sdo.id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const { rows } = await pool.query(query, params);

    // Group counts by status
    const { rows: countRows } = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM subscription_delivery_orders
       WHERE delivery_date = $1
       GROUP BY status`,
      [targetDate]
    );
    const statusCounts = Object.fromEntries(countRows.map(r => [r.status, Number(r.count)]));

    return {
      deliveryDate: targetDate,
      deliveries: rows,
      counts: statusCounts,
      total: rows.length
    };
  } catch (err) {
    if (err.code === '42P01') {
      return {
        deliveryDate: targetDate,
        deliveries: [],
        counts: {},
        total: 0,
        tablePending: true
      };
    }
    throw err;
  }
}

/**
 * UPDATE DELIVERY STATUS (scheduled -> packed -> out_for_delivery -> delivered / failed)
 * Strict state machine: never marks delivered simply because time passed
 */
export async function updateDeliveryStatus(pool, orderIdOrParams, maybeStatus, options = {}) {
  let deliveryOrderId;
  let status;
  let actor = 'driver';
  let notes = null;
  let reason = null;

  if (orderIdOrParams && typeof orderIdOrParams === 'object') {
    deliveryOrderId = orderIdOrParams.deliveryOrderId;
    status = orderIdOrParams.status;
    actor = orderIdOrParams.actor || 'driver';
    notes = orderIdOrParams.notes || orderIdOrParams.driverNotes || null;
    reason = orderIdOrParams.reason || orderIdOrParams.failedReason || null;
  } else {
    deliveryOrderId = orderIdOrParams;
    status = maybeStatus;
    actor = options.actor || 'driver';
    notes = options.notes || options.driverNotes || null;
    reason = options.reason || options.failedReason || null;
  }

  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT sdo.*, c.phone, c.full_name
       FROM subscription_delivery_orders sdo
       JOIN customers c ON c.id = sdo.customer_id
       WHERE sdo.id = $1
       FOR UPDATE`,
      [deliveryOrderId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'delivery_order_not_found', statusCode: 404 };
    }

    const order = rows[0];
    const allowed = VALID_STATUS_TRANSITIONS[order.status] || [];

    if (!allowed.includes(status)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'invalid_status_transition',
        message: `Cannot transition from '${order.status}' to '${status}'. Allowed: ${allowed.join(', ') || 'none'}`,
        statusCode: 400
      };
    }

    let dispatchedAt = order.dispatched_at;
    let deliveredAt = order.delivered_at;
    let failedReason = order.failed_reason;

    if (status === 'out_for_delivery') {
      dispatchedAt = new Date();
    } else if (status === 'delivered') {
      deliveredAt = new Date();
    } else if (status === 'failed') {
      failedReason = reason || 'Delivery failed / customer unreachable';
    }

    await client.query(
      `UPDATE subscription_delivery_orders 
       SET status = $2, dispatched_at = $3, delivered_at = $4, failed_reason = $5, driver_notes = COALESCE($6, driver_notes), updated_at = NOW()
       WHERE id = $1`,
      [deliveryOrderId, status, dispatchedAt, deliveredAt, failedReason, notes]
    );

    // Record audit event
    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        order.subscription_id,
        order.customer_id,
        `delivery_${status}`,
        actor,
        JSON.stringify({ deliveryOrderId, previousStatus: order.status, newStatus: status, notes, reason })
      ]
    );

    if (status === 'delivered' && order.subscription_id) {
      await client.query(
        `INSERT INTO subscription_entitlement_ledger (
          subscription_id, customer_id, entry_type, days_delta, amount_paise, delivery_date, notes
        ) VALUES ($1, $2, 'delivery_fulfilled', -1, $3, $4, $5)`,
        [order.subscription_id, order.customer_id, order.cost_paise || 0, order.delivery_date, `Delivery fulfilled: ${order.delivery_order_number}`]
      );
    }

    await client.query('COMMIT');

    // Trigger Twilio SMS notifications on key fulfillment transitions
    if (order.phone) {
      if (status === 'out_for_delivery') {
        const idempotencyKey = `sms_ofd_${order.id}_${order.delivery_date}`;
        queueNotification(pool, {
          customerId: order.customer_id,
          phone: order.phone,
          templateKey: 'OUT_FOR_DELIVERY',
          params: {
            productName: order.product_name,
            quantity: order.quantity
          },
          idempotencyKey
        }).catch(() => {});
      } else if (status === 'delivered') {
        const idempotencyKey = `sms_dlv_${order.id}_${order.delivery_date}`;
        const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        queueNotification(pool, {
          customerId: order.customer_id,
          phone: order.phone,
          templateKey: 'DELIVERY_COMPLETED',
          params: {
            productName: order.product_name,
            quantity: order.quantity,
            time: timeStr
          },
          idempotencyKey
        }).catch(() => {});
      } else if (status === 'failed') {
        const idempotencyKey = `sms_fail_${order.id}_${order.delivery_date}`;
        queueNotification(pool, {
          customerId: order.customer_id,
          phone: order.phone,
          templateKey: 'DELIVERY_FAILED',
          params: {
            reason: failedReason
          },
          idempotencyKey
        }).catch(() => {});
      }
    }

    return {
      success: true,
      deliveryOrderId,
      previousStatus: order.status,
      status,
      deliveredAt,
      message: `Delivery #${order.delivery_order_number} marked as ${status}.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}


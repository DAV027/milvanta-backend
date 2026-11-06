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
import { queueNotification } from './notificationService.js';

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
 * Validate delivery target date:
 * - Must be YYYY-MM-DD
 * - Cannot be in the past
 * - Cannot be out-of-policy (> 60 days in future)
 */
export function validateDeliveryTargetDate(targetDateYMD = null, options = {}) {
  const istNow = getNowInIST();
  const todayIST = formatDateYMD(istNow);
  const targetDate = targetDateYMD || getTomorrowDeliveryDateYMD();

  if (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    const err = new Error('invalid_delivery_date_format');
    err.statusCode = 400;
    throw err;
  }

  const [y, m, d] = targetDate.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    const err = new Error('invalid_delivery_date');
    err.statusCode = 400;
    throw err;
  }

  const shouldRejectPast = options.allowPastDates ? false : (options.rejectPastDates !== false);
  if (shouldRejectPast && targetDate < todayIST) {
    const err = new Error('cannot_generate_deliveries_for_past_date');
    err.statusCode = 400;
    throw err;
  }

  const maxFuture = new Date(istNow);
  maxFuture.setDate(maxFuture.getDate() + 60);
  const maxFutureYMD = formatDateYMD(maxFuture);
  if (targetDate > maxFutureYMD) {
    const err = new Error('delivery_date_out_of_policy');
    err.statusCode = 400;
    throw err;
  }

  return targetDate;
}

/**
 * Extract verified delivery address without invented dummy fallbacks.
 * Must have a real street/house address and postal code.
 */
export function extractValidDeliveryAddress(sub, defaultAddrRow, latestOrderAddrRow) {
  let candidate = null;
  const subNotes = typeof sub?.notes === 'object' && sub?.notes !== null ? sub.notes : {};

  // 1. Explicit subscription delivery address has highest priority (prevents silent replacement by default address)
  if (sub?.delivery_address && typeof sub.delivery_address === 'object') {
    candidate = sub.delivery_address;
  } else if (subNotes.deliveryAddress && typeof subNotes.deliveryAddress === 'object') {
    candidate = subNotes.deliveryAddress;
  } else if (subNotes.address && typeof subNotes.address === 'object') {
    candidate = subNotes.address;
  } else if (defaultAddrRow && typeof defaultAddrRow === 'object') {
    // 2. Customer default saved address fallback
    candidate = defaultAddrRow;
  } else if (latestOrderAddrRow?.address) {
    // 3. Historical customer order address snapshot fallback
    const parsed = typeof latestOrderAddrRow.address === 'string'
      ? (() => { try { return JSON.parse(latestOrderAddrRow.address); } catch { return null; } })()
      : latestOrderAddrRow.address;
    if (parsed && typeof parsed === 'object') {
      candidate = parsed;
    }
  }

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const street = (candidate.street || candidate.house || candidate.building || candidate.address || candidate.line1 || '').trim();
  const pincode = (candidate.pincode || candidate.postal_code || '').toString().trim();

  // If there is no real street address or postal code, fail closed: do NOT invent fallback
  if (!street || !pincode) {
    return null;
  }

  return {
    recipient_name: (candidate.recipient_name || sub.full_name || '').trim(),
    phone: (candidate.phone || sub.phone || '').trim(),
    house: (candidate.house || candidate.flat || '').trim(),
    building: (candidate.building || '').trim(),
    street,
    landmark: (candidate.landmark || '').trim(),
    city: (candidate.city || 'Hyderabad').trim(),
    state: (candidate.state || 'Telangana').trim(),
    pincode
  };
}

/**
 * Shared Authoritative Subscription Delivery Eligibility Evaluator
 * Used by BOTH generateDailyDeliveries() and previewDailyDeliveries().
 * 
 * Rules:
 * 1. Require explicit fulfillmentEntitled === true (boolean true only).
 * 2. Require authoritative captured payment evidence:
 *    - Valid payment reference (lastPaymentId or paymentId).
 *    - Not a mandate-only authorization (authType !== 'mandate_only').
 *    - A payment reference or paidCount alone without fulfillmentEntitled === true is rejected.
 * 3. Enforce valid subscription start date (targetDate >= subStartDate).
 * 4. Derive and enforce authenticated effective paid-through coverage date (targetDate <= paidThroughEndDate).
 * 5. Exclude skipped dates.
 * 6. Exclude vacation or pause periods (resumed_at IS NULL).
 * 7. Require real verified delivery address (no fabricated fallbacks anywhere).
 */
export async function evaluateSubscriptionDeliveryEligibility(client, sub, targetDate) {
  const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};

  // 1. Explicit fulfillmentEntitled === true (boolean true only)
  if (subNotes.fulfillmentEntitled !== true) {
    return {
      eligible: false,
      reason: 'noFulfillmentEntitlement',
      exclusionMessage: 'Fulfillment entitlement flag is not set to true',
      paidThroughEndDate: null,
      deliveryAddress: null
    };
  }

  // 2. Authoritative captured payment evidence
  const paymentId = (typeof subNotes.lastPaymentId === 'string' && subNotes.lastPaymentId.trim()) ||
                    (typeof subNotes.paymentId === 'string' && subNotes.paymentId.trim()) ||
                    null;
  const isMandateOnly = subNotes.authType === 'mandate_only';

  if (!paymentId || isMandateOnly) {
    return {
      eligible: false,
      reason: 'noPaymentEvidence',
      exclusionMessage: isMandateOnly
        ? 'Subscription is mandate-only; recurring billing payment has not been captured'
        : 'Missing authoritative captured payment proof',
      paidThroughEndDate: null,
      deliveryAddress: null
    };
  }

  // 3. Enforce valid subscription start date
  const subStartDate = subNotes.startDate || subNotes.start_date ||
    (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
      ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
      : null) ||
    (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null);

  if (!subStartDate || targetDate < subStartDate) {
    return {
      eligible: false,
      reason: 'beforeStartDate',
      exclusionMessage: `Target delivery date ${targetDate} is before subscription start date ${subStartDate || 'unknown'}`,
      paidThroughEndDate: null,
      deliveryAddress: null
    };
  }

  // 4. Derive and enforce authenticated paid-through end date
  const paidThroughEndDate = await getEffectivePaidThroughDate(client, sub);
  if (!paidThroughEndDate) {
    return {
      eligible: false,
      reason: 'noEntitlement',
      exclusionMessage: 'Unable to derive authoritative paid-through coverage date',
      paidThroughEndDate: null,
      deliveryAddress: null
    };
  }

  if (targetDate > paidThroughEndDate) {
    return {
      eligible: false,
      reason: 'beyondEntitlement',
      exclusionMessage: `Target delivery date ${targetDate} is beyond paid entitlement date ${paidThroughEndDate}`,
      paidThroughEndDate,
      deliveryAddress: null
    };
  }

  // 5. Check if skipped for target date
  const { rows: skipped } = await client.query(
    'SELECT id FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
    [sub.id, targetDate]
  );
  if (skipped.length > 0) {
    return {
      eligible: false,
      reason: 'skippedDate',
      exclusionMessage: `Delivery date ${targetDate} was explicitly skipped by customer`,
      paidThroughEndDate,
      deliveryAddress: null
    };
  }

  // 6. Check if in vacation or pause
  const { rows: paused } = await client.query(
    `SELECT id FROM subscription_delivery_pauses 
     WHERE subscription_id = $1 
       AND pause_start_date <= $2 
       AND (pause_end_date IS NULL OR pause_end_date >= $2)
       AND resumed_at IS NULL`,
    [sub.id, targetDate]
  );
  if (paused.length > 0) {
    return {
      eligible: false,
      reason: 'onVacationOrPause',
      exclusionMessage: 'Subscription is in pause or vacation period',
      paidThroughEndDate,
      deliveryAddress: null
    };
  }

  // 7. Fetch customer default delivery address and validate (no invented dummy fallbacks)
  const { rows: addrRows } = await client.query(
    `SELECT recipient_name, phone, house, building, street, landmark, city, state, pincode
     FROM customer_addresses
     WHERE customer_id = $1 AND is_default = TRUE
     LIMIT 1`,
    [sub.customer_id]
  );

  const { rows: orderAddr } = await client.query(
    `SELECT address FROM customer_orders WHERE customer_id = $1 AND address IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [sub.customer_id]
  );

  const deliveryAddress = extractValidDeliveryAddress(sub, addrRows[0], orderAddr[0]);
  if (!deliveryAddress) {
    return {
      eligible: false,
      reason: 'missingOrInvalidAddress',
      exclusionMessage: 'Customer has no verified delivery address with street and pincode',
      paidThroughEndDate,
      deliveryAddress: null
    };
  }

  return {
    eligible: true,
    reason: null,
    exclusionMessage: null,
    paidThroughEndDate,
    deliveryAddress
  };
}

/**
 * GENERATE DAILY DELIVERY ORDERS
 * Idempotent: safe to run multiple times, uses ON CONFLICT DO NOTHING and pre-checks.
 * Evaluates each subscription with shared evaluateSubscriptionDeliveryEligibility().
 */
export async function generateDailyDeliveries(pool, targetDateYMD = null, options = {}) {
  if (!pool) throw new Error('Database pool required');
  const targetDate = validateDeliveryTargetDate(targetDateYMD, {
    allowPastDates: process.env.NODE_ENV === 'test' && !options.rejectPastDates,
    ...options
  });
  // Production physical order generation MUST require explicit live gateway
  // evidence. No caller (including manual admin and standalone scripts) may
  // bypass this with liveGatewayOnly:false. Legacy test fixtures can opt into
  // their isolated test-only behavior; actual admin/cron routes pass true.
  const enforceLiveGatewayOnly =
    process.env.NODE_ENV !== 'test' || options.liveGatewayOnly === true;

  const { client, release } = await acquireClient(pool);
  let generatedCount = 0;
  let skippedCount = 0;

  try {
    await client.query('BEGIN');

    // Fetch all currently active subscriptions
    const { rows: activeSubs } = await client.query(
      `SELECT cs.id, cs.customer_id, cs.product_id, cs.product_name, cs.quantity, cs.quantity_num,
              cs.cost_per_day_paise, cs.total_amount_paise, cs.plan_type, cs.razorpay_subscription_id, cs.notes, cs.next_delivery, cs.created_at,
              c.full_name, c.phone, c.email
       FROM customer_subscriptions cs
       JOIN customers c ON c.id = cs.customer_id
       WHERE cs.status = 'active'
       ORDER BY cs.id ASC`
    );

    for (const sub of activeSubs) {
      // All production generation paths reject Test Mode and missing/legacy
      // gateway modes, including manual admin and standalone scheduled scripts.
      if (enforceLiveGatewayOnly) {
        const notes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
        if (notes.keyMode !== 'live') {
          skippedCount++;
          continue;
        }
      }
      const evalRes = await evaluateSubscriptionDeliveryEligibility(client, sub, targetDate);
      if (!evalRes.eligible) {
        skippedCount++;
        continue;
      }
      const { deliveryAddress } = evalRes;

      // Generate unique delivery order number: MV-DEL-YYYYMMDD-XXXXXX
      const randHex = crypto.randomBytes(3).toString('hex').toUpperCase();
      const cleanDateTag = targetDate.replaceAll('-', '');
      const deliveryOrderNumber = `MV-DEL-${cleanDateTag}-${String(sub.id).padStart(4, '0')}-${randHex}`;

      // Insert with duplicate prevention via UNIQUE(subscription_id, delivery_date)
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

        // Only queue next-day reminder if customer phone exists AND WhatsApp messaging is enabled (freeze safeguard)
        if (sub.phone && process.env.WHATSAPP_ENABLED === 'true') {
          const idempotencyKey = `sms_reminder_${sub.id}_${targetDate}`;
          await queueNotification(client, {
            customerId: sub.customer_id,
            phone: sub.phone,
            templateKey: 'NEXT_DAY_REMINDER',
            params: {
              productName: sub.product_name,
              quantity: sub.quantity
            },
            idempotencyKey,
            deliveryOrderId: insertRes.rows[0].id,
            scheduledAt: reminderScheduledAt(targetDate)
          });
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
 * PREVIEW DAILY DELIVERY ORDERS (DRY RUN)
 * Strictly read-only: does not insert any records.
 * Uses shared evaluateSubscriptionDeliveryEligibility() for 100% parity with generation.
 */
export async function previewDailyDeliveries(pool, targetDateYMD = null, options = {}) {
  if (!pool) throw new Error('Database pool required');
  const targetDate = validateDeliveryTargetDate(targetDateYMD);
  // Keep operator preview consistent with the production generation filter.
  const enforceLiveGatewayOnly =
    process.env.NODE_ENV !== 'test' || options.liveGatewayOnly === true;

  const { client, release } = await acquireClient(pool);
  try {
    const { rows: activeSubs } = await client.query(
      `SELECT cs.id, cs.customer_id, cs.product_id, cs.product_name, cs.quantity, cs.quantity_num,
              cs.cost_per_day_paise, cs.total_amount_paise, cs.plan_type, cs.razorpay_subscription_id, cs.notes, cs.next_delivery, cs.created_at,
              c.full_name, c.phone, c.email
       FROM customer_subscriptions cs
       JOIN customers c ON c.id = cs.customer_id
       WHERE cs.status = 'active'
       ORDER BY cs.id ASC`
    );

    let eligibleCount = 0;
    let alreadyGeneratedCount = 0;
    let toGenerateCount = 0;
    const skippedBreakdown = {
      noFulfillmentEntitlement: 0,
      noPaymentEvidence: 0,
      beforeStartDate: 0,
      noEntitlement: 0,
      beyondEntitlement: 0,
      skippedDate: 0,
      onVacationOrPause: 0,
      missingOrInvalidAddress: 0,
      gatewayModeNotLive: 0
    };
    const eligibleList = [];
    const excludedList = [];

    for (const sub of activeSubs) {
      if (enforceLiveGatewayOnly) {
        const notes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
        if (notes.keyMode !== 'live') {
          skippedBreakdown.gatewayModeNotLive++;
          excludedList.push({
            subscriptionId: sub.id,
            customerId: sub.customer_id,
            customerName: sub.full_name,
            productName: sub.product_name,
            reason: 'gatewayModeNotLive',
            exclusionMessage: 'Explicit live Razorpay gateway evidence is required before delivery order generation'
          });
          continue;
        }
      }
      const evalRes = await evaluateSubscriptionDeliveryEligibility(client, sub, targetDate);
      if (!evalRes.eligible) {
        if (skippedBreakdown[evalRes.reason] !== undefined) {
          skippedBreakdown[evalRes.reason]++;
        }
        excludedList.push({
          subscriptionId: sub.id,
          customerId: sub.customer_id,
          customerName: sub.full_name,
          productName: sub.product_name,
          reason: evalRes.reason,
          exclusionMessage: evalRes.exclusionMessage
        });
        continue;
      }

      const { deliveryAddress, paidThroughEndDate } = evalRes;
      eligibleCount++;

      // Check if already generated
      const { rows: existing } = await client.query(
        'SELECT id, delivery_order_number, status FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2',
        [sub.id, targetDate]
      );

      const isAlreadyGenerated = existing.length > 0;
      if (isAlreadyGenerated) {
        alreadyGeneratedCount++;
      } else {
        toGenerateCount++;
      }

      eligibleList.push({
        subscriptionId: sub.id,
        customerId: sub.customer_id,
        customerName: sub.full_name,
        customerPhone: sub.phone,
        productName: sub.product_name,
        quantity: sub.quantity,
        quantityNum: Number(sub.quantity_num) || 1,
        paidThroughDate: paidThroughEndDate,
        address: deliveryAddress.street,
        alreadyGenerated: isAlreadyGenerated,
        existingDeliveryOrderNumber: existing[0]?.delivery_order_number || null,
        existingStatus: existing[0]?.status || null
      });
    }

    return {
      success: true,
      targetDate,
      totalActiveSubscriptions: activeSubs.length,
      eligibleCount,
      alreadyGeneratedCount,
      toGenerateCount,
      skippedBreakdown,
      eligibleSubscriptions: eligibleList,
      excludedSubscriptions: excludedList
    };
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
  let search = null;
  let limit = 100;
  let offset = 0;

  if (dateOrOptions && typeof dateOrOptions === 'object') {
    targetDate = dateOrOptions.date || getTomorrowDeliveryDateYMD();
    status = dateOrOptions.status || null;
    search = dateOrOptions.search || null;
    limit = dateOrOptions.limit || 100;
    offset = dateOrOptions.offset || 0;
  } else if (typeof dateOrOptions === 'string') {
    targetDate = dateOrOptions;
  } else {
    targetDate = getTomorrowDeliveryDateYMD();
  }

  let baseQuery = `
    FROM subscription_delivery_orders sdo
    JOIN customers c ON c.id = sdo.customer_id
    WHERE sdo.delivery_date = $1
  `;
  const params = [targetDate];

  if (status && status !== 'all') {
    params.push(status);
    baseQuery += ` AND sdo.status = $${params.length}`;
  }

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    baseQuery += ` AND (
      LOWER(sdo.delivery_order_number) LIKE $${params.length} OR
      LOWER(sdo.product_name) LIKE $${params.length} OR
      LOWER(c.full_name) LIKE $${params.length} OR
      LOWER(COALESCE(c.phone, '')) LIKE $${params.length} OR
      LOWER(COALESCE(sdo.delivery_address->>'phone', '')) LIKE $${params.length} OR
      LOWER(COALESCE(sdo.delivery_address->>'recipient_name', '')) LIKE $${params.length} OR
      LOWER(COALESCE(sdo.delivery_address->>'street', '')) LIKE $${params.length} OR
      LOWER(COALESCE(sdo.delivery_address->>'city', '')) LIKE $${params.length}
    )`;
  }

  const query = `
    SELECT sdo.*, c.full_name AS customer_name, c.phone AS customer_phone
    ${baseQuery}
    ORDER BY sdo.id ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const queryParams = [...params, limit, offset];

  try {
    const { rows } = await pool.query(query, queryParams);

    // Group counts by status (for target date)
    const { rows: countRows } = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM subscription_delivery_orders
       WHERE delivery_date = $1
       GROUP BY status`,
      [targetDate]
    );
    const statusCounts = Object.fromEntries(countRows.map(r => [r.status, Number(r.count)]));

    // Total count for current query filter
    const countRes = await pool.query(`SELECT COUNT(*) AS total ${baseQuery}`, params);
    const totalMatching = Number(countRes.rows[0]?.total || 0);

    return {
      deliveryDate: targetDate,
      deliveries: rows,
      counts: statusCounts,
      total: totalMatching
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
    reason = orderIdOrParams.reason || orderIdOrParams.failureReason || orderIdOrParams.failedReason || null;
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
    let deliveredBy = order.delivered_by;
    let failedBy = order.failed_by;
    const proofOfDelivery = (orderIdOrParams && typeof orderIdOrParams === 'object' ? orderIdOrParams.proofOfDelivery : options.proofOfDelivery) || null;

    if (status === 'out_for_delivery') {
      dispatchedAt = new Date();
    } else if (status === 'delivered') {
      deliveredAt = new Date();
      deliveredBy = actor;
    } else if (status === 'failed') {
      failedReason = reason || 'Delivery failed / customer unreachable';
      failedBy = actor;
    }

    await client.query(
      `UPDATE subscription_delivery_orders 
       SET status = $2, dispatched_at = $3, delivered_at = $4, failed_reason = $5,
           driver_notes = COALESCE($6, driver_notes), delivered_by = COALESCE($7, delivered_by),
           failed_by = COALESCE($8, failed_by), proof_of_delivery = COALESCE($9, proof_of_delivery),
           updated_at = NOW()
       WHERE id = $1`,
      [deliveryOrderId, status, dispatchedAt, deliveredAt, failedReason, notes, deliveredBy, failedBy, proofOfDelivery]
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
        JSON.stringify({ deliveryOrderId, previousStatus: order.status, newStatus: status, notes, reason, proofOfDelivery })
      ]
    );

    if (status === 'delivered' && order.subscription_id) {
      const { rows: existingLedger } = await client.query(
        `SELECT id FROM subscription_entitlement_ledger 
         WHERE subscription_id = $1 AND delivery_date = $2 AND entry_type = 'delivery_fulfilled'`,
        [order.subscription_id, order.delivery_date]
      );
      if (existingLedger.length === 0) {
        await client.query(
          `INSERT INTO subscription_entitlement_ledger (
            subscription_id, customer_id, entry_type, days_delta, amount_paise, delivery_date, notes
          ) VALUES ($1, $2, 'delivery_fulfilled', -1, $3, $4, $5)`,
          [order.subscription_id, order.customer_id, order.cost_paise || 0, order.delivery_date, `Delivery fulfilled: ${order.delivery_order_number}`]
        );
      }
    }

    // Queue fulfillment notifications atomically with the transition
    if (order.phone) {
      if (status === 'out_for_delivery') {
        const idempotencyKey = `sms_ofd_${order.id}_${order.delivery_date}`;
        await queueNotification(client, {
          customerId: order.customer_id,
          phone: order.phone,
          templateKey: 'OUT_FOR_DELIVERY',
          deliveryOrderId: order.id,
          params: {
            productName: order.product_name,
            quantity: order.quantity
          },
          idempotencyKey
        });
      } else if (status === 'delivered') {
        const idempotencyKey = `sms_dlv_${order.id}_${order.delivery_date}`;
        const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
        await queueNotification(client, {
          customerId: order.customer_id,
          phone: order.phone,
          templateKey: 'DELIVERY_COMPLETED',
          deliveryOrderId: order.id,
          params: {
            productName: order.product_name,
            quantity: order.quantity,
            time: timeStr
          },
          idempotencyKey
        });
      } else if (status === 'failed') {
        const idempotencyKey = `sms_fail_${order.id}_${order.delivery_date}`;
        await queueNotification(client, {
          customerId: order.customer_id,
          phone: order.phone,
          templateKey: 'DELIVERY_FAILED',
          deliveryOrderId: order.id,
          params: {
            reason: failedReason
          },
          idempotencyKey
        });
      }
    }

    await client.query('COMMIT');
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


export function reminderScheduledAt(targetDate) {
  const time=process.env.DELIVERY_REMINDER_TIME_IST || '21:00';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('invalid_delivery_reminder_time');
  const previous=new Date(`${targetDate}T00:00:00+05:30`);
  previous.setUTCDate(previous.getUTCDate()-1);
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(previous);
  return new Date(`${day}T${time}:00+05:30`);
}

/**
 * Milvanta Subscription Domain Service
 * Server-authoritative PostgreSQL lifecycle, calendar, cutoff enforcement, and billing adjustments
 */

import {
  APPROVED_MILK_PACK_SIZES,
  getMilkDailySubscriptionRatePaise,
  parseLitresFromSize
} from '../pricing.js';
import { queueNotification } from './twilioService.js';

// Cutoff time in IST (20:00 / 8:00 PM)
export const DAILY_DELIVERY_CUTOFF_HOUR_IST = 20;

/**
 * Universal pool/client connector
 * Allows running with either a pg.Pool or a dedicated pg.Client
 */
export async function acquireClient(poolOrClient) {
  if (poolOrClient && typeof poolOrClient.connect === 'function' && typeof poolOrClient.release !== 'function') {
    const client = await poolOrClient.connect();
    return { client, release: () => client.release() };
  }
  return { client: poolOrClient, release: () => {} };
}

/**
 * Returns current Date object in Asia/Kolkata timezone
 */
export function getNowInIST() {
  const now = new Date();
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcMs + istOffsetMs);
}

/**
 * Format Date as YYYY-MM-DD
 */
export function formatDateYMD(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Authoritative Paid-Through Date Derivation
 * Derives end date from explicit note, gateway current_end, or trusted schedule & verified payment.
 * Returns YYYY-MM-DD or null if entitlement cannot be authoritatively established.
 */
export function derivePaidThroughDate({
  startDate = null,
  paidThroughDate = null,
  current_end = null,
  cost_per_day_paise = null,
  total_amount_paise = null,
  paidCount = 1,
  months = null
} = {}) {
  // 1. Explicit valid YYYY-MM-DD string
  if (typeof paidThroughDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paidThroughDate.trim())) {
    return paidThroughDate.trim();
  }

  // 2. Gateway current_end epoch timestamp
  if (current_end && Number.isFinite(Number(current_end)) && Number(current_end) > 0) {
    try {
      const d = new Date(Number(current_end) * 1000);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch {}
  }

  // 3. Derive from verified payment and trusted subscription schedule
  if (!startDate || typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) {
    return null;
  }

  const effectivePaidCount = Math.max(1, Number(paidCount) || 1);
  const costPerDay = Number(cost_per_day_paise) || 0;
  const totalPaise = Number(total_amount_paise) || 0;

  if (costPerDay > 0 && totalPaise > 0) {
    const daysPerCycle = Math.floor(totalPaise / costPerDay);
    const totalPaidDays = daysPerCycle * effectivePaidCount;
    if (totalPaidDays > 0) {
      const startD = new Date(`${startDate.trim()}T00:00:00Z`);
      if (!Number.isNaN(startD.getTime())) {
        const endD = new Date(startD);
        endD.setUTCDate(endD.getUTCDate() + totalPaidDays - 1);
        return endD.toISOString().slice(0, 10);
      }
    }
  }

  const numMonths = Number(months);
  if (Number.isFinite(numMonths) && numMonths > 0) {
    const totalMonths = numMonths * effectivePaidCount;
    const startD = new Date(`${startDate.trim()}T00:00:00Z`);
    if (!Number.isNaN(startD.getTime())) {
      const endD = new Date(startD);
      endD.setUTCMonth(endD.getUTCMonth() + totalMonths);
      endD.setUTCDate(endD.getUTCDate() - 1);
      return endD.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Check if the 8:00 PM cutoff has passed for a target delivery date
 */
export function isDeliveryCutoffPassed(targetDateStr) {
  const istNow = getNowInIST();
  const todayYMD = formatDateYMD(istNow);

  // If target date is today or in the past, cutoff has definitely passed
  if (targetDateStr <= todayYMD) return true;

  // Compute tomorrow in IST
  const tomorrow = new Date(istNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYMD = formatDateYMD(tomorrow);

  // If target date is tomorrow and current IST hour >= 20 (8 PM), cutoff has passed
  if (targetDateStr === tomorrowYMD && istNow.getHours() >= DAILY_DELIVERY_CUTOFF_HOUR_IST) {
    return true;
  }

  return false;
}

/**
 * Calculate the earliest editable delivery date based on 8:00 PM cutoff
 */
export function getEarliestEditableDeliveryDate() {
  const istNow = getNowInIST();
  const d = new Date(istNow);
  if (istNow.getHours() >= DAILY_DELIVERY_CUTOFF_HOUR_IST) {
    d.setDate(d.getDate() + 2); // Day after tomorrow
  } else {
    d.setDate(d.getDate() + 1); // Tomorrow morning
  }
  return formatDateYMD(d);
}

/**
 * Fetch and verify subscription ownership by customer
 */
export async function getVerifiedSubscription(pool, subscriptionId, customerId) {
  const { rows } = await pool.query(
    `SELECT cs.*, c.phone, c.full_name, c.email
     FROM customer_subscriptions cs
     JOIN customers c ON c.id = cs.customer_id
     WHERE cs.id = $1 AND cs.customer_id = $2`,
    [subscriptionId, customerId]
  );
  return rows[0] || null;
}

/**
 * Calculate the next scheduled delivery date for a subscription
 */
export async function calculateNextDeliveryDate(pool, subscriptionId) {
  const istNow = getNowInIST();
  const earliest = getEarliestEditableDeliveryDate();

  let subStartDate = null;
  let subPaidThroughEndDate = null;
  try {
    const { rows: subRows } = await pool.query(
      'SELECT notes, next_delivery, cost_per_day_paise, total_amount_paise, created_at FROM customer_subscriptions WHERE id = $1',
      [subscriptionId]
    );
    const subRecord = subRows[0];
    const subNotes = typeof subRecord?.notes === 'object' && subRecord?.notes !== null ? subRecord.notes : {};
    subStartDate = subNotes.startDate || subNotes.start_date ||
      (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
        ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
        : null);

    const hasPayment = Boolean(
      subNotes.lastPaymentId ||
      subNotes.paymentId ||
      (typeof subNotes.paidCount === 'number' && subNotes.paidCount > 0)
    );
    if (hasPayment) {
      subPaidThroughEndDate = derivePaidThroughDate({
        startDate: subStartDate || (subRecord?.created_at ? formatDateYMD(new Date(subRecord.created_at)) : null),
        paidThroughDate: subNotes.paidThroughDate,
        current_end: subNotes.current_end,
        cost_per_day_paise: subRecord?.cost_per_day_paise,
        total_amount_paise: subRecord?.total_amount_paise,
        paidCount: subNotes.paidCount,
        months: subNotes.months
      });
    }
  } catch {}

  // Look ahead up to 90 days to find the next active date
  for (let i = 0; i < 90; i++) {
    const candidate = new Date(istNow);
    if (istNow.getHours() >= DAILY_DELIVERY_CUTOFF_HOUR_IST) {
      candidate.setDate(candidate.getDate() + 2 + i);
    } else {
      candidate.setDate(candidate.getDate() + 1 + i);
    }
    const candidateYMD = formatDateYMD(candidate);

    // If subscription has a future start date, do not schedule delivery before start date
    if (subStartDate && candidateYMD < subStartDate) {
      continue;
    }

    // Do not schedule delivery beyond authenticated paid-through period
    if (subPaidThroughEndDate && candidateYMD > subPaidThroughEndDate) {
      continue;
    }

    // 1. Check if skipped
    const { rows: skipped } = await pool.query(
      'SELECT id FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, candidateYMD]
    );
    if (skipped.length > 0) continue;

    // 2. Check if in vacation or pause
    const { rows: paused } = await pool.query(
      `SELECT id FROM subscription_delivery_pauses 
       WHERE subscription_id = $1 
         AND pause_start_date <= $2 
         AND (pause_end_date IS NULL OR pause_end_date >= $2)
         AND resumed_at IS NULL`,
      [subscriptionId, candidateYMD]
    );
    if (paused.length > 0) continue;

    return `${candidateYMD}, 6:00 AM – 7:00 AM`;
  }

  return subPaidThroughEndDate ? 'Subscription Period Ended' : 'On Hold (Paused)';
}

/**
 * PAUSE a subscription (immediate or scheduled)
 */
export async function pauseSubscription(pool, { subscriptionId, customerId, startDate = null, endDate = null, reason = 'Customer requested pause' }) {
  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }
    if (sub.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { success: false, error: 'cannot_pause_cancelled_subscription', statusCode: 400 };
    }

    const effectiveStartDate = startDate || getEarliestEditableDeliveryDate();

    // Insert pause record
    await client.query(
      `INSERT INTO subscription_delivery_pauses (subscription_id, customer_id, pause_start_date, pause_end_date, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [subscriptionId, customerId, effectiveStartDate, endDate, reason]
    );

    // Update status to paused
    await client.query(
      "UPDATE customer_subscriptions SET status = 'paused', next_delivery = 'On Hold (Paused)', updated_at = NOW() WHERE id = $1",
      [subscriptionId]
    );

    // Cancel any already scheduled delivery orders from effectiveStartDate onwards
    await client.query(
      `UPDATE subscription_delivery_orders 
       SET status = 'cancelled', failed_reason = 'Subscription paused by customer', updated_at = NOW()
       WHERE subscription_id = $1 AND delivery_date >= $2 AND status = 'scheduled'`,
      [subscriptionId, effectiveStartDate]
    );

    // Record domain audit event
    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'subscription_paused', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ effectiveStartDate, endDate, reason })]
    );

    await client.query('COMMIT');

    // Asynchronously queue SMS notification
    if (sub.phone) {
      const idempotencyKey = `sms_sub_pause_${subscriptionId}_${effectiveStartDate}`;
      queueNotification(pool, {
        customerId,
        phone: sub.phone,
        templateKey: 'SUBSCRIPTION_PAUSED',
        params: {
          productName: sub.product_name,
          pauseDate: effectiveStartDate
        },
        idempotencyKey
      }).catch(() => {});
    }

    return {
      success: true,
      subscriptionId,
      status: 'paused',
      effectiveStartDate,
      message: `Subscription paused starting ${effectiveStartDate}. Deliveries are on hold.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * RESUME a paused subscription
 */
export async function resumeSubscription(pool, { subscriptionId, customerId }) {
  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }
    if (sub.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { success: false, error: 'cannot_resume_cancelled_subscription', statusCode: 400 };
    }

    // Close any open pause records
    await client.query(
      `UPDATE subscription_delivery_pauses 
       SET resumed_at = NOW()
       WHERE subscription_id = $1 AND resumed_at IS NULL`,
      [subscriptionId]
    );

    // Calculate next delivery date
    const nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);

    // Update status to active
    await client.query(
      "UPDATE customer_subscriptions SET status = 'active', next_delivery = $2, updated_at = NOW() WHERE id = $1",
      [subscriptionId, nextDelivery]
    );

    // Record domain event
    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'subscription_resumed', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ resumedAt: new Date().toISOString(), nextDelivery })]
    );

    await client.query('COMMIT');

    // Queue SMS notification
    if (sub.phone) {
      const idempotencyKey = `sms_sub_resume_${subscriptionId}_${Date.now().toString(36)}`;
      queueNotification(pool, {
        customerId,
        phone: sub.phone,
        templateKey: 'SUBSCRIPTION_RESUMED',
        params: {
          productName: sub.product_name,
          nextDate: nextDelivery.split(',')[0]
        },
        idempotencyKey
      }).catch(() => {});
    }

    return {
      success: true,
      subscriptionId,
      status: 'active',
      nextDelivery,
      message: `Subscription resumed! Next morning delivery scheduled for ${nextDelivery}.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * SKIP a single delivery date
 */
export async function skipDeliveryDate(pool, { subscriptionId, customerId, skipDate, reason = 'Customer skipped single date' }) {
  if (!skipDate || !/^\d{4}-\d{2}-\d{2}$/.test(skipDate)) {
    return { success: false, error: 'invalid_date_format', message: 'Date must be YYYY-MM-DD.' };
  }

  if (isDeliveryCutoffPassed(skipDate)) {
    return {
      success: false,
      error: 'cutoff_passed',
      message: `Modifications for ${skipDate} closed at 8:00 PM IST. Earliest editable delivery date is ${getEarliestEditableDeliveryDate()}.`
    };
  }

  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }

    // Insert into skipped dates
    await client.query(
      `INSERT INTO subscription_skipped_dates (subscription_id, customer_id, skip_date, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subscription_id, skip_date) DO NOTHING`,
      [subscriptionId, customerId, skipDate, reason]
    );

    // Cancel any scheduled order for that day
    await client.query(
      `UPDATE subscription_delivery_orders 
       SET status = 'cancelled', failed_reason = 'Delivery date skipped by customer', updated_at = NOW()
       WHERE subscription_id = $1 AND delivery_date = $2 AND status = 'scheduled'`,
      [subscriptionId, skipDate]
    );

    // Record billing extension (prepaid) or credit (recurring mandate)
    const isPrepaid = sub.plan_type !== 'continuous' || !sub.razorpay_subscription_id;
    const adjType = isPrepaid ? 'extension' : 'credit';
    const adjNotes = isPrepaid
      ? `Carried forward 1 day delivery for skipped date ${skipDate}`
      : `Accrued 1 day billing credit for skipped date ${skipDate}`;

    await client.query(
      `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [subscriptionId, customerId, adjType, sub.cost_per_day_paise || 10500, adjNotes]
    );

    // Update next delivery date
    const nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
    await client.query(
      'UPDATE customer_subscriptions SET next_delivery = $2, updated_at = NOW() WHERE id = $1',
      [subscriptionId, nextDelivery]
    );

    // Record domain event
    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'delivery_date_skipped', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ skipDate, reason, nextDelivery })]
    );

    await client.query('COMMIT');

    return {
      success: true,
      subscriptionId,
      skipDate,
      nextDelivery,
      message: `Delivery skipped for ${skipDate}. 1 day has been carried forward to your subscription.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * UN-SKIP a previously skipped delivery date
 */
export async function unskipDeliveryDate(pool, { subscriptionId, customerId, skipDate }) {
  if (isDeliveryCutoffPassed(skipDate)) {
    return {
      success: false,
      error: 'cutoff_passed',
      message: `Cutoff passed for ${skipDate}. Cannot restore delivery for this date.`
    };
  }

  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }

    await client.query(
      'DELETE FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2',
      [subscriptionId, skipDate]
    );

    // Revert 1 day extension/credit in billing adjustments
    const isPrepaid = sub.plan_type !== 'continuous' || !sub.razorpay_subscription_id;
    const adjType = isPrepaid ? 'extension' : 'credit';

    await client.query(
      `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
       VALUES ($1, $2, $3, -1, $4, $5)`,
      [subscriptionId, customerId, adjType, -(sub.cost_per_day_paise || 10500), `Reverted 1 day ${adjType} for unskipped date ${skipDate}`]
    );

    const nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
    await client.query(
      'UPDATE customer_subscriptions SET next_delivery = $2, updated_at = NOW() WHERE id = $1',
      [subscriptionId, nextDelivery]
    );

    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'delivery_date_unskipped', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ skipDate, nextDelivery })]
    );

    await client.query('COMMIT');
    return {
      success: true,
      subscriptionId,
      skipDate,
      nextDelivery,
      message: `Delivery restored for ${skipDate}.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * Set VACATION date range (pauses deliveries between startDate and endDate)
 */
export async function setVacation(pool, { subscriptionId, customerId, startDate, endDate, reason = 'Vacation mode' }) {
  if (!startDate || !endDate || startDate > endDate) {
    return { success: false, error: 'invalid_vacation_dates', message: 'Valid start and end dates required (start <= end).' };
  }

  if (isDeliveryCutoffPassed(startDate)) {
    return {
      success: false,
      error: 'cutoff_passed',
      message: `Cutoff passed for ${startDate}. Earliest vacation start date is ${getEarliestEditableDeliveryDate()}.`
    };
  }

  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }

    // Calculate vacation days count
    const dStart = new Date(startDate);
    const dEnd = new Date(endDate);
    const daysCount = Math.round((dEnd - dStart) / (24 * 3600 * 1000)) + 1;

    // Record vacation in pauses
    await client.query(
      `INSERT INTO subscription_delivery_pauses (subscription_id, customer_id, pause_start_date, pause_end_date, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [subscriptionId, customerId, startDate, endDate, reason]
    );

    // Cancel any orders already scheduled in that range
    await client.query(
      `UPDATE subscription_delivery_orders 
       SET status = 'cancelled', failed_reason = 'Vacation mode active', updated_at = NOW()
       WHERE subscription_id = $1 AND delivery_date >= $2 AND delivery_date <= $3 AND status = 'scheduled'`,
      [subscriptionId, startDate, endDate]
    );

    // Record billing adjustment (extension for prepaid, credit for recurring mandate)
    const isPrepaid = sub.plan_type !== 'continuous' || !sub.razorpay_subscription_id;
    const adjType = isPrepaid ? 'extension' : 'credit';
    const totalAmount = (sub.cost_per_day_paise || 10500) * daysCount;

    await client.query(
      `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, customerId, adjType, daysCount, totalAmount, `Vacation ${adjType} from ${startDate} to ${endDate}`]
    );

    const nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
    await client.query(
      'UPDATE customer_subscriptions SET next_delivery = $2, updated_at = NOW() WHERE id = $1',
      [subscriptionId, nextDelivery]
    );

    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'vacation_scheduled', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ startDate, endDate, daysCount, nextDelivery })]
    );

    await client.query('COMMIT');

    return {
      success: true,
      subscriptionId,
      startDate,
      endDate,
      daysCount,
      nextDelivery,
      message: `Vacation set from ${startDate} to ${endDate} (${daysCount} days carried forward). Deliveries resume on ${nextDelivery}.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * MODIFY subscription quantity / pack size
 */
export async function modifySubscriptionQuantity(pool, { subscriptionId, customerId, newQuantity }) {
  const cleanQty = String(newQuantity || '').trim();
  if (!APPROVED_MILK_PACK_SIZES.some(s => s.toLowerCase() === cleanQty.toLowerCase())) {
    return {
      success: false,
      error: 'invalid_pack_size',
      message: `Supported pack sizes: ${APPROVED_MILK_PACK_SIZES.join(', ')}`
    };
  }

  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }

    const newDailyRatePaise = getMilkDailySubscriptionRatePaise(sub.product_name, cleanQty);
    const newQtyNum = parseLitresFromSize(cleanQty);

    await client.query(
      `UPDATE customer_subscriptions 
       SET quantity = $2, quantity_num = $3, cost_per_day_paise = $4, updated_at = NOW()
       WHERE id = $1`,
      [subscriptionId, cleanQty, newQtyNum, newDailyRatePaise]
    );

    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'subscription_quantity_modified', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ previousQty: sub.quantity, newQuantity: cleanQty, newDailyRatePaise })]
    );

    await client.query('COMMIT');

    return {
      success: true,
      subscriptionId,
      quantity: cleanQty,
      quantityNum: newQtyNum,
      dailyRate: newDailyRatePaise / 100,
      dailyRatePaise: newDailyRatePaise,
      message: `Subscription updated to ${cleanQty} (₹${newDailyRatePaise / 100}/day).`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * CANCEL a subscription
 */
export async function cancelSubscription(pool, { subscriptionId, customerId, reason = 'Customer requested cancellation' }) {
  const { client, release } = await acquireClient(pool);
  try {
    await client.query('BEGIN');
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) {
      await client.query('ROLLBACK');
      return { success: false, error: 'subscription_not_found', statusCode: 404 };
    }

    await client.query(
      "UPDATE customer_subscriptions SET status = 'cancelled', next_delivery = 'Cancelled', updated_at = NOW() WHERE id = $1",
      [subscriptionId]
    );

    // Cancel all future scheduled delivery orders
    await client.query(
      `UPDATE subscription_delivery_orders 
       SET status = 'cancelled', failed_reason = 'Subscription cancelled by customer', updated_at = NOW()
       WHERE subscription_id = $1 AND status = 'scheduled'`,
      [subscriptionId]
    );

    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'subscription_cancelled', 'customer', $3::jsonb)`,
      [subscriptionId, customerId, JSON.stringify({ reason, cancelledAt: new Date().toISOString() })]
    );

    await client.query('COMMIT');

    return {
      success: true,
      subscriptionId,
      status: 'cancelled',
      message: 'Subscription has been cancelled.'
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * GET subscription delivery calendar for a specific month
 */
export async function getSubscriptionCalendar(pool, { subscriptionId, customerId, year, month }) {
  const sub = await getVerifiedSubscription(pool, subscriptionId, customerId);
  if (!sub) return null;

  const y = Number(year) || getNowInIST().getFullYear();
  const m = Number(month) !== undefined ? Number(month) : getNowInIST().getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const startDateStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const endDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // 1. Fetch delivery orders in this month
  const { rows: deliveryOrders } = await pool.query(
    `SELECT delivery_date::text, status, delivery_order_number, delivered_at, failed_reason
     FROM subscription_delivery_orders
     WHERE subscription_id = $1 AND delivery_date >= $2 AND delivery_date <= $3`,
    [subscriptionId, startDateStr, endDateStr]
  );
  const orderMap = new Map(deliveryOrders.map(o => [o.delivery_date, o]));

  // 2. Fetch skipped dates
  const { rows: skipped } = await pool.query(
    `SELECT skip_date::text, reason
     FROM subscription_skipped_dates
     WHERE subscription_id = $1 AND skip_date >= $2 AND skip_date <= $3`,
    [subscriptionId, startDateStr, endDateStr]
  );
  const skipMap = new Map(skipped.map(s => [s.skip_date, s.reason]));

  // 3. Fetch pauses / vacations
  const { rows: pauses } = await pool.query(
    `SELECT pause_start_date::text, pause_end_date::text, reason
     FROM subscription_delivery_pauses
     WHERE subscription_id = $1 AND pause_start_date <= $3 AND (pause_end_date IS NULL OR pause_end_date >= $2)`,
    [subscriptionId, startDateStr, endDateStr]
  );

  const istNow = getNowInIST();
  const todayYMD = formatDateYMD(istNow);

  const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
  const subStartDate = subNotes.startDate || subNotes.start_date ||
    (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
      ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
      : null);

  const subPaidThroughEndDate = derivePaidThroughDate({
    startDate: subStartDate || (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null),
    paidThroughDate: subNotes.paidThroughDate,
    current_end: subNotes.current_end,
    cost_per_day_paise: sub.cost_per_day_paise,
    total_amount_paise: sub.total_amount_paise,
    paidCount: subNotes.paidCount,
    months: subNotes.months
  });

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let status = 'scheduled';
    let detail = 'Scheduled Delivery (6:00 AM – 7:00 AM)';

    if (subStartDate && dateStr < subStartDate) {
      status = 'not_started';
      detail = `Subscription begins on ${subStartDate}`;
    } else if (subPaidThroughEndDate && dateStr > subPaidThroughEndDate) {
      status = 'ended';
      detail = `Paid entitlement ended on ${subPaidThroughEndDate}`;
    } else if (orderMap.has(dateStr)) {
      const ord = orderMap.get(dateStr);
      status = ord.status;
      detail = ord.status === 'delivered' ? `Delivered at ${new Date(ord.delivered_at).toLocaleTimeString('en-IN')}` : ord.status;
    } else if (skipMap.has(dateStr)) {
      status = 'skipped';
      detail = skipMap.get(dateStr) || 'Skipped by customer';
    } else {
      const activePause = pauses.find(p => p.pause_start_date <= dateStr && (!p.pause_end_date || p.pause_end_date >= dateStr));
      if (activePause) {
        status = activePause.pause_end_date ? 'vacation' : 'paused';
        detail = activePause.reason || (activePause.pause_end_date ? 'Vacation mode' : 'Subscription paused');
      } else if (sub.status === 'paused') {
        status = 'paused';
        detail = 'Subscription on hold';
      } else if (sub.status === 'cancelled') {
        status = 'cancelled';
        detail = 'Subscription cancelled';
      } else if (dateStr < todayYMD) {
        status = 'past';
        detail = 'Past date';
      }
    }

    days.push({
      date: dateStr,
      day: d,
      dayOfWeek: new Date(y, m, d).toLocaleDateString('en-IN', { weekday: 'short' }),
      status,
      detail,
      productName: sub.product_name,
      quantity: sub.quantity,
      isToday: dateStr === todayYMD,
      isEditable: !isDeliveryCutoffPassed(dateStr)
    });
  }

  return {
    subscriptionId,
    productName: sub.product_name,
    quantity: sub.quantity,
    year: y,
    month: m,
    monthName: new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long' }),
    days
  };
}


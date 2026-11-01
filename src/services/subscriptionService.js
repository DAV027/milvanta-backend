import crypto from 'node:crypto';
/**
 * Milvanta Subscription Domain Service
 * Server-authoritative PostgreSQL lifecycle, calendar, cutoff enforcement, and billing adjustments
 */

import { queueNotification } from './notificationService.js';

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
 * Safely add calendar months to a YYYY-MM-DD start date and return the inclusive paid-through end date.
 * Handles month-end dates (e.g. Jan 31 -> Feb 28, Mar 31 -> Apr 30, Aug 31 -> Sep 30) without rollover.
 */
export function addCalendarMonths(startDateStr, numMonths = 1) {
  if (!startDateStr || typeof startDateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDateStr.trim())) {
    return null;
  }
  const n = Number(numMonths);
  if (!Number.isFinite(n) || n < 1) return null;

  const [startYear, startMonth, startDay] = startDateStr.trim().split('-').map(Number);
  const maxDayInStartMonth = new Date(Date.UTC(startYear, startMonth, 0)).getUTCDate();
  const isMonthEnd = (startDay === maxDayInStartMonth);

  if (isMonthEnd) {
    const totalTargetMonth = startMonth + n;
    const targetYear = startYear + Math.floor((totalTargetMonth - 1) / 12);
    const targetMonth = ((totalTargetMonth - 1) % 12) + 1;
    const targetDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  }

  if (startDay === 1) {
    const totalTargetMonth = startMonth + n - 1;
    const targetYear = startYear + Math.floor((totalTargetMonth - 1) / 12);
    const targetMonth = ((totalTargetMonth - 1) % 12) + 1;
    const targetDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  }

  const totalTargetMonth = startMonth + n;
  const targetYear = startYear + Math.floor((totalTargetMonth - 1) / 12);
  const targetMonth = ((totalTargetMonth - 1) % 12) + 1;
  const maxDaysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const nextCycleStartDay = Math.min(startDay, maxDaysInTargetMonth);

  const nextCycleDate = new Date(Date.UTC(targetYear, targetMonth - 1, nextCycleStartDay));
  nextCycleDate.setUTCDate(nextCycleDate.getUTCDate() - 1);
  return nextCycleDate.toISOString().slice(0, 10);
}

export function addDaysToYMD(ymdStr, days) {
  if (!ymdStr || typeof ymdStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymdStr.trim())) return null;
  const d = new Date(`${ymdStr.trim()}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Determine if subscription is a recurring autopay mandate (Razorpay sub_... or continuous mandate)
 */
export function isRecurringAutopaySubscription(sub) {
  if (!sub) return false;
  const notes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
  const rzpSubId = sub.razorpay_subscription_id || notes.razorpay_subscription_id || notes.subscription_id;
  if (typeof rzpSubId === 'string' && rzpSubId.startsWith('sub_')) {
    return true;
  }
  if (sub.plan_type === 'continuous' || notes.authType === 'recurring' || notes.plan_type === 'continuous') {
    return true;
  }
  return false;
}

/**
 * Determine if subscription is prepaid (fixed period or non-autopay)
 */
export function isPrepaidSubscription(sub) {
  return !isRecurringAutopaySubscription(sub);
}

/**
 * Sum net delivery extensions for a subscription
 */
export async function getSubscriptionNetExtensionDays(clientOrPool, subscriptionId) {
  const { rows } = await clientOrPool.query(
    `SELECT COALESCE(SUM(days_count), 0)::int as total_extension_days
     FROM subscription_billing_adjustments
     WHERE subscription_id = $1 AND adjustment_type = 'extension'`,
    [subscriptionId]
  );
  return rows[0]?.total_extension_days || 0;
}

/**
 * Authoritative Effective Paid-Through Date
 * Includes base calendar schedule plus carried-forward extension days for prepaid subscriptions
 */
export async function getEffectivePaidThroughDate(clientOrPool, sub) {
  if (!sub) return null;
  const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
  const subStartDate = subNotes.startDate || subNotes.start_date ||
    (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
      ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
      : null) ||
    (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null);

  const basePaidThroughDate = derivePaidThroughDate({
    startDate: subStartDate,
    paidThroughDate: subNotes.paidThroughDate,
    current_end: subNotes.current_end,
    cost_per_day_paise: sub.cost_per_day_paise,
    total_amount_paise: sub.total_amount_paise,
    paidCount: subNotes.paidCount,
    months: subNotes.months
  });

  if (!basePaidThroughDate) return null;

  if (isPrepaidSubscription(sub)) {
    const netExtensionDays = await getSubscriptionNetExtensionDays(clientOrPool, sub.id);
    if (netExtensionDays > 0) {
      return addDaysToYMD(basePaidThroughDate, netExtensionDays);
    }
  }

  return basePaidThroughDate;
}

/**
 * Record entry into subscription entitlement ledger
 */
export async function recordEntitlementLedgerEntry(clientOrPool, {
  subscriptionId,
  customerId,
  entryType,
  billingCycleStart = null,
  billingCycleEnd = null,
  daysDelta = 0,
  amountPaise = 0,
  deliveryDate = null,
  paymentId = null,
  refundRequestId = null,
  notes = null,
  metadata = {}
}) {
  const { client, release } = await acquireClient(clientOrPool);
  try {
    const { rows } = await client.query(
      `INSERT INTO subscription_entitlement_ledger (
        subscription_id, customer_id, entry_type,
        billing_cycle_start, billing_cycle_end, days_delta,
        amount_paise, delivery_date, payment_id,
        refund_request_id, notes, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      RETURNING *`,
      [
        subscriptionId, customerId, entryType,
        billingCycleStart, billingCycleEnd, daysDelta,
        amountPaise, deliveryDate, paymentId,
        refundRequestId, notes, JSON.stringify(metadata || {})
      ]
    );
    return rows[0];
  } finally {
    release();
  }
}

/**
 * Server-authoritative calculation of subscription entitlement and refundable balance
 */
export async function calculateSubscriptionEntitlement(poolOrClient, { subscriptionId, customerId }) {
  const { client, release } = await acquireClient(poolOrClient);
  try {
    const sub = await getVerifiedSubscription(client, subscriptionId, customerId);
    if (!sub) return null;

    const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
    const costPerDayPaise = Number(sub.cost_per_day_paise) || 10500;
    const isAutopay = isRecurringAutopaySubscription(sub);
    const planType = isAutopay ? 'recurring_autopay' : 'prepaid';

    const subStartDate = subNotes.startDate || subNotes.start_date ||
      (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
        ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
        : null) ||
      (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null);

    const basePaidThroughDate = derivePaidThroughDate({
      startDate: subStartDate,
      paidThroughDate: subNotes.paidThroughDate,
      current_end: subNotes.current_end,
      cost_per_day_paise: sub.cost_per_day_paise,
      total_amount_paise: sub.total_amount_paise,
      paidCount: subNotes.paidCount,
      months: subNotes.months
    });

    const netExtensionDays = isAutopay ? 0 : await getSubscriptionNetExtensionDays(client, sub.id);
    const effectivePaidThroughDate = basePaidThroughDate
      ? (netExtensionDays > 0 ? addDaysToYMD(basePaidThroughDate, netExtensionDays) : basePaidThroughDate)
      : null;

    // Delivery stats
    const { rows: deliveryStats } = await client.query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered_count,
         COUNT(*) FILTER (WHERE status = 'scheduled')::int as scheduled_count,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_count
       FROM subscription_delivery_orders
       WHERE subscription_id = $1`,
      [subscriptionId]
    );
    const deliveredCount = deliveryStats[0]?.delivered_count || 0;
    const scheduledCount = deliveryStats[0]?.scheduled_count || 0;
    const cancelledCount = deliveryStats[0]?.cancelled_count || 0;

    // Billing adjustments
    const { rows: creditRows } = await client.query(
      `SELECT COALESCE(SUM(amount_paise), 0)::int as total_credit_paise,
              COALESCE(SUM(days_count), 0)::int as total_credit_days
       FROM subscription_billing_adjustments
       WHERE subscription_id = $1 AND adjustment_type = 'credit'`,
      [subscriptionId]
    );
    const accruedCreditPaise = creditRows[0]?.total_credit_paise || 0;

    // Refund requests
    const { rows: refundStats } = await client.query(
      `SELECT 
         COALESCE(SUM(approved_amount_paise) FILTER (WHERE status IN ('approved', 'processed')), 0)::int as refunded_amount_paise,
         COALESCE(SUM(requested_amount_paise) FILTER (WHERE status = 'pending'), 0)::int as pending_refund_paise
       FROM refund_requests
       WHERE subscription_id = $1`,
      [subscriptionId]
    );
    const alreadyRefundedPaise = refundStats[0]?.refunded_amount_paise || 0;
    const pendingRefundPaise = refundStats[0]?.pending_refund_paise || 0;

    const totalContractAmountPaise = Number(sub.total_amount_paise) || (costPerDayPaise * (subNotes.months ? subNotes.months * 30 : 30));
    const deliveredValuePaise = deliveredCount * costPerDayPaise;

    const unusedBalancePaise = Math.max(0, totalContractAmountPaise - deliveredValuePaise - alreadyRefundedPaise);
    const estimatedRefundablePaise = Math.max(0, unusedBalancePaise - pendingRefundPaise);

    const totalDaysPurchased = Math.round(totalContractAmountPaise / costPerDayPaise);
    const unusedDays = Math.max(0, Math.floor(unusedBalancePaise / costPerDayPaise));

    const paymentId = subNotes.paymentId || subNotes.lastPaymentId || null;
    const razorpaySubscriptionId = sub.razorpay_subscription_id || subNotes.razorpay_subscription_id || null;

    return {
      subscriptionId: sub.id,
      customerId: sub.customer_id,
      productName: sub.product_name,
      quantity: sub.quantity,
      planType,
      isAutopay,
      costPerDayPaise,
      totalContractAmountPaise,
      deliveredCount,
      scheduledCount,
      cancelledCount,
      deliveredValuePaise,
      netExtensionDays,
      accruedCreditPaise,
      alreadyRefundedPaise,
      pendingRefundPaise,
      unusedBalancePaise,
      estimatedRefundablePaise,
      totalDaysPurchased,
      unusedDays,
      subStartDate,
      basePaidThroughDate,
      effectivePaidThroughDate,
      paymentId,
      razorpaySubscriptionId,
      status: sub.status
    };
  } finally {
    release();
  }
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
  // If paidCount is explicitly 0 or negative, there is no paid entitlement
  if (paidCount !== undefined && paidCount !== null && Number(paidCount) <= 0) {
    return null;
  }

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

  const effectivePaidCycles = Number(paidCount) || 1;
  if (effectivePaidCycles < 1) return null;

  // Multi-month subscription calculation:
  // total_amount_paise represents the full contract total, not necessarily one monthly charge.
  // Entitlement is strictly based on the number of paid cycles (paidCount), NOT the entire contract duration.
  const contractMonths = Number(months);
  if (Number.isFinite(contractMonths) && contractMonths > 0) {
    const paidMonths = Math.min(effectivePaidCycles, contractMonths);
    return addCalendarMonths(startDate, paidMonths);
  }

  // Fallback when months is not explicitly supplied:
  const costPerDay = Number(cost_per_day_paise) || 0;
  const totalPaise = Number(total_amount_paise) || 0;
  if (costPerDay > 0 && totalPaise > 0) {
    const daysPerCycle = Math.min(Math.floor(totalPaise / costPerDay), 30);
    const totalPaidDays = daysPerCycle * effectivePaidCycles;
    if (totalPaidDays > 0) {
      const startD = new Date(`${startDate.trim()}T00:00:00Z`);
      if (!Number.isNaN(startD.getTime())) {
        const endD = new Date(startD);
        endD.setUTCDate(endD.getUTCDate() + totalPaidDays - 1);
        return endD.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

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
      'SELECT id, customer_id, notes, next_delivery, cost_per_day_paise, total_amount_paise, created_at, plan_type, razorpay_subscription_id FROM customer_subscriptions WHERE id = $1',
      [subscriptionId]
    );
    const subRecord = subRows[0];
    const subNotes = typeof subRecord?.notes === 'object' && subRecord?.notes !== null ? subRecord.notes : {};
    subStartDate = subNotes.startDate || subNotes.start_date ||
      (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
        ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
        : null);

    if (subRecord?.status === 'pending_authorization' || subNotes.fulfillmentEntitled === false) {
      return subNotes.mandateAuthorized
        ? 'Mandate Authorized — Awaiting Billing Payment'
        : 'Pending Billing Cycle Payment';
    }

    const hasPayment = Boolean(
      subNotes.fulfillmentEntitled === true && (
        subNotes.lastPaymentId ||
        subNotes.paymentId ||
        (typeof subNotes.paidCount === 'number' && subNotes.paidCount > 0)
      )
    );
    if (hasPayment) {
      subPaidThroughEndDate = await getEffectivePaidThroughDate(pool, subRecord);
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

    // Asynchronously queue WhatsApp notification
    if (sub.phone) {
      const idempotencyKey = `sms_sub_pause_${subscriptionId}_${effectiveStartDate}`;
      await queueNotification(client, {
        customerId,
        phone: sub.phone,
        templateKey: 'SUBSCRIPTION_PAUSED',
        params: {
          productName: sub.product_name,
          pauseDate: effectiveStartDate
        },
        idempotencyKey
      });
    }

    await client.query('COMMIT');

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

    // Find any open pause records to calculate paused days
    const { rows: openPauses } = await client.query(
      `SELECT id, pause_start_date, pause_end_date
       FROM subscription_delivery_pauses
       WHERE subscription_id = $1 AND resumed_at IS NULL`,
      [subscriptionId]
    );

    // Close any open pause records
    await client.query(
      `UPDATE subscription_delivery_pauses 
       SET resumed_at = NOW()
       WHERE subscription_id = $1 AND resumed_at IS NULL`,
      [subscriptionId]
    );

    const istNow = getNowInIST();
    const todayYMD = formatDateYMD(istNow);

    // For any indefinite pause (pause_end_date is null), calculate elapsed pause days and record adjustment
    for (const p of openPauses) {
      if (!p.pause_end_date && p.pause_start_date) {
        const pauseStart = p.pause_start_date.toISOString ? p.pause_start_date.toISOString().slice(0, 10) : String(p.pause_start_date).slice(0, 10);
        if (todayYMD >= pauseStart) {
          const d1 = new Date(`${pauseStart}T00:00:00Z`);
          const d2 = new Date(`${todayYMD}T00:00:00Z`);
          const pausedDays = Math.max(1, Math.round((d2 - d1) / (24 * 3600 * 1000)));
          const isPrepaid = isPrepaidSubscription(sub);
          const adjType = isPrepaid ? 'extension' : 'credit';
          const totalAmount = (sub.cost_per_day_paise || 10500) * pausedDays;

          await client.query(
            `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [subscriptionId, customerId, adjType, pausedDays, totalAmount, `Indefinite pause ${adjType} (${pausedDays} days)`]
          );

          await recordEntitlementLedgerEntry(client, {
            subscriptionId,
            customerId,
            entryType: 'manual_pause',
            daysDelta: pausedDays,
            amountPaise: totalAmount,
            notes: `Indefinite pause ${adjType} (${pausedDays} days)`
          });
        }
      }
    }

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

    // Queue WhatsApp notification
    if (sub.phone) {
      const idempotencyKey = `sms_sub_resume_${subscriptionId}_${Date.now().toString(36)}`;
      await queueNotification(client, {
        customerId,
        phone: sub.phone,
        templateKey: 'SUBSCRIPTION_RESUMED',
        params: {
          productName: sub.product_name,
          nextDate: nextDelivery.split(',')[0]
        },
        idempotencyKey
      });
    }

    await client.query('COMMIT');

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
  if (!skipDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(skipDate).trim())) {
    return { success: false, error: 'invalid_date_format', message: 'Date must be YYYY-MM-DD.' };
  }
  const cleanSkipDate = String(skipDate).trim();

  if (isDeliveryCutoffPassed(cleanSkipDate)) {
    return {
      success: false,
      error: 'cutoff_passed',
      message: `Modifications for ${cleanSkipDate} closed at 8:00 PM IST. Earliest editable delivery date is ${getEarliestEditableDeliveryDate()}.`
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

    if (sub.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { success: false, error: 'cannot_modify_cancelled_subscription', message: 'Cannot skip dates on a cancelled subscription.', statusCode: 400 };
    }

    const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
    const subStartDate = subNotes.startDate || subNotes.start_date ||
      (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
        ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
        : null);

    if (subStartDate && cleanSkipDate < subStartDate) {
      await client.query('ROLLBACK');
      return { success: false, error: 'before_start_date', message: `Cannot skip date before subscription start date (${subStartDate}).`, statusCode: 400 };
    }

    const subPaidThroughEndDate = derivePaidThroughDate({
      startDate: subStartDate || (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null),
      paidThroughDate: subNotes.paidThroughDate,
      current_end: subNotes.current_end,
      cost_per_day_paise: sub.cost_per_day_paise,
      total_amount_paise: sub.total_amount_paise,
      paidCount: subNotes.paidCount,
      months: subNotes.months
    });

    if (subPaidThroughEndDate && cleanSkipDate > subPaidThroughEndDate) {
      await client.query('ROLLBACK');
      return { success: false, error: 'beyond_entitlement', message: `Cannot skip date beyond paid entitlement period (${subPaidThroughEndDate}).`, statusCode: 400 };
    }

    // Insert into skipped dates with RETURNING id to detect actual insertion
    const insertRes = await client.query(
      `INSERT INTO subscription_skipped_dates (subscription_id, customer_id, skip_date, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subscription_id, skip_date) DO NOTHING
       RETURNING id`,
      [subscriptionId, customerId, cleanSkipDate, reason]
    );

    const wasInserted = (insertRes.rowCount || insertRes.rows?.length || 0) > 0;
    let nextDelivery = sub.next_delivery;

    // Idempotent billing & cancellation: ONLY apply when a new skip row was actually inserted
    if (wasInserted) {
      // Cancel any scheduled order for that day
      await client.query(
        `UPDATE subscription_delivery_orders 
         SET status = 'cancelled', failed_reason = 'Delivery date skipped by customer', updated_at = NOW()
         WHERE subscription_id = $1 AND delivery_date = $2 AND status = 'scheduled'`,
        [subscriptionId, cleanSkipDate]
      );

      // Record billing extension (prepaid) or credit (recurring mandate)
      const isPrepaid = isPrepaidSubscription(sub);
      const adjType = isPrepaid ? 'extension' : 'credit';
      const adjNotes = isPrepaid
        ? `Carried forward 1 day delivery for skipped date ${cleanSkipDate}`
        : `Accrued 1 day billing credit for skipped date ${cleanSkipDate}`;

      await client.query(
        `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
         VALUES ($1, $2, $3, 1, $4, $5)`,
        [subscriptionId, customerId, adjType, sub.cost_per_day_paise || 10500, adjNotes]
      );

      await recordEntitlementLedgerEntry(client, {
        subscriptionId,
        customerId,
        entryType: 'delivery_skipped',
        daysDelta: 1,
        amountPaise: sub.cost_per_day_paise || 10500,
        deliveryDate: cleanSkipDate,
        notes: adjNotes
      });

      // Update next delivery date
      nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
      await client.query(
        'UPDATE customer_subscriptions SET next_delivery = $2, updated_at = NOW() WHERE id = $1',
        [subscriptionId, nextDelivery]
      );

      // Record domain event
      await client.query(
        `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
         VALUES ($1, $2, 'delivery_date_skipped', 'customer', $3::jsonb)`,
        [subscriptionId, customerId, JSON.stringify({ skipDate: cleanSkipDate, reason, nextDelivery })]
      );
    } else if (!nextDelivery) {
      nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
    }

    await client.query('COMMIT');

    return {
      success: true,
      subscriptionId,
      skipDate: cleanSkipDate,
      nextDelivery,
      alreadySkipped: !wasInserted,
      message: wasInserted
        ? `Delivery skipped for ${cleanSkipDate}. 1 day has been carried forward to your subscription.`
        : `Delivery for ${cleanSkipDate} was already skipped.`
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
  if (!skipDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(skipDate).trim())) {
    return { success: false, error: 'invalid_date_format', message: 'Date must be YYYY-MM-DD.' };
  }
  const cleanSkipDate = String(skipDate).trim();

  if (isDeliveryCutoffPassed(cleanSkipDate)) {
    return {
      success: false,
      error: 'cutoff_passed',
      message: `Cutoff passed for ${cleanSkipDate}. Cannot restore delivery for this date.`
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

    if (sub.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { success: false, error: 'cannot_modify_cancelled_subscription', message: 'Cannot unskip dates on a cancelled subscription.', statusCode: 400 };
    }

    const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
    const subStartDate = subNotes.startDate || subNotes.start_date ||
      (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
        ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
        : null);

    if (subStartDate && cleanSkipDate < subStartDate) {
      await client.query('ROLLBACK');
      return { success: false, error: 'before_start_date', message: `Cannot unskip date before subscription start date (${subStartDate}).`, statusCode: 400 };
    }

    const subPaidThroughEndDate = derivePaidThroughDate({
      startDate: subStartDate || (sub.created_at ? formatDateYMD(new Date(sub.created_at)) : null),
      paidThroughDate: subNotes.paidThroughDate,
      current_end: subNotes.current_end,
      cost_per_day_paise: sub.cost_per_day_paise,
      total_amount_paise: sub.total_amount_paise,
      paidCount: subNotes.paidCount,
      months: subNotes.months
    });

    if (subPaidThroughEndDate && cleanSkipDate > subPaidThroughEndDate) {
      await client.query('ROLLBACK');
      return { success: false, error: 'beyond_entitlement', message: `Cannot unskip date beyond paid entitlement period (${subPaidThroughEndDate}).`, statusCode: 400 };
    }

    // Delete with RETURNING id to detect whether a skip row was actually removed
    const deleteRes = await client.query(
      'DELETE FROM subscription_skipped_dates WHERE subscription_id = $1 AND skip_date = $2 RETURNING id',
      [subscriptionId, cleanSkipDate]
    );

    const wasRemoved = (deleteRes.rowCount || deleteRes.rows?.length || 0) > 0;
    let nextDelivery = sub.next_delivery;

    // Idempotent adjustment reversal & order restoration: ONLY execute when a skip row was actually removed
    if (wasRemoved) {
      // Restore any scheduled order that was cancelled specifically due to skipping this date
      await client.query(
        `UPDATE subscription_delivery_orders 
         SET status = 'scheduled', failed_reason = NULL, updated_at = NOW()
         WHERE subscription_id = $1 AND delivery_date = $2 AND status = 'cancelled' AND failed_reason = 'Delivery date skipped by customer'`,
        [subscriptionId, cleanSkipDate]
      );

      // Revert 1 day extension/credit in billing adjustments
      const isPrepaid = isPrepaidSubscription(sub);
      const adjType = isPrepaid ? 'extension' : 'credit';

      await client.query(
        `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
         VALUES ($1, $2, $3, -1, $4, $5)`,
        [subscriptionId, customerId, adjType, -(sub.cost_per_day_paise || 10500), `Reverted 1 day ${adjType} for unskipped date ${cleanSkipDate}`]
      );

      await recordEntitlementLedgerEntry(client, {
        subscriptionId,
        customerId,
        entryType: isPrepaid ? 'extension_carried_forward' : 'credit_consumed',
        daysDelta: -1,
        amountPaise: -(sub.cost_per_day_paise || 10500),
        deliveryDate: cleanSkipDate,
        notes: `Reverted 1 day ${adjType} for unskipped date ${cleanSkipDate}`
      });

      nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
      await client.query(
        'UPDATE customer_subscriptions SET next_delivery = $2, updated_at = NOW() WHERE id = $1',
        [subscriptionId, nextDelivery]
      );

      await client.query(
        `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
         VALUES ($1, $2, 'delivery_date_unskipped', 'customer', $3::jsonb)`,
        [subscriptionId, customerId, JSON.stringify({ skipDate: cleanSkipDate, nextDelivery })]
      );
    } else if (!nextDelivery) {
      nextDelivery = await calculateNextDeliveryDate(client, subscriptionId);
    }

    await client.query('COMMIT');
    return {
      success: true,
      subscriptionId,
      skipDate: cleanSkipDate,
      nextDelivery,
      alreadyUnskipped: !wasRemoved,
      message: wasRemoved
        ? `Delivery restored for ${cleanSkipDate}.`
        : `Delivery for ${cleanSkipDate} was not skipped.`
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
    const isPrepaid = isPrepaidSubscription(sub);
    const adjType = isPrepaid ? 'extension' : 'credit';
    const totalAmount = (sub.cost_per_day_paise || 10500) * daysCount;

    await client.query(
      `INSERT INTO subscription_billing_adjustments (subscription_id, customer_id, adjustment_type, days_count, amount_paise, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, customerId, adjType, daysCount, totalAmount, `Vacation ${adjType} from ${startDate} to ${endDate}`]
    );

    await recordEntitlementLedgerEntry(client, {
      subscriptionId,
      customerId,
      entryType: 'vacation_pause',
      daysDelta: daysCount,
      amountPaise: totalAmount,
      notes: `Vacation ${adjType} from ${startDate} to ${endDate}`
    });

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

    if (sub.phone) await queueNotification(client,{customerId,phone:sub.phone,templateKey:'SUBSCRIPTION_CANCELLED',params:{productName:sub.product_name},idempotencyKey:`sms_sub_cancel_${subscriptionId}`});
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
 * CANCEL a subscription with authoritative refund calculation and request creation
 */
export async function cancelSubscriptionWithRefund(pool, {
  subscriptionId,
  customerId,
  reason = 'Customer requested cancellation',
  customerNotes = null,
  requestedRefundAmountPaise = null,
  razorpayClient = null
}) {
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
      return { success: false, error: 'already_cancelled', message: 'Subscription is already cancelled.', statusCode: 400 };
    }

    // Attempt Razorpay gateway cancellation if continuous recurring subscription
    let gatewayCancelled = false;
    let gatewayError = null;
    const isAutopay = isRecurringAutopaySubscription(sub);
    const rzpSubId = sub.razorpay_subscription_id || (sub.notes && sub.notes.razorpay_subscription_id);

    if (isAutopay && rzpSubId && razorpayClient) {
      try {
        await razorpayClient.subscriptions.cancel(rzpSubId, false);
        gatewayCancelled = true;
      } catch (gwErr) {
        gatewayError = gwErr.error?.description || gwErr.message;
        // If already cancelled or past on gateway, allow customer cancellation to complete
        if (gatewayError && (gatewayError.toLowerCase().includes('cancelled') || gatewayError.toLowerCase().includes('not found'))) {
          gatewayCancelled = true;
        }
      }
    }

    // Calculate entitlement before marking cancelled
    const entitlement = await calculateSubscriptionEntitlement(client, { subscriptionId, customerId });

    // Mark subscription cancelled
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

    let refundRow = null;
    if (entitlement && entitlement.estimatedRefundablePaise > 0) {
      const refundAmount = requestedRefundAmountPaise && Number(requestedRefundAmountPaise) > 0
        ? Math.min(Number(requestedRefundAmountPaise), entitlement.estimatedRefundablePaise)
        : entitlement.estimatedRefundablePaise;

      const timestamp = Date.now().toString(36).toUpperCase();
      const random = crypto.randomBytes(3).toString('hex').toUpperCase();
      const requestNumber = `REF-SUB-${timestamp}-${random}`;
      const idempotencyKey = `cancel_refund_sub_${subscriptionId}_${Date.now()}`;

      const { rows: rfRows } = await client.query(
        `INSERT INTO refund_requests (
          request_number, request_type, customer_id, subscription_id,
          payment_id, gateway_subscription_id, requested_amount_paise,
          calculated_eligible_amount_paise, currency, reason_category,
          reason_detail, customer_notes, status, idempotency_key
        ) VALUES ($1, 'subscription', $2, $3, $4, $5, $6, $7, 'INR', 'cancellation', $8, $9, 'pending', $10)
        RETURNING *`,
        [
          requestNumber, customerId, subscriptionId,
          entitlement.paymentId || 'manual_review', entitlement.razorpaySubscriptionId,
          refundAmount, entitlement.estimatedRefundablePaise,
          reason, customerNotes, idempotencyKey
        ]
      );
      refundRow = rfRows[0];

      // Insert audit history
      await client.query(
        `INSERT INTO refund_request_history (refund_request_id, previous_status, new_status, actor_type, actor_id, note)
         VALUES ($1, NULL, 'pending', 'customer', $2, 'Subscription cancellation refund request submitted')`,
        [refundRow.id, customerId]
      );

      // Record in entitlement ledger
      await client.query(
        `INSERT INTO subscription_entitlement_ledger (
          subscription_id, customer_id, entry_type, days_delta, amount_paise, payment_id, refund_request_id, notes
        ) VALUES ($1, $2, 'refund_requested', 0, $3, $4, $5, $6)`,
        [subscriptionId, customerId, refundAmount, entitlement.paymentId, refundRow.id, `Cancellation refund request submitted (${requestNumber})`]
      );
    }

    // Record subscription domain event
    await client.query(
      `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor, payload)
       VALUES ($1, $2, 'subscription_cancelled', 'customer', $3::jsonb)`,
      [
        subscriptionId,
        customerId,
        JSON.stringify({
          reason,
          customerNotes,
          gatewayCancelled,
          gatewayError,
          refundRequestId: refundRow ? refundRow.id : null,
          refundRequestNumber: refundRow ? refundRow.request_number : null,
          cancelledAt: new Date().toISOString()
        })
      ]
    );

    if (sub.phone) await queueNotification(client,{customerId,phone:sub.phone,templateKey:'SUBSCRIPTION_CANCELLED',params:{productName:sub.product_name},idempotencyKey:`sms_sub_cancel_${subscriptionId}`});
    await client.query('COMMIT');

    return {
      success: true,
      subscriptionId,
      status: 'cancelled',
      refundRequest: refundRow ? {
        id: refundRow.id,
        requestNumber: refundRow.request_number,
        requestedAmount: refundRow.requested_amount_paise / 100,
        requestedAmountPaise: refundRow.requested_amount_paise,
        status: refundRow.status
      } : null,
      message: refundRow
        ? `Subscription cancelled. Refund request #${refundRow.request_number} for ₹${refundRow.requested_amount_paise / 100} submitted for admin review.`
        : 'Subscription has been cancelled.'
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
     WHERE subscription_id = $1 
       AND pause_start_date <= $3 
       AND (pause_end_date IS NULL OR pause_end_date >= $2)
       AND resumed_at IS NULL`,
    [subscriptionId, startDateStr, endDateStr]
  );

  const istNow = getNowInIST();
  const todayYMD = formatDateYMD(istNow);

  const subNotes = typeof sub.notes === 'object' && sub.notes !== null ? sub.notes : {};
  const subStartDate = subNotes.startDate || subNotes.start_date ||
    (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
      ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
      : null);

  const subPaidThroughEndDate = await getEffectivePaidThroughDate(pool, sub);

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let status = 'scheduled';
    let detail = 'Scheduled Delivery (6:00 AM – 7:00 AM)';

    if (sub.status === 'pending_authorization' || subNotes.fulfillmentEntitled === false) {
      if (orderMap.has(dateStr)) {
        const ord = orderMap.get(dateStr);
        status = ord.status;
        detail = ord.status === 'delivered' ? `Delivered at ${new Date(ord.delivered_at).toLocaleTimeString('en-IN')}` : ord.status;
      } else if (dateStr < todayYMD) {
        status = 'past';
        detail = 'Past date';
      } else {
        status = 'pending_payment';
        detail = subNotes.mandateAuthorized ? 'Mandate authorized — awaiting billing payment' : 'Awaiting payment';
      }
    } else if (subStartDate && dateStr < subStartDate) {
      status = 'not_started';
      detail = `Subscription begins on ${subStartDate}`;
    } else if (subPaidThroughEndDate && dateStr > subPaidThroughEndDate) {
      status = 'ended';
      detail = `Paid entitlement ended on ${subPaidThroughEndDate}`;
    } else if (!subPaidThroughEndDate && dateStr >= todayYMD && !orderMap.has(dateStr)) {
      status = 'pending_payment';
      detail = 'Awaiting payment confirmation';
    } else if (orderMap.has(dateStr) && (orderMap.get(dateStr).status === 'delivered' || orderMap.get(dateStr).status === 'failed')) {
      const ord = orderMap.get(dateStr);
      status = ord.status;
      detail = ord.status === 'delivered' ? `Delivered at ${new Date(ord.delivered_at).toLocaleTimeString('en-IN')}` : (ord.failed_reason || 'Delivery failed');
    } else if (skipMap.has(dateStr)) {
      status = 'skipped';
      detail = skipMap.get(dateStr) || 'Skipped by customer';
    } else if (orderMap.has(dateStr) && (orderMap.get(dateStr).status !== 'cancelled' || orderMap.get(dateStr).failed_reason !== 'Delivery date skipped by customer')) {
      const ord = orderMap.get(dateStr);
      status = ord.status;
      detail = ord.status === 'delivered' ? `Delivered at ${new Date(ord.delivered_at).toLocaleTimeString('en-IN')}` : (ord.failed_reason || ord.status);
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


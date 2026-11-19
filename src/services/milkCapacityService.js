/**
 * Milvanta Daily Milk Capacity Service
 * 
 * Manages daily farm procurement volumes (in Litres) for Cow and Buffalo milk.
 * Enforces transactional server-side capacity limits preventing over-booking
 * across one-time orders and recurring subscription deliveries.
 */

import { parseLitresFromSize } from '../pricing.js';

/**
 * Returns tomorrow's delivery date in Asia/Kolkata (IST) timezone formatted as YYYY-MM-DD.
 * Zero external module dependencies to avoid circular imports.
 */
export function getTomorrowDeliveryDateYMD() {
  const now = new Date();
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const istNow = new Date(utcMs + istOffsetMs);
  istNow.setDate(istNow.getDate() + 1);
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, '0');
  const d = String(istNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Pure milk volume parser (in Litres) supporting 500ml, 1L, 1.5L, 2 Litre, etc.
 * Zero external module dependencies.
 */
export function parseMilkVolumeInLitres(quantityStr, quantityNum = 1, options = {}) {
  const qNum = Math.max(1, Number(quantityNum) || 1);
  const returnObj = Boolean(options.returnObject || options.returnMetadata);
  if (!quantityStr || typeof quantityStr !== 'string') {
    if (options.strict) throw new Error('invalid_quantity_unit: empty or non-string quantity');
    return returnObj ? { litres: 0, recognized: false, unit: quantityStr || '' } : 0;
  }

  const str = quantityStr.trim().toLowerCase();

  // 1. Millilitres (e.g., 250ml, 500ml, 1000ml, 1500ml)
  const mlMatch = str.match(/^(\d+(?:\.\d+)?)\s*ml(?:\s*(?:pouch|bottle|pack))?$/i) ||
                  str.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) {
    const ml = parseFloat(mlMatch[1]);
    if (!isNaN(ml) && ml > 0) {
      const litres = (ml / 1000) * qNum;
      return returnObj ? { litres, recognized: true, unit: quantityStr } : litres;
    }
  }

  // 2. Litres (e.g., 1L, 1.5L, 2 Litre, 2.5 Litres, 0.5 Litre, 5 Litre)
  const lMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:l\b|litre|liter|ltr)(?:\s*(?:bottle|pouch|pack))?$/i) ||
                 str.match(/(\d+(?:\.\d+)?)\s*(?:l\b|litre|liter|ltr)/i);
  if (lMatch) {
    const l = parseFloat(lMatch[1]);
    if (!isNaN(l) && l > 0) {
      const litres = l * qNum;
      return returnObj ? { litres, recognized: true, unit: quantityStr } : litres;
    }
  }

  // 3. Known text fractions (e.g., "half litre", "1/2 litre")
  if (str.includes('half') || str.includes('1/2')) {
    const litres = 0.5 * qNum;
    return returnObj ? { litres, recognized: true, unit: quantityStr } : litres;
  }

  // 4. Raw numeric values
  const numMatch = str.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const val = parseFloat(numMatch[1]);
    if (val >= 100) {
      const litres = (val / 1000) * qNum;
      return returnObj ? { litres, recognized: true, unit: quantityStr } : litres;
    }
    if (val > 0) {
      const litres = val * qNum;
      return returnObj ? { litres, recognized: true, unit: quantityStr } : litres;
    }
  }

  if (options.strict) throw new Error(`unrecognized_milk_volume_unit: "${quantityStr}"`);
  return returnObj ? { litres: 0, recognized: false, unit: quantityStr } : 0;
}

/**
 * Determine milk type from product name or metadata
 * @param {string|object} productOrName 
 * @returns {'cow'|'buffalo'|null}
 */
export function identifyMilkType(productOrName) {
  if (!productOrName) return null;
  const name = typeof productOrName === 'string'
    ? productOrName.toLowerCase()
    : String(productOrName.name || productOrName.product_name || productOrName.category || '').toLowerCase();

  if (name.includes('buffalo')) return 'buffalo';
  if (name.includes('cow') || name.includes('fresh milk') || name.includes('milk')) return 'cow';
  return null;
}

/**
 * Calculate total milk litres for an order line or cart item
 * @param {object} item 
 * @returns {{ isMilk: boolean, milkType: 'cow'|'buffalo'|null, litres: number }}
 */
export function extractSubscriptionDailyLitres(quantityStr, quantityNum) {
  const num = Number(quantityNum);
  const fromSize = parseLitresFromSize(String(quantityStr || ''));

  if (num > 0) {
    if (fromSize > 0 && Math.abs(num - fromSize) < 0.001) {
      return fromSize;
    }
    if (num === 1 && fromSize > 0) {
      return fromSize;
    }
    if (fromSize <= 0) {
      return num;
    }
    // If num is an integer multiplier of fromSize (e.g. 2 x 1 Litre)
    if (fromSize > 0 && num > 1 && Math.abs(fromSize - 1.0) < 0.001) {
      return num;
    }
  }

  if (fromSize > 0) {
    return fromSize;
  }

  return parseMilkVolumeInLitres(String(quantityStr || ''), 1);
}

/**
 * Calculate total milk litres for an order line or cart item
 * @param {object} item 
 * @returns {{ isMilk: boolean, milkType: 'cow'|'buffalo'|null, litres: number }}
 */
export function calculateItemMilkLitres(item) {
  if (!item) return { isMilk: false, milkType: null, litres: 0 };
  const name = String(item.name || item.product_name || item.productName || '').toLowerCase();
  const category = String(item.category || '').toLowerCase();
  
  const isMilk = category === 'fresh milk' || /cow milk|buffalo milk/i.test(name) || item.productId === 101 || item.productId === 102;
  if (!isMilk) {
    return { isMilk: false, milkType: null, litres: 0 };
  }

  const milkType = identifyMilkType(name) || 'cow';
  const qty = Number(item.quantity || item.quantity_num || 1) || 1;
  const unitStr = String(item.unit || item.size || item.selling_unit || item.sellingUnit || '1 Litre');

  let litres = 0;
  try {
    litres = parseMilkVolumeInLitres(unitStr, qty);
  } catch {
    litres = parseLitresFromSize(unitStr) * qty;
  }

  return { isMilk: true, milkType, litres };
}

/**
 * Retrieve comprehensive milk capacity breakdown for a specific delivery date.
 * 
 * Total Available = Date Override (if set) OR Default Setting (cow/buffalo)
 * Committed Subscriptions = scheduled subscription drops on target date
 * Committed One-Time = paid or active-reservation one-time orders on target date
 * Remaining = max(0, Available - Committed)
 * 
 * @param {object} poolOrClient - pg Pool or Client
 * @param {string} [targetDate] - YYYY-MM-DD delivery date
 */
export async function getMilkCapacity(poolOrClient, targetDate) {
  const dateStr = (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate).trim()))
    ? String(targetDate).trim()
    : getTomorrowDeliveryDateYMD();

  // 1. Fetch default capacity and confirmation flags
  const defaultsRes = await poolOrClient.query(
    'SELECT milk_type, daily_litres, is_confirmed FROM milk_capacity_defaults'
  );
  let cowDefault = 100.0;
  let buffaloDefault = 80.0;
  let cowDefaultConfirmed = false;
  let buffaloDefaultConfirmed = false;

  for (const row of defaultsRes.rows) {
    if (row.milk_type === 'cow') {
      cowDefault = Number(row.daily_litres);
      cowDefaultConfirmed = Boolean(row.is_confirmed);
    }
    if (row.milk_type === 'buffalo') {
      buffaloDefault = Number(row.daily_litres);
      buffaloDefaultConfirmed = Boolean(row.is_confirmed);
    }
  }

  // 2. Fetch date-specific overrides
  const overridesRes = await poolOrClient.query(
    'SELECT id, milk_type, daily_litres, notes FROM milk_daily_capacity_overrides WHERE delivery_date = $1',
    [dateStr]
  );
  let cowAvailable = cowDefault;
  let buffaloAvailable = buffaloDefault;
  let cowHasOverride = false;
  let buffaloHasOverride = false;
  let cowOverrideNotes = null;
  let buffaloOverrideNotes = null;

  for (const row of overridesRes.rows) {
    if (row.milk_type === 'cow') {
      cowAvailable = Number(row.daily_litres);
      cowHasOverride = true;
      cowOverrideNotes = row.notes;
    }
    if (row.milk_type === 'buffalo') {
      buffaloAvailable = Number(row.daily_litres);
      buffaloHasOverride = true;
      buffaloOverrideNotes = row.notes;
    }
  }

  // An explicit date override by the owner verifies capacity for that date
  const cowIsConfirmed = cowHasOverride || cowDefaultConfirmed;
  const buffaloIsConfirmed = buffaloHasOverride || buffaloDefaultConfirmed;

  // 3. Calculate committed subscription litres
  // DEDUPLICATION: Avoid double counting when both generated delivery orders AND active subscriptions exist.
  let cowSubLitres = 0;
  let buffaloSubLitres = 0;
  let totalSubDrops = 0;

  // A. First count already generated delivery orders for target date
  const pregenOrders = await poolOrClient.query(
    `SELECT subscription_id, product_name, quantity, quantity_num
     FROM subscription_delivery_orders
     WHERE delivery_date = $1 AND status NOT IN ('cancelled', 'failed')`,
    [dateStr]
  );

  const generatedSubIds = new Set();
  for (const ord of pregenOrders.rows) {
    if (ord.subscription_id) {
      generatedSubIds.add(String(ord.subscription_id));
    }
    totalSubDrops++;
    const vol = extractSubscriptionDailyLitres(ord.quantity, ord.quantity_num);
    const type = identifyMilkType(ord.product_name) || 'cow';
    if (type === 'buffalo') {
      buffaloSubLitres += vol;
    } else {
      cowSubLitres += vol;
    }
  }

  // B. Next count active subscriptions eligible for targetDate that HAVE NOT been generated yet
  const activeSubs = await poolOrClient.query(
    `SELECT cs.id, cs.product_name, cs.quantity, cs.quantity_num, cs.notes, cs.created_at
     FROM customer_subscriptions cs
     WHERE cs.status = 'active'`
  );

  for (const sub of activeSubs.rows) {
    // If a delivery order was already generated for this subscription on this date, skip (already counted above)
    if (generatedSubIds.has(String(sub.id))) {
      continue;
    }

    const subNotes = typeof sub.notes === 'string'
      ? JSON.parse(sub.notes || '{}')
      : (sub.notes || {});

    // Determine start date
    const subStartDate = subNotes.startDate || subNotes.start_date ||
      (subNotes.start_at && Number.isFinite(Number(subNotes.start_at))
        ? new Date(Number(subNotes.start_at) * 1000).toISOString().slice(0, 10)
        : null) ||
      (sub.created_at ? new Date(sub.created_at).toISOString().slice(0, 10) : null);

    if (subStartDate && dateStr < subStartDate) {
      continue;
    }

    // Determine end date / paid-through date
    const paidThrough = subNotes.paidThroughDate || subNotes.current_period_end || subNotes.endDate;
    if (paidThrough && dateStr > paidThrough) {
      continue;
    }

    // Check pause periods
    const { rows: pauses } = await poolOrClient.query(
      `SELECT id FROM subscription_delivery_pauses
       WHERE subscription_id = $1
         AND pause_start_date <= $2
         AND (pause_end_date IS NULL OR pause_end_date >= $2)
         AND resumed_at IS NULL`,
      [sub.id, dateStr]
    );
    if (pauses.length > 0) {
      continue;
    }

    // Check skipped dates
    const { rows: skips } = await poolOrClient.query(
      `SELECT id FROM subscription_skipped_dates
       WHERE subscription_id = $1 AND skip_date = $2`,
      [sub.id, dateStr]
    );
    if (skips.length > 0) {
      continue;
    }

    // Eligible ungenerated subscription delivery
    totalSubDrops++;
    const vol = extractSubscriptionDailyLitres(sub.quantity, sub.quantity_num);
    const type = identifyMilkType(sub.product_name) || 'cow';
    if (type === 'buffalo') {
      buffaloSubLitres += vol;
    } else {
      cowSubLitres += vol;
    }
  }

  // C. Count recent pending_authorization subscriptions holding capacity (15-minute checkout reservation window)
  const pendingSubs = await poolOrClient.query(
    `SELECT id, product_name, quantity, quantity_num, notes, created_at
     FROM customer_subscriptions
     WHERE status = 'pending_authorization'
       AND created_at > (NOW() - INTERVAL '15 minutes')`
  );

  for (const pending of pendingSubs.rows) {
    const notes = typeof pending.notes === 'string'
      ? JSON.parse(pending.notes || '{}')
      : (pending.notes || {});

    // Derive actual subscription delivery start date (subscriptions deliver starting tomorrow morning or future date)
    let pStart = notes.startDate || notes.start_date;
    if (!pStart && notes.start_at && Number.isFinite(Number(notes.start_at))) {
      pStart = new Date(Number(notes.start_at) * 1000).toISOString().slice(0, 10);
    }
    if (!pStart) {
      pStart = getTomorrowDeliveryDateYMD();
    }
    const pDays = Math.max(1, Number(notes.days) || (Number(notes.months) || 1) * 30);

    // Check if targetDate falls within pending subscription window [startYMD, endYMD]
    const [sy, sm, sd] = pStart.split('-').map(Number);
    const startDt = new Date(Date.UTC(sy, sm - 1, sd));
    // Final delivery day of the continuous plan is startDt + (pDays - 1) days
    const endDt = new Date(Date.UTC(sy, sm - 1, sd + pDays - 1));
    const startYMD = startDt.toISOString().slice(0, 10);
    const endYMD = endDt.toISOString().slice(0, 10);

    if (dateStr >= startYMD && dateStr <= endYMD) {
      totalSubDrops++;
      const vol = extractSubscriptionDailyLitres(pending.quantity, pending.quantity_num);
      const type = identifyMilkType(pending.product_name) || 'cow';
      if (type === 'buffalo') {
        buffaloSubLitres += vol;
      } else {
        cowSubLitres += vol;
      }
    }
  }

  // 4. Calculate committed one-time order deliveries
  let cowOneTimeLitres = 0;
  let buffaloOneTimeLitres = 0;
  let totalOneTimeDrops = 0;

  const oneTimeOrders = await poolOrClient.query(
    `SELECT items, payment_status, order_status
     FROM customer_orders
     WHERE delivery_date = $1
       AND order_status NOT IN ('cancelled', 'refunded')
       AND (
         payment_status = 'paid'
         OR (payment_status IN ('pending', 'authorized') AND reservation_expires_at > NOW())
       )`,
    [dateStr]
  );

  for (const ord of oneTimeOrders.rows) {
    totalOneTimeDrops++;
    const items = Array.isArray(ord.items)
      ? ord.items
      : (typeof ord.items === 'string' ? JSON.parse(ord.items || '[]') : []);

    for (const item of items) {
      const calc = calculateItemMilkLitres(item);
      if (calc.isMilk) {
        if (calc.milkType === 'buffalo') {
          buffaloOneTimeLitres += calc.litres;
        } else {
          cowOneTimeLitres += calc.litres;
        }
      }
    }
  }

  // Round values cleanly to 2 decimal places
  const cowTotalCommitted = Number((cowSubLitres + cowOneTimeLitres).toFixed(2));
  const buffaloTotalCommitted = Number((buffaloSubLitres + buffaloOneTimeLitres).toFixed(2));

  const cowRemaining = Number(Math.max(0, cowAvailable - cowTotalCommitted).toFixed(2));
  const buffaloRemaining = Number(Math.max(0, buffaloAvailable - buffaloTotalCommitted).toFixed(2));

  return {
    date: dateStr,
    isConfirmed: cowIsConfirmed && buffaloIsConfirmed,
    cow: {
      availableLitres: Number(cowAvailable.toFixed(2)),
      total: Number(cowAvailable.toFixed(2)),
      subscriptionLitres: Number(cowSubLitres.toFixed(2)),
      oneTimeLitres: Number(cowOneTimeLitres.toFixed(2)),
      totalCommittedLitres: cowTotalCommitted,
      committedTotal: cowTotalCommitted,
      committedOneTime: Number(cowOneTimeLitres.toFixed(2)),
      committedSubscription: Number(cowSubLitres.toFixed(2)),
      remainingLitres: cowRemaining,
      remaining: cowRemaining,
      isConfirmed: cowIsConfirmed,
      isOverCapacity: cowTotalCommitted > cowAvailable,
      hasOverride: cowHasOverride,
      source: cowHasOverride ? 'override' : 'default',
      overrideNotes: cowOverrideNotes
    },
    buffalo: {
      availableLitres: Number(buffaloAvailable.toFixed(2)),
      total: Number(buffaloAvailable.toFixed(2)),
      subscriptionLitres: Number(buffaloSubLitres.toFixed(2)),
      oneTimeLitres: Number(buffaloOneTimeLitres.toFixed(2)),
      totalCommittedLitres: buffaloTotalCommitted,
      committedTotal: buffaloTotalCommitted,
      committedOneTime: Number(buffaloOneTimeLitres.toFixed(2)),
      committedSubscription: Number(buffaloSubLitres.toFixed(2)),
      remainingLitres: buffaloRemaining,
      remaining: buffaloRemaining,
      isConfirmed: buffaloIsConfirmed,
      isOverCapacity: buffaloTotalCommitted > buffaloAvailable,
      hasOverride: buffaloHasOverride,
      source: buffaloHasOverride ? 'override' : 'default',
      overrideNotes: buffaloOverrideNotes
    },
    total: {
      availableLitres: Number((cowAvailable + buffaloAvailable).toFixed(2)),
      subscriptionLitres: Number((cowSubLitres + buffaloSubLitres).toFixed(2)),
      oneTimeLitres: Number((cowOneTimeLitres + buffaloOneTimeLitres).toFixed(2)),
      totalCommittedLitres: Number((cowTotalCommitted + buffaloTotalCommitted).toFixed(2)),
      remainingLitres: Number((cowRemaining + buffaloRemaining).toFixed(2)),
      isConfirmed: cowIsConfirmed && buffaloIsConfirmed,
      isOverCapacity: (cowTotalCommitted + buffaloTotalCommitted) > (cowAvailable + buffaloAvailable),
      totalDeliveries: totalSubDrops + totalOneTimeDrops,
      subscriptionDrops: totalSubDrops,
      oneTimeDrops: totalOneTimeDrops
    }
  };
}

/**
 * Concurrency-safe capacity reservation for one-time orders.
 * Acquires a transactional lock on the target delivery date and milk type,
 * verifies sufficient capacity, and returns volume metrics.
 * 
 * @param {object} client - pg client inside an active BEGIN transaction
 * @param {object} options
 * @param {string} options.deliveryDate - YYYY-MM-DD
 * @param {Array} options.items - Cart items / order lines
 * @returns {Promise<{ ok: boolean, cowLitres: number, buffaloLitres: number, deliveryDate: string }>}
 */
export async function reserveMilkCapacityForOrder(client, { deliveryDate, items }) {
  const dateStr = (deliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate).trim()))
    ? String(deliveryDate).trim()
    : getTomorrowDeliveryDateYMD();

  let cowLitresNeeded = 0;
  let buffaloLitresNeeded = 0;

  for (const item of items) {
    const calc = calculateItemMilkLitres(item);
    if (calc.isMilk) {
      if (calc.milkType === 'buffalo') {
        buffaloLitresNeeded += calc.litres;
      } else {
        cowLitresNeeded += calc.litres;
      }
    }
  }

  // If no fresh milk is being ordered, pass through without locking
  if (cowLitresNeeded <= 0 && buffaloLitresNeeded <= 0) {
    return { ok: true, cowLitres: 0, buffaloLitres: 0, deliveryDate: dateStr };
  }

  // Acquire date & milk-type specific advisory transaction locks
  if (cowLitresNeeded > 0) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`milk_cap_${dateStr}_cow`]
    );
  }
  if (buffaloLitresNeeded > 0) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`milk_cap_${dateStr}_buffalo`]
    );
  }

  // Calculate current real capacity under lock
  const capacity = await getMilkCapacity(client, dateStr);

  // Check unconfirmed supply state
  if (cowLitresNeeded > 0 && !capacity.cow.isConfirmed) {
    const err = new Error(
      `Daily Cow Milk capacity for ${dateStr} has not been verified/confirmed by farm operations. Commitments are paused until verified.`
    );
    err.code = 'UNCONFIRMED_CAPACITY';
    err.milkType = 'cow';
    err.deliveryDate = dateStr;
    throw err;
  }

  if (buffaloLitresNeeded > 0 && !capacity.buffalo.isConfirmed) {
    const err = new Error(
      `Daily Buffalo Milk capacity for ${dateStr} has not been verified/confirmed by farm operations. Commitments are paused until verified.`
    );
    err.code = 'UNCONFIRMED_CAPACITY';
    err.milkType = 'buffalo';
    err.deliveryDate = dateStr;
    throw err;
  }

  if (cowLitresNeeded > 0 && cowLitresNeeded > capacity.cow.remainingLitres) {
    const err = new Error(
      `Daily Cow Milk capacity exceeded for ${dateStr}. Available: ${capacity.cow.remainingLitres}L, requested: ${cowLitresNeeded}L.`
    );
    err.code = 'INSUFFICIENT_CAPACITY';
    err.milkType = 'cow';
    err.requested = cowLitresNeeded;
    err.remaining = capacity.cow.remainingLitres;
    err.deliveryDate = dateStr;
    throw err;
  }

  if (buffaloLitresNeeded > 0 && buffaloLitresNeeded > capacity.buffalo.remainingLitres) {
    const err = new Error(
      `Daily Buffalo Milk capacity exceeded for ${dateStr}. Available: ${capacity.buffalo.remainingLitres}L, requested: ${buffaloLitresNeeded}L.`
    );
    err.code = 'INSUFFICIENT_CAPACITY';
    err.milkType = 'buffalo';
    err.requested = buffaloLitresNeeded;
    err.remaining = capacity.buffalo.remainingLitres;
    err.deliveryDate = dateStr;
    throw err;
  }

  return {
    ok: true,
    cowLitres: cowLitresNeeded,
    buffaloLitres: buffaloLitresNeeded,
    deliveryDate: dateStr
  };
}

/**
 * Concurrency-safe capacity check for subscription creation or activation.
 * Checks and commits subscription volume for EVERY eligible delivery date within the plan period.
 * 
 * @param {object} client - pg client inside an active BEGIN transaction
 * @param {object} options
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {number} [options.durationDays=30] - Total consecutive delivery days in subscription plan
 * @param {'cow'|'buffalo'} [options.milkType='cow']
 * @param {number} [options.litresPerDay=1]
 */
export async function checkSubscriptionCapacity(client, { startDate, durationDays = 30, milkType = 'cow', litresPerDay = 1 }) {
  const dateStr = (startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate).trim()))
    ? String(startDate).trim()
    : getTomorrowDeliveryDateYMD();

  const type = milkType === 'buffalo' ? 'buffalo' : 'cow';
  const duration = Math.max(1, Math.min(365, Number(durationDays) || 30));

  // Build the list of all delivery dates in chronological order
  const [y, m, d] = dateStr.split('-').map(Number);
  const dates = [];
  for (let i = 0; i < duration; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    dates.push(dt.toISOString().slice(0, 10));
  }

  // Acquire transactional advisory locks in strictly ascending chronological order
  // (strictly ordered locking eliminates the possibility of deadlocks between concurrent checkouts)
  for (const dt of dates) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`milk_cap_${dt}_${type}`]
    );
  }

  // Verify capacity for each date within the continuous plan
  for (const dt of dates) {
    const capacity = await getMilkCapacity(client, dt);

    if (!capacity[type].isConfirmed) {
      const err = new Error(
        `Daily ${type === 'buffalo' ? 'Buffalo' : 'Cow'} Milk supply capacity for ${dt} has not been confirmed by farm operations. Commitments are paused until verified.`
      );
      err.code = 'UNCONFIRMED_CAPACITY';
      err.milkType = type;
      err.exhaustedDate = dt;
      err.startDate = dateStr;
      throw err;
    }

    const remaining = capacity[type].remainingLitres;
    if (litresPerDay > remaining) {
      const err = new Error(
        `Daily ${type === 'buffalo' ? 'Buffalo' : 'Cow'} Milk subscription capacity reached for delivery date ${dt}. Available: ${remaining}L, required: ${litresPerDay}L/day.`
      );
      err.code = 'INSUFFICIENT_CAPACITY';
      err.milkType = type;
      err.requested = litresPerDay;
      err.remaining = remaining;
      err.exhaustedDate = dt;
      err.startDate = dateStr;
      throw err;
    }
  }

  return { ok: true, milkType: type, startDate: dateStr, durationDays: duration, litresPerDay };
}

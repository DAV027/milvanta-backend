/**
 * Milvanta Daily Milk Capacity Service
 * 
 * Manages daily farm procurement volumes (in Litres) for Cow and Buffalo milk.
 * Enforces transactional server-side capacity limits preventing over-booking
 * across one-time orders and recurring subscription deliveries.
 */

import { parseMilkVolumeInLitres } from '../server.js';
import { parseLitresFromSize } from '../pricing.js';
import { previewDailyDeliveries, getTomorrowDeliveryDateYMD } from './deliveryEngine.js';

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

  // 1. Fetch default capacity
  const defaultsRes = await poolOrClient.query(
    'SELECT milk_type, daily_litres FROM milk_capacity_defaults'
  );
  let cowDefault = 100.0;
  let buffaloDefault = 80.0;
  for (const row of defaultsRes.rows) {
    if (row.milk_type === 'cow') cowDefault = Number(row.daily_litres);
    if (row.milk_type === 'buffalo') buffaloDefault = Number(row.daily_litres);
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

  // 3. Calculate committed subscription litres
  let cowSubLitres = 0;
  let buffaloSubLitres = 0;
  let totalSubDrops = 0;

  const pregenOrders = await poolOrClient.query(
    `SELECT product_name, quantity, quantity_num
     FROM subscription_delivery_orders
     WHERE delivery_date = $1 AND status NOT IN ('cancelled', 'failed')`,
    [dateStr]
  );

  if (pregenOrders.rows.length > 0) {
    totalSubDrops = pregenOrders.rows.length;
    for (const ord of pregenOrders.rows) {
      const parsed = parseMilkVolumeInLitres(ord.quantity, Number(ord.quantity_num) || 1, { returnObject: true });
      const vol = parsed.litres;
      const type = identifyMilkType(ord.product_name) || 'cow';
      if (type === 'buffalo') {
        buffaloSubLitres += vol;
      } else {
        cowSubLitres += vol;
      }
    }
  } else {
    // Subscriptions not pre-generated into subscription_delivery_orders yet;
    // calculate from eligible active subscriptions using preview engine
    const preview = await previewDailyDeliveries(poolOrClient, dateStr);
    totalSubDrops = preview.eligibleCount || 0;
    for (const sub of preview.eligibleSubscriptions || []) {
      const parsed = parseMilkVolumeInLitres(sub.quantity, Number(sub.quantityNum) || 1, { returnObject: true });
      const vol = parsed.litres;
      const type = identifyMilkType(sub.productName) || 'cow';
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
 * 
 * @param {object} client - pg client inside an active BEGIN transaction
 * @param {object} options
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {'cow'|'buffalo'} options.milkType
 * @param {number} options.litresPerDay
 */
export async function checkSubscriptionCapacity(client, { startDate, milkType = 'cow', litresPerDay = 1 }) {
  const dateStr = (startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate).trim()))
    ? String(startDate).trim()
    : getTomorrowDeliveryDateYMD();

  const type = milkType === 'buffalo' ? 'buffalo' : 'cow';

  // Acquire advisory lock
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`milk_cap_${dateStr}_${type}`]
  );

  const capacity = await getMilkCapacity(client, dateStr);
  const remaining = capacity[type].remainingLitres;

  if (litresPerDay > remaining) {
    const err = new Error(
      `Daily ${type === 'buffalo' ? 'Buffalo' : 'Cow'} Milk subscription capacity reached for starting date ${dateStr}. Available: ${remaining}L, required: ${litresPerDay}L/day.`
    );
    err.code = 'INSUFFICIENT_CAPACITY';
    err.milkType = type;
    err.requested = litresPerDay;
    err.remaining = remaining;
    err.startDate = dateStr;
    throw err;
  }

  return { ok: true, milkType: type, date: dateStr, remaining };
}

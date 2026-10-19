/**
 * Milvanta Centralized Server-Side Pricing Engine
 * 
 * Authoritative source of pricing rules for products, variants, and milk subscriptions.
 * Replaces any client-supplied pricing overrides (such as customPricePaise).
 */

// Supported pack sizes for Fresh Milk subscriptions (0.5L to 5.0L)
export const APPROVED_MILK_PACK_SIZES = [
  '500 ml',
  '1 Litre',
  '1.5 Litre',
  '2 Litre',
  '2.5 Litre',
  '3 Litre',
  '3.5 Litre',
  '4 Litre',
  '4.5 Litre',
  '5 Litre'
];

/**
 * Approved variants registry for products with multiple sizes.
 * Keys can match product IDs or normalized product names.
 */
export const APPROVED_PRODUCT_VARIANTS = {
  // Fresh Cow Milk (one-time purchase variants)
  cow_milk: {
    '500 ml': 6000,
    '500 ml pouch': 6000,
    '1 Litre': 11000,
    '1 L': 11000,
    '1 Litre bottle': 11000,
    '1.5 Litre': 17000,
    '2 Litre': 22000,
    '2.5 Litre': 28000,
    '3 Litre': 33000,
    '3.5 Litre': 39000,
    '4 Litre': 44000,
    '4.5 Litre': 50000,
    '5 Litre': 55000
  },
  // Fresh Buffalo Milk (one-time purchase variants)
  buffalo_milk: {
    '500 ml': 7000,
    '500 ml bottle': 7000,
    '1 Litre': 13000,
    '1 L': 13000,
    '1 Litre bottle': 13000,
    '1.5 Litre': 20000,
    '2 Litre': 26000,
    '2.5 Litre': 33000,
    '3 Litre': 39000,
    '3.5 Litre': 46000,
    '4 Litre': 52000,
    '4.5 Litre': 59000,
    '5 Litre': 65000
  },
  // Paneer variants
  paneer: {
    '500 g': 40000,
    '500 g pack': 40000,
    '1 kg': 75000,
    '1 kg pack': 75000
  },
  // Pot Curd variants
  pot_curd: {
    '200 g': 4900,
    '200 g pot': 4900,
    '500 g': 9900,
    '500 g pot': 9900,
    '1 kg': 16900,
    '1 kg pot': 16900,
    '3 kg': 49900,
    '3 kg pot': 49900,
    '6 kg': 79900,
    '6 kg pot': 79900
  },
  // Pure Desi Cow Ghee variants
  pure_cow_ghee: {
    '500 g': 150000,
    '500 g jar': 150000,
    '1 kg': 280000,
    '1 kg jar': 280000
  },
  // Pure Buffalo Ghee variants
  pure_buffalo_ghee: {
    '500 g': 110000,
    '500 g jar': 110000,
    '1 kg': 200000,
    '1 kg jar': 200000
  }
};

/**
 * Normalizes size strings for lookup (e.g. "1 litre" -> "1 Litre")
 */
export function normalizeSizeKey(rawSize) {
  if (!rawSize || typeof rawSize !== 'string') return '';
  const s = rawSize.trim().toLowerCase();
  if (s.includes('500') && s.includes('ml')) return '500 ml';
  if (s.includes('1.5') && (s.includes('l') || s.includes('litre'))) return '1.5 Litre';
  if (s.includes('2.5') && (s.includes('l') || s.includes('litre'))) return '2.5 Litre';
  if (s.includes('3.5') && (s.includes('l') || s.includes('litre'))) return '3.5 Litre';
  if (s.includes('4.5') && (s.includes('l') || s.includes('litre'))) return '4.5 Litre';
  if (s.startsWith('1') && (s.includes('l') || s.includes('litre')) && !s.includes('1.5')) return '1 Litre';
  if (s.startsWith('2') && (s.includes('l') || s.includes('litre')) && !s.includes('2.5')) return '2 Litre';
  if (s.startsWith('3') && (s.includes('l') || s.includes('litre')) && !s.includes('3.5')) return '3 Litre';
  if (s.startsWith('4') && (s.includes('l') || s.includes('litre')) && !s.includes('4.5')) return '4 Litre';
  if (s.startsWith('5') && (s.includes('l') || s.includes('litre'))) return '5 Litre';
  if (s.includes('200') && s.includes('g')) return '200 g';
  if (s.includes('500') && s.includes('g')) return '500 g';
  if (s.includes('1') && s.includes('kg')) return '1 kg';
  if (s.includes('3') && s.includes('kg')) return '3 kg';
  if (s.includes('6') && s.includes('kg')) return '6 kg';
  return rawSize.trim();
}

/**
 * Parses numeric litres from a size string.
 */
export function parseLitresFromSize(sizeStr) {
  const s = String(sizeStr || '').toLowerCase().trim();
  if (s.includes('500') || s.includes('1/2') || s.includes('half')) return 0.5;
  const match = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) return parseFloat(match[1]);
  return 1.0;
}
export const parseMilkLitres = parseLitresFromSize;

/**
 * Determines product key for variant lookup.
 */
export function getProductVariantKey(product) {
  const name = String(product?.name || '').toLowerCase();
  const id = Number(product?.id || 0);

  if (id === 101 || id === 1 || (name.includes('cow') && name.includes('milk'))) return 'cow_milk';
  if (id === 102 || id === 2 || (name.includes('buffalo') && name.includes('milk'))) return 'buffalo_milk';
  if (id === 104 || id === 3 || name.includes('paneer')) return 'paneer';
  if (id === 105 || id === 4 || name.includes('curd')) return 'pot_curd';
  if (id === 103 || (name.includes('cow') && name.includes('ghee'))) return 'pure_cow_ghee';
  if (id === 106 || (name.includes('buffalo') && name.includes('ghee'))) return 'pure_buffalo_ghee';
  return null;
}

/**
 * Checks if a product is a fresh milk product eligible for morning subscriptions.
 */
export function isFreshMilkProduct(product) {
  if (!product) return false;
  const name = String(product.name || '').toLowerCase();
  const cat = String(product.category || '').toLowerCase();
  const id = Number(product.id || 0);
  return id === 101 || id === 102 || id === 1 || id === 2 || cat.includes('milk') || name.includes('milk');
}

/**
 * Calculates authoritative daily subscription rate in paise for milk.
 */
export function getMilkDailySubscriptionRatePaise(product, sizeStr) {
  const name = typeof product === 'string' ? product.toLowerCase() : String(product?.name || '').toLowerCase();
  const id = typeof product === 'object' ? Number(product?.id || 0) : 0;
  const isBuffalo = id === 102 || id === 2 || name.includes('buffalo');
  const litres = parseLitresFromSize(sizeStr || '1 Litre');

  // Rates in paise:
  // Buffalo: 500ml = 6500 (₹65), 1L = 12500 (₹125)
  // Cow: 500ml = 5500 (₹55), 1L = 10500 (₹105)
  const subRate500Paise = isBuffalo ? 6500 : 5500;
  const subRate1LPaise = isBuffalo ? 12500 : 10500;

  if (Math.abs(litres - 0.5) < 0.05) {
    return subRate500Paise;
  }

  const fullL = Math.floor(litres);
  const hasHalf = (litres % 1) >= 0.45;
  return (fullL * subRate1LPaise) + (hasHalf ? subRate500Paise : 0);
}

/**
 * Calculates authoritative one-time purchase rate in paise for milk.
 * Rates:
 * Cow: 500ml = ₹60 (6000), 1L = ₹110 (11000)
 * Buffalo: 500ml = ₹70 (7000), 1L = ₹130 (13000)
 */
export function getMilkOneTimeRatePaise(product, sizeStr) {
  const name = typeof product === 'string' ? product.toLowerCase() : String(product?.name || '').toLowerCase();
  const id = typeof product === 'object' ? Number(product?.id || 0) : 0;
  const isBuffalo = id === 102 || id === 2 || name.includes('buffalo');
  const litres = parseLitresFromSize(sizeStr || '500 ml');

  const otRate500Paise = isBuffalo ? 7000 : 6000;
  const otRate1LPaise = isBuffalo ? 13000 : 11000;

  if (Math.abs(litres - 0.5) < 0.05) {
    return otRate500Paise;
  }

  const fullL = Math.floor(litres);
  const hasHalf = (litres % 1) >= 0.45;
  return (fullL * otRate1LPaise) + (hasHalf ? otRate500Paise : 0);
}

/**
 * Calculates calendar days for consecutive subscription months.
 */
export function calculateContinuousMonthsDays(startOffset = 0, count = 1, referenceDate = new Date()) {
  const safeOffset = Math.max(0, Math.min(12, Number(startOffset) || 0));
  const safeCount = Math.max(1, Math.min(12, Number(count) || 1));
  let totalDays = 0;

  for (let i = 0; i < safeCount; i++) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + safeOffset + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    totalDays += daysInMonth;
  }

  return totalDays;
}

/**
 * Computes trusted unit price in paise for any cart item.
 * Strictly ignores client-provided customPricePaise or pricePaise overrides.
 * 
 * @param {object} product - Database product row
 * @param {object} item - Incoming item payload from client
 * @returns {object} { unitPricePaise, resolvedName, resolvedUnit, isSubscription }
 */
export function resolveItemPricing(product, item = {}) {
  const rawSize = item.size || item.variant?.size || '';
  const normalizedSize = normalizeSizeKey(rawSize);

  const isContinuous = Boolean(
    item.isContinuousMonthsPlan || 
    item.variant?.isContinuousMonthsPlan ||
    (item.subscriptionPlan && (item.subscriptionPlan.planType === 'month' || item.subscriptionPlan.monthsCount))
  );

  const isCustomDays = Boolean(
    item.isCustomDaysPlan || 
    item.variant?.isCustomDaysPlan ||
    (item.subscriptionPlan && item.subscriptionPlan.days && !item.isContinuousMonthsPlan) ||
    item.customDays
  );

  // CASE 1: Custom Days Subscription Plan (evaluated before continuous if days specified)
  if (isCustomDays) {
    if (!isFreshMilkProduct(product)) {
      throw new Error(`Product ${product.name} is not eligible for custom-days milk plans.`);
    }

    const subData = item.subscriptionPlan || item.variant?.subscriptionPlan || {};
    const effectiveSize = subData.size || normalizedSize || '1 Litre';
    const daysCount = Math.max(1, Math.min(90, Number(subData.days || item.days || item.daysCount || item.variant?.days || item.customDays) || 30));
    const dailyRatePaise = getMilkDailySubscriptionRatePaise(product, effectiveSize);
    const totalPlanAmountPaise = daysCount * dailyRatePaise;

    return {
      unitPricePaise: totalPlanAmountPaise,
      resolvedName: product.name,
      resolvedUnit: `${effectiveSize} (${daysCount} Custom Days · ₹${dailyRatePaise / 100}/day)`,
      isSubscription: true,
      dailyRatePaise,
      totalDays: daysCount,
      effectiveSize
    };
  }

  // CASE 2: Continuous Months Subscription Plan
  if (isContinuous) {
    if (!isFreshMilkProduct(product)) {
      throw new Error(`Product ${product.name} is not eligible for subscription plans.`);
    }

    const subData = item.subscriptionPlan || item.variant?.subscriptionPlan || {};
    const effectiveSize = subData.size || normalizedSize || '1 Litre';
    const monthsCount = Math.max(1, Math.min(12, Number(subData.monthsCount || item.monthsCount || item.variant?.monthsCount) || 1));
    const startOffset = Math.max(0, Math.min(12, Number(subData.startOffset || item.startOffset || item.variant?.startOffset) || 0));

    const dailyRatePaise = getMilkDailySubscriptionRatePaise(product, effectiveSize);
    const totalDays = calculateContinuousMonthsDays(startOffset, monthsCount);
    const totalPlanAmountPaise = totalDays * dailyRatePaise;

    return {
      unitPricePaise: totalPlanAmountPaise,
      resolvedName: product.name,
      resolvedUnit: `${effectiveSize} (${monthsCount} Mo / ${totalDays} Days · ₹${dailyRatePaise / 100}/day)`,
      isSubscription: true,
      dailyRatePaise,
      totalDays,
      monthsCount,
      effectiveSize
    };
  }

  // CASE 2: Custom Days Subscription Plan
  if (isCustomDays) {
    if (!isFreshMilkProduct(product)) {
      throw new Error(`Product ${product.name} is not eligible for custom-days milk plans.`);
    }

    const effectiveSize = normalizedSize || '1 Litre';
    const daysCount = Math.max(1, Math.min(90, Number(item.days || item.daysCount || item.variant?.days) || 30));
    const dailyRatePaise = getMilkDailySubscriptionRatePaise(product, effectiveSize);
    const totalPlanAmountPaise = daysCount * dailyRatePaise;

    return {
      unitPricePaise: totalPlanAmountPaise,
      resolvedName: product.name,
      resolvedUnit: `${effectiveSize} (${daysCount} Custom Days · ₹${dailyRatePaise / 100}/day)`,
      isSubscription: true,
      dailyRatePaise,
      totalDays: daysCount,
      effectiveSize
    };
  }

  // CASE 3: Standard Product with Size Variant
  const variantKey = getProductVariantKey(product);
  if (variantKey && APPROVED_PRODUCT_VARIANTS[variantKey]) {
    const variantMap = APPROVED_PRODUCT_VARIANTS[variantKey];

    if (normalizedSize && variantMap[normalizedSize] !== undefined) {
      return {
        unitPricePaise: variantMap[normalizedSize],
        resolvedName: product.name,
        resolvedUnit: normalizedSize,
        isSubscription: false
      };
    }

    if (rawSize && variantMap[rawSize] !== undefined) {
      return {
        unitPricePaise: variantMap[rawSize],
        resolvedName: product.name,
        resolvedUnit: rawSize,
        isSubscription: false
      };
    }

    if (isFreshMilkProduct(product)) {
      const unitPricePaise = getMilkOneTimeRatePaise(product, rawSize || normalizedSize || product.selling_unit);
      return {
        unitPricePaise,
        resolvedName: product.name,
        resolvedUnit: normalizedSize || rawSize || product.selling_unit || '500 ml',
        isSubscription: false
      };
    }
  }

  // CASE 4: Standard Base Product Price
  return {
    unitPricePaise: Number(product.price_paise),
    resolvedName: product.name,
    resolvedUnit: product.selling_unit || '1 Unit',
    isSubscription: false
  };
}

export default {
  APPROVED_MILK_PACK_SIZES,
  APPROVED_PRODUCT_VARIANTS,
  normalizeSizeKey,
  parseLitresFromSize,
  getProductVariantKey,
  isFreshMilkProduct,
  getMilkDailySubscriptionRatePaise,
  getMilkOneTimeRatePaise,
  calculateContinuousMonthsDays,
  resolveItemPricing
};

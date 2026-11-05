/**
 * Paid-delivery coverage is independent of Razorpay's billing cycle end.
 * A one-cycle, 30-delivery plan buys 30 eligible delivery mornings from the
 * first morning permitted by the 20:00 IST cutoff, NOT 30 calendar dates
 * beginning at the instant a mandate was created.
 *
 * The policy is opt-in and must only be recorded after a captured cycle
 * payment is authoritatively confirmed by the existing verification code.
 */
export const FIXED_30_DELIVERIES_POLICY = 'fixed_30_deliveries_v1';
const DAY_MS = 86400000;
const DAY_COUNT = 30;

function validYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0,10)===value;
}

export function shiftDeliveryDate(ymd, delta) {
  if (!validYmd(ymd) || !Number.isInteger(delta) || delta < -3660 || delta > 3660) {
    throw new Error('invalid_delivery_date_shift');
  }
  return new Date(Date.parse(ymd + 'T00:00:00Z') + delta * DAY_MS).toISOString().slice(0,10);
}

export function firstEligibleDeliveryDate(instant, requestedStartDate = null) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error('invalid_payment_confirmation_instant');
  }
  const components = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hourCycle:'h23',
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit'
  }).formatToParts(instant);
  const get = key => components.find(c => c.type===key)?.value;
  const today = get('year') + '-' + get('month') + '-' + get('day');
  const hour = Number(get('hour'));
  if (!validYmd(today) || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('invalid_ist_delivery_instant');
  }
  const earliest = shiftDeliveryDate(today, hour >= 20 ? 2 : 1);
  if (requestedStartDate !== null && requestedStartDate !== undefined) {
    if (!validYmd(requestedStartDate)) throw new Error('invalid_requested_delivery_start_date');
    return requestedStartDate > earliest ? requestedStartDate : earliest;
  }
  return earliest;
}

/**
 * Only a single paid cycle for a 30-day contract qualifies. This function
 * DOES NOT verify payments; caller must have already verified captured
 * payment, plan amount, subscription identity and customer ownership.
 * Existing coverage is never recalculated from replayed/late events.
 */
export function buildFixed30DeliveryCoverage({
  notes, paymentConfirmedAt, totalAmountPaise, dailyRatePaise, paidCount
}) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return null;
  if (notes.deliveryCoveragePolicy !== undefined) return null;
  if (notes.deliveryCoverageOptIn !== FIXED_30_DELIVERIES_POLICY) return null;
  if (Number(notes.months) !== 1 || Number(notes.days) !== DAY_COUNT) return null;
  if (Number(paidCount) !== 1) return null;
  if (!Number.isSafeInteger(Number(dailyRatePaise)) || Number(dailyRatePaise) <= 0 ||
      !Number.isSafeInteger(Number(totalAmountPaise)) ||
      Number(totalAmountPaise) !== Number(dailyRatePaise) * DAY_COUNT) return null;
  const when = paymentConfirmedAt instanceof Date ? paymentConfirmedAt : null;
  if (!when || Number.isNaN(when.getTime())) return null;
  const requested = typeof notes.startDate === 'string' && notes.startDate
    ? notes.startDate : null;
  let startDate;
  try { startDate = firstEligibleDeliveryDate(when, requested); }
  catch { return null; }
  return {
    deliveryCoveragePolicy: FIXED_30_DELIVERIES_POLICY,
    deliveryCoverageDays: DAY_COUNT,
    deliveryFirstDate: startDate,
    deliveryLastDate: shiftDeliveryDate(startDate, DAY_COUNT - 1)
  };
}

/**
 * Validate coverage against the existing trusted billed-cycle payment record
 * before it can ever affect eligibility. Existing legacy subscriptions and
 * non-one-cycle mandates remain governed by their usual paidThroughDate.
 */
export function validatedFixedDeliveryCoverage(sub) {
  const notes = sub?.notes;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes) ||
      notes.deliveryCoveragePolicy !== FIXED_30_DELIVERIES_POLICY ||
      notes.deliveryCoverageOptIn !== FIXED_30_DELIVERIES_POLICY ||
      notes.deliveryCoverageDays !== DAY_COUNT ||
      Number(notes.months) !== 1 || Number(notes.days) !== DAY_COUNT ||
      notes.fulfillmentEntitled !== true || Number(notes.paidCount) !== 1 ||
      !String(notes.lastPaymentId || '').trim() ||
      notes.authType === 'mandate_only' ||
      !(typeof sub.razorpay_subscription_id === 'string' &&
        sub.razorpay_subscription_id.startsWith('sub_'))) return null;

  const dailyRate = Number(sub.cost_per_day_paise);
  const contractAmount = Number(sub.total_amount_paise);
  if (!Number.isSafeInteger(dailyRate) || dailyRate <= 0 ||
      !Number.isSafeInteger(contractAmount) || contractAmount !== dailyRate * DAY_COUNT ||
      !validYmd(notes.deliveryFirstDate) || !validYmd(notes.deliveryLastDate) ||
      notes.deliveryLastDate !== shiftDeliveryDate(notes.deliveryFirstDate, DAY_COUNT-1)) {
    return null;
  }
  return {firstDate:notes.deliveryFirstDate,lastDate:notes.deliveryLastDate,days:DAY_COUNT};
}

/* Customer-facing estimate only; the backend remains authoritative for payment and delivery. */
(function (scope) {
  'use strict';

  function istParts(now = new Date()) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('invalid_delivery_estimate_clock');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
    const part = key => Number(parts.find(p => p.type === key)?.value);
    return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour') };
  }

  function currentIstYearMonth(now = new Date()) {
    const { year, month } = istParts(now);
    return { year, monthIndex: month - 1 };
  }

  function earliestFirstDeliveryYMD({ now = new Date(), startOffset = 0 } = {}) {
    const { year, month, day, hour } = istParts(now);
    const offset = Number(startOffset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 12) {
      throw new Error('invalid_delivery_start_month_offset');
    }
    const earliest = new Date(Date.UTC(year, month - 1, day + (hour >= 20 ? 2 : 1)))
      .toISOString().slice(0, 10);
    if (offset === 0) return earliest;
    const requested = new Date(Date.UTC(year, month - 1 + offset, 1))
      .toISOString().slice(0, 10);
    return requested > earliest ? requested : earliest;
  }

  function formatYMD(ymd) {
    if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw new Error('invalid_delivery_estimate_date');
    }
    const dt = new Date(ymd + 'T00:00:00Z');
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== ymd) {
      throw new Error('invalid_delivery_estimate_date');
    }
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'
    }).format(dt);
  }

  scope.MilvantaSubscriptionSchedule = Object.freeze({
    earliestFirstDeliveryYMD,
    currentIstYearMonth,
    formatYMD
  });
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Read-only coverage exposure for a *proposed* recurring month purchase.
 * Does not grant entitlement, create a billing credit, change gateway cycles,
 * refund, schedule physical delivery, or infer that a payment was captured.
 */
import { calculateContinuousMonthsDays } from '../pricing.js';
import { getEarliestPermittedDeliveryDateYMD } from './deliveryCronPolicy.js';

const ymd = date => date.toISOString().slice(0, 10);

export function previewRecurringFirstCycleCoverage({
  checkoutAt = new Date(),
  startOffset = 0,
  monthsCount = 1,
  dailyRatePaise = 0
} = {}) {
  if (!(checkoutAt instanceof Date) || Number.isNaN(checkoutAt.getTime())) {
    throw new Error('invalid_recurring_coverage_clock');
  }
  if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset > 12) {
    throw new Error('invalid_recurring_start_offset');
  }
  if (!Number.isInteger(monthsCount) || monthsCount < 1 || monthsCount > 12) {
    throw new Error('invalid_recurring_months_count');
  }
  if (!Number.isSafeInteger(dailyRatePaise) || dailyRatePaise < 0) {
    throw new Error('invalid_recurring_daily_rate');
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit'
  }).formatToParts(checkoutAt);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const monthIndex = Number(parts.find(p => p.type === 'month')?.value) - 1;
  const monthStart = new Date(Date.UTC(year, monthIndex + startOffset, 1));
  const cycleStart = ymd(monthStart);
  const cycleEnd = ymd(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)));
  const firstPossibleDate = getEarliestPermittedDeliveryDateYMD(checkoutAt, cycleStart);
  const monthDays = new Date(cycleEnd + 'T00:00:00Z').getUTCDate();
  const endMs = new Date(cycleEnd + 'T00:00:00Z').getTime();
  const firstMs = new Date(firstPossibleDate + 'T00:00:00Z').getTime();
  const possibleDaysInFirstCycle = Math.max(0, Math.floor((endMs - firstMs) / 86400000) + 1);
  const initiallyUnservableDays = monthDays - possibleDaysInFirstCycle;
  const totalContractDays = calculateContinuousMonthsDays(startOffset, monthsCount, checkoutAt);
  return {
    firstCycleStart: cycleStart,
    firstCycleEnd: cycleEnd,
    earliestEligibleDate: firstPossibleDate,
    firstCycleCalendarDays: monthDays,
    possibleDaysInFirstCycle,
    initiallyUnservableDays,
    totalContractDays,
    estimatedFirstCycleExposurePaise: initiallyUnservableDays * dailyRatePaise,
    reviewRequired: initiallyUnservableDays > 0,
    policyState: initiallyUnservableDays > 0 ? 'merchant_billing_policy_required' : 'no_initial_cutoff_gap_detected',
    disclosure: 'Optimistic estimate only; actual captured payment, serviceability and order generation may delay fulfillment. Does not modify billing.'
  };
}

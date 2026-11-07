import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateContinuousMonthsDays } from '../src/pricing.js';
import { previewRecurringFirstCycleCoverage } from '../src/services/recurringCoverageAudit.js';

test('backend calendar day pricing uses IST at month rollover, not UTC server date', () => {
  assert.equal(calculateContinuousMonthsDays(0, 1, new Date('2026-11-30T18:29:59Z')), 30);
  assert.equal(calculateContinuousMonthsDays(0, 1, new Date('2026-11-30T18:30:00Z')), 31);
  assert.equal(calculateContinuousMonthsDays(1, 1, new Date('2026-11-30T18:30:00Z')), 31);
  assert.equal(calculateContinuousMonthsDays(0, 2, new Date('2026-11-30T18:30:00Z')), 62);
  assert.equal(calculateContinuousMonthsDays(0, 1, new Date('2024-02-15T12:00:00Z')), 29);
  assert.equal(calculateContinuousMonthsDays(0, 1, new Date('2026-02-15T12:00:00Z')), 28);
});

test('current-month recurring plan at/after 20:00 IST exposes missed paid mornings', () => {
  const result = previewRecurringFirstCycleCoverage({
    checkoutAt: new Date('2026-11-06T14:30:00Z'), // 20:00:00 IST
    startOffset: 0, monthsCount: 1, dailyRatePaise: 10500
  });
  assert.equal(result.firstCycleStart, '2026-11-01');
  assert.equal(result.firstCycleEnd, '2026-11-30');
  assert.equal(result.earliestEligibleDate, '2026-11-08');
  assert.equal(result.firstCycleCalendarDays, 30);
  assert.equal(result.possibleDaysInFirstCycle, 23);
  assert.equal(result.initiallyUnservableDays, 7);
  assert.equal(result.totalContractDays, 30);
  assert.equal(result.estimatedFirstCycleExposurePaise, 73500);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.policyState, 'merchant_billing_policy_required');
});

test('before cutoff day difference is visible without guessing payment capture success', () => {
  const result = previewRecurringFirstCycleCoverage({
    checkoutAt: new Date('2026-11-06T14:29:59Z'),
    dailyRatePaise: 10500
  });
  assert.equal(result.earliestEligibleDate, '2026-11-07');
  assert.equal(result.initiallyUnservableDays, 6);
  assert.equal(result.estimatedFirstCycleExposurePaise, 63000);
  assert.match(result.disclosure, /estimate only/i);
});

test('future December start avoids known calendar shortfall, but does not promise dispatch', () => {
  const result = previewRecurringFirstCycleCoverage({
    checkoutAt: new Date('2026-11-06T14:30:00Z'),
    startOffset: 1, monthsCount: 1, dailyRatePaise: 10500
  });
  assert.equal(result.firstCycleStart, '2026-12-01');
  assert.equal(result.earliestEligibleDate, '2026-12-01');
  assert.equal(result.initiallyUnservableDays, 0);
  assert.equal(result.totalContractDays, 31);
  assert.equal(result.reviewRequired, false);
  assert.match(result.disclosure, /actual captured payment/i);
});

test('midnight IST month rollover re-prices the correct December cycle', () => {
  const result = previewRecurringFirstCycleCoverage({
    checkoutAt: new Date('2026-11-30T18:30:00Z'),
    dailyRatePaise: 5500
  });
  assert.equal(result.firstCycleStart, '2026-12-01');
  assert.equal(result.earliestEligibleDate, '2026-12-02');
  assert.equal(result.initiallyUnservableDays, 1);
  assert.equal(result.estimatedFirstCycleExposurePaise, 5500);
});

test('read-only coverage audit rejects invalid input', () => {
  assert.throws(() => previewRecurringFirstCycleCoverage({ checkoutAt: new Date(NaN) }), /invalid_recurring_coverage_clock/);
  assert.throws(() => previewRecurringFirstCycleCoverage({ startOffset: -1 }), /invalid_recurring_start_offset/);
  assert.throws(() => previewRecurringFirstCycleCoverage({ monthsCount: 13 }), /invalid_recurring_months_count/);
  assert.throws(() => previewRecurringFirstCycleCoverage({ dailyRatePaise: -1 }), /invalid_recurring_daily_rate/);
});

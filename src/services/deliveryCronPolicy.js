/**
 * Pure policy for the externally scheduled, secret-authenticated daily delivery
 * generation endpoint. No database, network or timer side-effects.
 *
 * Operational cron cadence: 20:15 IST / 14:45 UTC, once per calendar day.
 * Delivery orders are generated for the NEXT morning, never for an elapsed day.
 *
 * Cron scheduling must be hosted independently of the Render web process,
 * which may sleep or restart; see docs/DAILY_DELIVERY_CRON_RUNBOOK.md.
 */

import crypto from 'node:crypto';

const ZONE = 'Asia/Kolkata';
const CUTOFF_HOUR_IST = 20;

function istComponents(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = key => Number(parts.find(p => p.type === key)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  if (![year,month,day,hour].every(Number.isInteger) ||
      year < 2020 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23) {
    throw new Error('invalid_ist_delivery_cron_time');
  }
  return {year,month,day,hour};
}

export function getDeliveryCronTarget(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('invalid_delivery_cron_clock');
  }
  const {year,month,day,hour} = istComponents(now);
  if (hour < CUTOFF_HOUR_IST) {
    return {allowed:false, reason:'before_daily_delivery_cutoff'};
  }
  const targetDate = new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
  return {allowed:true,targetDate};
}

export function isValidDeliveryWorkerSecret(secret) {
  return typeof secret === 'string' && secret.length >= 32 &&
    secret.length <= 512 && secret.trim() === secret;
}

export function verifyDeliveryWorkerSecret(supplied, expected) {
  if (!isValidDeliveryWorkerSecret(expected) ||
      typeof supplied !== 'string' ||
      supplied.length < 32 || supplied.length > 512) return false;
  const known = crypto.createHash('sha256').update(expected,'utf8').digest();
  const incoming = crypto.createHash('sha256').update(supplied,'utf8').digest();
  return crypto.timingSafeEqual(known,incoming);
}

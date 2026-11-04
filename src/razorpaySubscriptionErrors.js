/**
 * Classify only documented Razorpay subscription-creation failures.
 *
 * Provider error descriptions may contain account details or arbitrary text.
 * They are NEVER logged, sent to customers, or returned from this function.
 * New/unrecognized descriptions fail closed to "unclassified".
 */

export const GATEWAY_REASON_STANDARDS = Object.freeze({
  subscription_endpoint_unavailable: 'subscription_feature_unavailable',
  invoices_disabled_customer_fee_bearer: 'invoices_disabled_customer_fee_bearer',
  plan_reference_rejected: 'invalid_plan_reference',
  invalid_subscription_start: 'invalid_start_timestamp',
  invalid_billing_cycle_count: 'invalid_total_count',
  invalid_customer_notify: 'invalid_customer_notify',
  invalid_quantity: 'invalid_quantity',
  invalid_subscription_payload: 'unsupported_payload_field',
  unclassified: 'unclassified_gateway_rejection'
});

export function standardizeSubscriptionGatewayError(reason) {
  return GATEWAY_REASON_STANDARDS[reason] || reason || 'unclassified_gateway_rejection';
}

export function classifySubscriptionGatewayError(err) {
  if (!err) return 'unclassified';

  // 1. Direct authoritative inspection of error field when available
  const field = String(
    err?.error?.field || err?.response?.data?.error?.field || err?.field || ''
  ).toLowerCase().trim();

  if (field === 'customer_notify') return 'invalid_customer_notify';
  if (field === 'total_count') return 'invalid_billing_cycle_count';
  if (field === 'plan_id') return 'plan_reference_rejected';
  if (field === 'start_at') return 'invalid_subscription_start';
  if (field === 'quantity') return 'invalid_quantity';
  if (field === 'notes' || field.startsWith('notes.') || field.startsWith('notes_')) {
    return 'invalid_subscription_payload';
  }

  // 2. Candidate strings inspection
  const candidates = [
    err?.error?.description,
    err?.response?.data?.error?.description,
    err?.error?.reason,
    err?.description,
    err?.message
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    // Normalize both underscores and whitespace
    const value = candidate.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!value) continue;

    // Documented invoice creation error also returned by subscription setup:
    // Customer Fee Bearer model disables Razorpay invoice creation. Keep the
    // reason as a safe fixed identifier; never log provider descriptions.
    if (value.includes('invoices disabled because fee bearer is customer') ||
        (value.includes('invoices disabled') && value.includes('fee bearer is customer'))) {
      return 'invoices_disabled_customer_fee_bearer';
    }

    if (value.includes('requested url was not found on the server') ||
        value.includes('subscriptions are not enabled') ||
        value.includes('subscription feature') ||
        value.includes('not authorized for subscriptions')) {
      return 'subscription_endpoint_unavailable';
    }
    if (value.includes('id provided does not exist') ||
        value.includes('plan id field is required') ||
        value.includes('plan id must be') ||
        (value.includes('plan id') && (value.includes('required') || value.includes('invalid') || value.includes('not exist')))) {
      return 'plan_reference_rejected';
    }
    if (value.includes('start at cannot be lesser than the current time') ||
        (value.includes('start at') && (value.includes('past unix') || value.includes('earlier than') || value.includes('current time') || value.includes('lesser') || value.includes('invalid')))) {
      return 'invalid_subscription_start';
    }
    if (value.includes('total count') &&
        (value.includes('at least') || value.includes('integer') || value.includes('required') || value.includes('greater') || value.includes('invalid'))) {
      return 'invalid_billing_cycle_count';
    }
    if (value.includes('customer notify') &&
        (value.includes('true or false') || value.includes('boolean') || value.includes('required') || value.includes('must be') || value.includes('invalid'))) {
      return 'invalid_customer_notify';
    }
    if (value.includes('quantity must be at least') ||
        (value.includes('quantity') && (value.includes('at least') || value.includes('integer') || value.includes('invalid')))) {
      return 'invalid_quantity';
    }
    if (value.includes('not required and should not be sent') ||
        value.includes('please provide either an end date or a total count') ||
        value.includes('offer id') ||
        (value.includes('notes') && (value.includes('cannot be') || value.includes('empty') || value.includes('blank') || value.includes('character') || value.includes('invalid')))) {
      return 'invalid_subscription_payload';
    }
  }

  return 'unclassified';
}

/**
 * Classify only documented Razorpay subscription-creation failures.
 *
 * Provider error descriptions may contain account details or arbitrary text.
 * They are NEVER logged, sent to customers, or returned from this function.
 * New/unrecognized descriptions fail closed to "unclassified".
 */
export function classifySubscriptionGatewayError(err) {
  const candidates = [
    err?.error?.description,
    err?.response?.data?.error?.description,
    err?.description,
    err?.message
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.includes('requested url was not found on the server')) {
      return 'subscription_endpoint_unavailable';
    }
    if (value.includes('id provided does not exist') ||
        value.includes('plan id field is required') ||
        value.includes('plan id must be')) {
      return 'plan_reference_rejected';
    }
    if (value.includes('start_at cannot be lesser than the current time') ||
        value.includes('start_at') && (value.includes('past unix') || value.includes('earlier than'))) {
      return 'invalid_subscription_start';
    }
    if (value.includes('total count') &&
        (value.includes('at least') || value.includes('integer') || value.includes('required'))) {
      return 'invalid_billing_cycle_count';
    }
    if (value.includes('customer notify field must be true or false')) {
      return 'invalid_customer_notify';
    }
    if (value.includes('quantity must be at least')) {
      return 'invalid_quantity';
    }
    if (value.includes('not required and should not be sent') ||
        value.includes('please provide either an end date or a total count')) {
      return 'invalid_subscription_payload';
    }
  }
  return 'unclassified';
}

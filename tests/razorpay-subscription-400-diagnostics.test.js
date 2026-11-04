import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySubscriptionGatewayError,
  standardizeSubscriptionGatewayError,
  GATEWAY_REASON_STANDARDS
} from '../src/razorpaySubscriptionErrors.js';

test('classifies documented Razorpay subscription creation 400 errors into safe identifiers', () => {
  const cases = [
    ['The requested URL was not found on the server.', 'subscription_endpoint_unavailable'],
    ['The id provided does not exist', 'plan_reference_rejected'],
    ['The plan id field is required.', 'plan_reference_rejected'],
    ['The plan id must be 19 characters.', 'plan_reference_rejected'],
    ['start_at cannot be lesser than the current time.', 'invalid_subscription_start'],
    ['The total count must be at least 1.', 'invalid_billing_cycle_count'],
    ['The total count must be an integer.', 'invalid_billing_cycle_count'],
    ['The total count field is required when end at is not present.', 'invalid_billing_cycle_count'],
    ['The customer notify field must be true or false.', 'invalid_customer_notify'],
    ['The quantity must be at least 1.', 'invalid_quantity'],
    ['offer_id is/are not required and should not be sent.', 'invalid_subscription_payload'],
    ['Please provide either an end date or a total count, but not both.', 'invalid_subscription_payload']
  ];
  for (const [description, expected] of cases) {
    const actual = classifySubscriptionGatewayError({ statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description } });
    assert.equal(actual, expected, description);
  }
});

test('normalizes underscores in descriptions such as customer_notify and total_count', () => {
  const underscoreCases = [
    ['The customer_notify field must be true or false.', 'invalid_customer_notify'],
    ['customer_notify must be a boolean', 'invalid_customer_notify'],
    ['The total_count must be at least 1.', 'invalid_billing_cycle_count'],
    ['The plan_id field is required.', 'plan_reference_rejected'],
    ['start_at cannot be lesser than the current time.', 'invalid_subscription_start'],
    ['The notes.startDate field cannot be blank or empty.', 'invalid_subscription_payload'],
    ['Subscriptions are not enabled for this account', 'subscription_endpoint_unavailable']
  ];
  for (const [description, expected] of underscoreCases) {
    const actual = classifySubscriptionGatewayError({ statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description } });
    assert.equal(actual, expected, description);
  }
});

test('identifies error by field attribute even if description is non-standard', () => {
  assert.equal(classifySubscriptionGatewayError({
    statusCode: 400,
    error: { code: 'BAD_REQUEST_ERROR', field: 'customer_notify', description: 'Invalid value' }
  }), 'invalid_customer_notify');

  assert.equal(classifySubscriptionGatewayError({
    statusCode: 400,
    error: { code: 'BAD_REQUEST_ERROR', field: 'total_count', description: 'Invalid count' }
  }), 'invalid_billing_cycle_count');

  assert.equal(classifySubscriptionGatewayError({
    statusCode: 400,
    error: { code: 'BAD_REQUEST_ERROR', field: 'plan_id', description: 'Unknown entity' }
  }), 'plan_reference_rejected');

  assert.equal(classifySubscriptionGatewayError({
    statusCode: 400,
    error: { code: 'BAD_REQUEST_ERROR', field: 'notes.startDate', description: 'Blank string' }
  }), 'invalid_subscription_payload');
});

test('standardizeSubscriptionGatewayError maps to canonical non-sensitive identifiers', () => {
  assert.equal(standardizeSubscriptionGatewayError('invalid_customer_notify'), 'invalid_customer_notify');
  assert.equal(standardizeSubscriptionGatewayError('invalid_billing_cycle_count'), 'invalid_total_count');
  assert.equal(standardizeSubscriptionGatewayError('plan_reference_rejected'), 'invalid_plan_reference');
  assert.equal(standardizeSubscriptionGatewayError('invalid_subscription_start'), 'invalid_start_timestamp');
  assert.equal(standardizeSubscriptionGatewayError('invalid_subscription_payload'), 'unsupported_payload_field');
  assert.equal(standardizeSubscriptionGatewayError('subscription_endpoint_unavailable'), 'subscription_feature_unavailable');
  assert.equal(standardizeSubscriptionGatewayError('unclassified'), 'unclassified_gateway_rejection');
});

test('accepts SDK error shape in Razorpay response.data', () => {
  assert.equal(classifySubscriptionGatewayError({
    response: { data: { error: { description: 'The id provided does not exist' } } }
  }), 'plan_reference_rejected');
});

test('does not return unknown provider errors or customer data', () => {
  const arbitrary = 'User test@example.org 9876543210 secret key=rzp_test_example invalid private content';
  const values = [
    classifySubscriptionGatewayError({ error: { description: arbitrary } }),
    classifySubscriptionGatewayError({ message: arbitrary }),
    classifySubscriptionGatewayError({ error: { code: 'BAD_REQUEST_ERROR' } }),
    classifySubscriptionGatewayError(null)
  ];
  assert.deepEqual(values, ['unclassified', 'unclassified', 'unclassified', 'unclassified']);
  for (const value of values) {
    assert.ok(!value.includes('example'));
    assert.ok(!value.includes('secret'));
    assert.ok(!value.includes('9876543210'));
  }
});

test('error description precedence prioritizes known public reason over generic SDK message', () => {
  const result = classifySubscriptionGatewayError({
    error: { description: 'The requested URL was not found on the server.' },
    message: 'Private personal information'
  });
  assert.equal(result, 'subscription_endpoint_unavailable');
});

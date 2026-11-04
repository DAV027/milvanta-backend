import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySubscriptionGatewayError } from '../src/razorpaySubscriptionErrors.js';

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
    const actual=classifySubscriptionGatewayError({statusCode:400,error:{code:'BAD_REQUEST_ERROR',description}});
    assert.equal(actual,expected,description);
  }
});
test('accepts SDK error shape in Razorpay response.data', () => {
  assert.equal(classifySubscriptionGatewayError({
    response: {data: {error:{description:'The id provided does not exist'}}}
  }), 'plan_reference_rejected');
});
test('does not return unknown provider errors or customer data', () => {
  const arbitrary='User test@example.org 9876543210 secret key=rzp_test_example invalid private content';
  const values=[
    classifySubscriptionGatewayError({error:{description:arbitrary}}),
    classifySubscriptionGatewayError({message:arbitrary}),
    classifySubscriptionGatewayError({error:{code:'BAD_REQUEST_ERROR'}}),
    classifySubscriptionGatewayError(null)
  ];
  assert.deepEqual(values,['unclassified','unclassified','unclassified','unclassified']);
  for (const value of values) {
    assert.ok(!value.includes('example'));
    assert.ok(!value.includes('secret'));
    assert.ok(!value.includes('9876543210'));
  }
});
test('error description precedence prioritizes known public reason over generic SDK message', () => {
  const result=classifySubscriptionGatewayError({
    error:{description:'The requested URL was not found on the server.'},
    message:'Private personal information'
  });
  assert.equal(result,'subscription_endpoint_unavailable');
});

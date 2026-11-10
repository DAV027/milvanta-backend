-- Migration 025: signed-webhook capture observations for recurring finance audit.
-- Append-only evidence of a raw captured payment entity from a verified
-- Razorpay webhook; NOT a gateway balance reconciliation or refund authority.
-- No backfill, no payment/entitlement change, defaults OFF in application.
CREATE TABLE IF NOT EXISTS recurring_subscription_capture_observations (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  gateway_subscription_id TEXT NOT NULL CHECK(gateway_subscription_id LIKE 'sub_%'),
  gateway_payment_id TEXT NOT NULL UNIQUE CHECK(gateway_payment_id LIKE 'pay_%'),
  source_webhook_event_id TEXT NOT NULL UNIQUE,
  amount_paise BIGINT NOT NULL CHECK(amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency = 'INR'),
  paid_count_at_event INTEGER NOT NULL CHECK(paid_count_at_event >= 1),
  capture_status TEXT NOT NULL DEFAULT 'captured' CHECK(capture_status = 'captured'),
  gateway_created_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proof_level TEXT NOT NULL DEFAULT 'signed_webhook_payment_entity'
    CHECK(proof_level = 'signed_webhook_payment_entity')
);
CREATE INDEX IF NOT EXISTS recurring_capture_observations_subscription_idx
 ON recurring_subscription_capture_observations(subscription_id,paid_count_at_event);

-- Migration 022: Test-only owed-morning reservation prototype; NO automatic dispatch.
-- Additive schema; no backfill and no existing order or entitlement mutation.
-- Never set RECURRING_MORNING_PHYSICAL_REDEMPTION_ENABLED in production:
-- application code restricts this prototype to NODE_ENV=test regardless of flag.

ALTER TABLE subscription_delivery_orders
  ADD COLUMN IF NOT EXISTS fulfillment_source TEXT NOT NULL DEFAULT 'paid_entitlement';

ALTER TABLE subscription_delivery_orders
  DROP CONSTRAINT IF EXISTS subscription_delivery_orders_fulfillment_source_check;
ALTER TABLE subscription_delivery_orders
  ADD CONSTRAINT subscription_delivery_orders_fulfillment_source_check
  CHECK (fulfillment_source IN ('paid_entitlement', 'owed_morning_prototype'));

CREATE TABLE IF NOT EXISTS subscription_recurring_morning_reservations (
  id BIGSERIAL PRIMARY KEY,
  obligation_id BIGINT NOT NULL REFERENCES subscription_recurring_morning_obligations(id) ON DELETE RESTRICT,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  delivery_order_id BIGINT NOT NULL UNIQUE REFERENCES subscription_delivery_orders(id) ON DELETE RESTRICT,
  delivery_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','fulfilled','released')),
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Strictly no second reservation for the same obligation/date, even after release:
  CONSTRAINT recurring_reservation_obligation_day_unique UNIQUE (obligation_id, delivery_date),
  CONSTRAINT recurring_reservation_subscription_day_unique UNIQUE (subscription_id, delivery_date),
  CONSTRAINT recurring_reservation_release_reason_check CHECK
    ((status = 'released' AND release_reason IS NOT NULL) OR
     (status <> 'released' AND release_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS recurring_reservation_active_balance_idx
  ON subscription_recurring_morning_reservations(obligation_id, status);
CREATE INDEX IF NOT EXISTS recurring_reservation_order_idx
  ON subscription_recurring_morning_reservations(delivery_order_id, status);

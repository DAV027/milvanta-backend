-- Migration 021: Auditable recurring initial-cycle morning obligations.
-- Financial review gate: creation is disabled unless explicitly enabled in
-- application policy; this migration creates schema only and writes no rows.
-- Does not alter Razorpay billing/mandates, existing paid-through dates, or
-- automatic delivery entitlement.
CREATE TABLE IF NOT EXISTS subscription_recurring_morning_obligations (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  razorpay_subscription_id TEXT NOT NULL CHECK (length(razorpay_subscription_id) > 4),
  payment_id TEXT NOT NULL CHECK (payment_id LIKE 'pay_%'),
  source TEXT NOT NULL DEFAULT 'first_cycle_unservable'
    CHECK (source = 'first_cycle_unservable'),
  first_cycle_start DATE NOT NULL,
  first_cycle_end DATE NOT NULL,
  first_eligible_delivery DATE NOT NULL,
  owed_mornings INTEGER NOT NULL CHECK (owed_mornings > 0 AND owed_mornings <= 31),
  fulfilled_mornings INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_mornings >= 0),
  refunded_mornings INTEGER NOT NULL DEFAULT 0 CHECK (refunded_mornings >= 0),
  daily_rate_paise INTEGER NOT NULL CHECK (daily_rate_paise > 0),
  credited_amount_paise BIGINT GENERATED ALWAYS AS (owed_mornings::bigint * daily_rate_paise::bigint) STORED,
  status TEXT NOT NULL DEFAULT 'pending_reconciliation'
    CHECK (status IN ('pending_reconciliation','approved','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT obligation_cycle_bounds CHECK (
    first_cycle_start <= first_cycle_end AND first_eligible_delivery >= first_cycle_start
  ),
  CONSTRAINT obligation_balance CHECK (fulfilled_mornings + refunded_mornings <= owed_mornings),
  CONSTRAINT obligation_first_cycle_unique UNIQUE (subscription_id, first_cycle_start, source),
  CONSTRAINT obligation_payment_unique UNIQUE (subscription_id, payment_id, source)
);
CREATE INDEX IF NOT EXISTS recurring_obligations_customer_idx
  ON subscription_recurring_morning_obligations(customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS recurring_obligations_review_idx
  ON subscription_recurring_morning_obligations(status, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_recurring_morning_obligation_events (
  id BIGSERIAL PRIMARY KEY,
  obligation_id BIGINT NOT NULL REFERENCES subscription_recurring_morning_obligations(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('accrued','fulfilled','refunded','adjusted')),
  days_delta INTEGER NOT NULL,
  notes TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recurring_obligation_events_idx
  ON subscription_recurring_morning_obligation_events(obligation_id, created_at DESC);

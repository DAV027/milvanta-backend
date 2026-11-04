-- Migration 020: Registry of verified Razorpay plans to prevent orphan plan creation
CREATE TABLE IF NOT EXISTS subscription_plan_registry (
  id SERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id),
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  amount_per_month_paise BIGINT NOT NULL,
  daily_rate_paise BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  period TEXT NOT NULL DEFAULT 'monthly',
  interval INTEGER NOT NULL DEFAULT 1,
  razorpay_plan_id TEXT NOT NULL UNIQUE,
  key_mode TEXT NOT NULL DEFAULT 'test',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_plan_registry_lookup 
ON subscription_plan_registry(product_id, size, amount_per_month_paise, key_mode) 
WHERE is_active = TRUE;

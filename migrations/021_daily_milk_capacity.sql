-- Migration 021: Daily Milk Capacity Management & Order Delivery Dates
-- Additive migration preserving all existing tables, products, and historical order data

-- 1. Add delivery_date to customer_orders for daily capacity tracking of one-time purchases
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS delivery_date DATE;
CREATE INDEX IF NOT EXISTS idx_customer_orders_delivery_date 
  ON customer_orders (delivery_date, order_status, payment_status);

-- 2. Baseline daily available milk volume (in Litres) configured by business owner
CREATE TABLE IF NOT EXISTS milk_capacity_defaults (
  milk_type TEXT PRIMARY KEY CHECK (milk_type IN ('cow', 'buffalo')),
  daily_litres NUMERIC(10,2) NOT NULL DEFAULT 100.00 CHECK (daily_litres >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed baseline default milk volumes if not present
INSERT INTO milk_capacity_defaults (milk_type, daily_litres)
VALUES 
  ('cow', 100.00),
  ('buffalo', 80.00)
ON CONFLICT (milk_type) DO NOTHING;

-- 3. Date-specific capacity overrides (e.g. farm supply variance, festival surge, maintenance)
CREATE TABLE IF NOT EXISTS milk_daily_capacity_overrides (
  id BIGSERIAL PRIMARY KEY,
  delivery_date DATE NOT NULL,
  milk_type TEXT NOT NULL CHECK (milk_type IN ('cow', 'buffalo')),
  daily_litres NUMERIC(10,2) NOT NULL CHECK (daily_litres >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT milk_daily_capacity_overrides_unique UNIQUE (delivery_date, milk_type)
);

CREATE INDEX IF NOT EXISTS idx_milk_daily_capacity_overrides_date 
  ON milk_daily_capacity_overrides (delivery_date, milk_type);

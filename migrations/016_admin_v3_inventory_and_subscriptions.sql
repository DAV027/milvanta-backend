-- Migration 016: Admin V3 Inventory Management, Subscription Delivery Addresses & Delivery Confirmation Tracking
-- Additive migration preserving all existing tables and records

-- 1. Subscription Delivery Address References
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS address_id BIGINT REFERENCES customer_addresses(id) ON DELETE SET NULL;
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS delivery_address JSONB;

-- 2. Products Low-Stock Threshold
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5;

-- 3. Product Stock Ledger for Inventory Movement & Audit
CREATE TABLE IF NOT EXISTS product_stock_ledger (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('restock', 'correction', 'damage', 'loss', 'order_reservation', 'order_fulfillment', 'order_cancellation', 'return')),
  quantity_change INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  previous_reserved INTEGER NOT NULL DEFAULT 0,
  new_reserved INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  admin_actor TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE product_stock_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS product_stock_ledger_prod_idx ON product_stock_ledger (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_stock_ledger_type_idx ON product_stock_ledger (adjustment_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS product_stock_ledger_idempotency_idx ON product_stock_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4. Subscription Delivery Orders Enhanced Confirmation & Operator Attribution
ALTER TABLE subscription_delivery_orders ADD COLUMN IF NOT EXISTS proof_of_delivery TEXT;
ALTER TABLE subscription_delivery_orders ADD COLUMN IF NOT EXISTS delivered_by TEXT;
ALTER TABLE subscription_delivery_orders ADD COLUMN IF NOT EXISTS failed_by TEXT;

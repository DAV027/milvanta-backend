-- Migration 005: Order status tracking history, courier details, and administrative roles

-- 1. Add administrative role flag to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Add courier and tracking fields to customer_orders
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS courier_name TEXT;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ;

-- 3. Create order status history table for audit and customer tracking timelines
CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  courier_name TEXT,
  tracking_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history (order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS order_status_history_order_number_idx ON order_status_history (order_number, created_at ASC);

-- 4. Initial status record trigger helper for older orders
INSERT INTO order_status_history (order_id, order_number, previous_status, new_status, actor, note, created_at)
SELECT co.id, co.order_number, NULL, co.order_status, 'system', 'Order created', co.created_at
FROM customer_orders co
WHERE NOT EXISTS (
  SELECT 1 FROM order_status_history osh WHERE osh.order_id = co.id
);


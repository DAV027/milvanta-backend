CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  image_url TEXT DEFAULT 'assets/milvanta-cow-milk.jpg',
  frequency TEXT NOT NULL DEFAULT 'Daily (Every Morning)',
  time_slot TEXT NOT NULL DEFAULT '6:00 AM – 7:00 AM',
  quantity TEXT NOT NULL DEFAULT '1 Litre',
  quantity_num NUMERIC NOT NULL DEFAULT 1,
  cost_per_day_paise INTEGER NOT NULL DEFAULT 6000,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  next_delivery TEXT DEFAULT 'Tomorrow, 6:00 AM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_subscriptions_customer_idx
  ON customer_subscriptions (customer_id, status, created_at DESC);


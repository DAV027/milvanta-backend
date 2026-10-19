-- Migration 013: Complete Subscriptions Management, Delivery Automation & Twilio Notification Infrastructure
-- Additive migration preserving all existing tables and records

-- 1. Add mobile phone verification & SMS preference columns to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS customers_phone_verified_idx ON customers (phone, phone_verified_at);

-- 2. Subscription Delivery Pauses & Vacation Ranges
CREATE TABLE IF NOT EXISTS subscription_delivery_pauses (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  pause_start_date DATE NOT NULL,
  pause_end_date DATE, -- NULL represents indefinite pause until explicitly resumed
  resumed_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_pauses_sub_idx ON subscription_delivery_pauses (subscription_id, pause_start_date, pause_end_date);
CREATE INDEX IF NOT EXISTS sub_pauses_cust_idx ON subscription_delivery_pauses (customer_id);

-- 3. Individual Skipped Delivery Dates
CREATE TABLE IF NOT EXISTS subscription_skipped_dates (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  skip_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sub_skipped_dates_unique UNIQUE (subscription_id, skip_date)
);
CREATE INDEX IF NOT EXISTS sub_skipped_dates_idx ON subscription_skipped_dates (subscription_id, skip_date);

-- 4. Daily Scheduled & Fulfilled Delivery Orders
CREATE TABLE IF NOT EXISTS subscription_delivery_orders (
  id BIGSERIAL PRIMARY KEY,
  delivery_order_number TEXT UNIQUE NOT NULL,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  delivery_date DATE NOT NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '1 Litre',
  quantity_num NUMERIC NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'packed', 'out_for_delivery', 'delivered', 'failed', 'cancelled')),
  delivery_address JSONB NOT NULL,
  driver_notes TEXT,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sub_delivery_orders_unique UNIQUE (subscription_id, delivery_date)
);
CREATE INDEX IF NOT EXISTS sub_delivery_orders_date_idx ON subscription_delivery_orders (delivery_date, status);
CREATE INDEX IF NOT EXISTS sub_delivery_orders_sub_idx ON subscription_delivery_orders (subscription_id, delivery_date DESC);
CREATE INDEX IF NOT EXISTS sub_delivery_orders_cust_idx ON subscription_delivery_orders (customer_id, delivery_date DESC);

-- 5. Subscription Billing Adjustments & Carry-forward tracking
CREATE TABLE IF NOT EXISTS subscription_billing_adjustments (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('extension', 'credit', 'refund')),
  days_count INTEGER NOT NULL DEFAULT 0,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_billing_adj_sub_idx ON subscription_billing_adjustments (subscription_id, created_at DESC);

-- 6. Subscription Domain Audit Events (for tracing & future Zoho sync)
CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'customer',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_events_sub_idx ON subscription_events (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sub_events_type_idx ON subscription_events (event_type, created_at DESC);

-- 7. Notification Outbox (for Twilio SMS, prevents duplicates and handles retries)
CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  template_name TEXT NOT NULL,
  message_body TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed')),
  twilio_message_sid TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_outbox_status_idx ON notification_outbox (status, scheduled_at);
CREATE INDEX IF NOT EXISTS notification_outbox_phone_idx ON notification_outbox (phone, created_at DESC);

-- 8. Phone OTP Verification Session / Cooldown Tracker
CREATE TABLE IF NOT EXISTS phone_verification_attempts (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS phone_verification_phone_idx ON phone_verification_attempts (phone, last_sent_at DESC);


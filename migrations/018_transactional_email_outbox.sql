-- Migration 018: Transactional Email Outbox & Recipient-Specific Delivery Tracking
-- Eliminates false-positive email delivery tracking and ensures transactional commit safety.

CREATE TABLE IF NOT EXISTS email_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  email_type TEXT NOT NULL CHECK (email_type IN ('order_confirmation', 'order_notification', 'subscription_confirmation', 'subscription_notification', 'custom')),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'admin')),
  recipient_email TEXT NOT NULL,
  source_order_id BIGINT REFERENCES customer_orders(id) ON DELETE CASCADE,
  source_subscription_id BIGINT REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  payment_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'delivered', 'bounced')),
  provider TEXT,
  provider_message_id TEXT,
  provider_status TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_outbox_queue_idx ON email_outbox (status, next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS email_outbox_source_order_idx ON email_outbox (source_order_id, recipient_type);
CREATE INDEX IF NOT EXISTS email_outbox_source_sub_idx ON email_outbox (source_subscription_id, recipient_type);

-- Recipient-specific dispatch tracking columns on customer_orders
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS customer_email_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS customer_email_at TIMESTAMPTZ;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS admin_email_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS admin_email_at TIMESTAMPTZ;

-- Recipient-specific dispatch tracking columns on customer_subscriptions
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS customer_email_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS customer_email_at TIMESTAMPTZ;
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS admin_email_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS admin_email_at TIMESTAMPTZ;


-- Migration 009: Add confirmation email tracking to customer_orders
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS confirmation_email_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS confirmation_email_at TIMESTAMPTZ;


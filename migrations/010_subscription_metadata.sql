-- Migration 010: Add plan_type, duration_label, total_amount_paise, and notes to customer_subscriptions
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'month';
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS duration_label TEXT DEFAULT '';
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS total_amount_paise INTEGER DEFAULT 0;
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '{}'::jsonb;


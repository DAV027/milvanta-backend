-- Migration 012: Add subscription lifecycle states and Razorpay tracking columns
-- Allows safe pending states before gateway verification

DO $$ 
BEGIN
  -- Drop existing status check constraint if it exists
  ALTER TABLE customer_subscriptions DROP CONSTRAINT IF EXISTS customer_subscriptions_status_check;

  -- Add updated constraint with complete lifecycle states
  ALTER TABLE customer_subscriptions ADD CONSTRAINT customer_subscriptions_status_check
    CHECK (status IN ('pending_payment', 'pending_authorization', 'active', 'paused', 'cancelled', 'expired'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Add razorpay tracking columns if not already present
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;
ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT;

-- Create index for fast webhook reconciliation by razorpay_subscription_id
CREATE INDEX IF NOT EXISTS customer_subscriptions_rzp_sub_idx 
  ON customer_subscriptions (razorpay_subscription_id) 
  WHERE razorpay_subscription_id IS NOT NULL;


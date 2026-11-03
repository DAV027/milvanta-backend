-- Migration 019: Email Outbox Concurrency Leases, Dead-Letter State & Webhook Replay Protection
-- Adds atomic worker locking, lease recovery, dead-letter terminal state, and deduplication for Svix webhooks.

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Update status check constraint to support 'dead_letter'
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_status_check 
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'delivered', 'bounced', 'dead_letter'));

-- Allow null next_retry_at for terminal statuses (dead_letter, sent, delivered)
ALTER TABLE email_outbox ALTER COLUMN next_retry_at DROP NOT NULL;

-- Index for queue claims with lease recovery
CREATE INDEX IF NOT EXISTS email_outbox_lease_queue_idx 
  ON email_outbox (status, next_retry_at, lease_expires_at) 
  WHERE status IN ('pending', 'processing', 'failed');

-- Table for webhook event replay protection (Svix svix-id deduplication)
CREATE TABLE IF NOT EXISTS email_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_webhook_events_created_idx 
  ON email_webhook_events (created_at);

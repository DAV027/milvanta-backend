-- Additive: preserve all SMS history and Twilio configuration.
CREATE TABLE whatsapp_otp_challenges (
  id UUID PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  phone TEXT NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  otp_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  status TEXT NOT NULL CHECK (status IN ('sending','pending','verified','superseded','failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX whatsapp_otp_phone_idx ON whatsapp_otp_challenges(phone, created_at DESC);
CREATE INDEX whatsapp_otp_context_idx ON whatsapp_otp_challenges(customer_id, session_hash, phone, created_at DESC);

CREATE TABLE whatsapp_notification_preferences (
  customer_id BIGINT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  consent_source TEXT,
  opted_out_at TIMESTAMPTZ,
  categories JSONB NOT NULL DEFAULT '["orders","subscriptions","deliveries","billing"]'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_status_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status IN ('pending','processing','accepted','sent','delivered','read','failed','cancelled','uncertain'));
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_channel_check CHECK (channel IN ('sms','whatsapp'));
ALTER TABLE notification_outbox ADD COLUMN template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notification_outbox ADD COLUMN template_language TEXT;
ALTER TABLE notification_outbox ADD COLUMN notification_category TEXT;
ALTER TABLE notification_outbox ADD COLUMN meta_message_id TEXT UNIQUE;
ALTER TABLE notification_outbox ADD COLUMN provider_status TEXT;
ALTER TABLE notification_outbox ADD COLUMN delivered_at TIMESTAMPTZ;
ALTER TABLE notification_outbox ADD COLUMN read_at TIMESTAMPTZ;
ALTER TABLE notification_outbox ADD COLUMN failure_details JSONB;
ALTER TABLE notification_outbox ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE notification_outbox ADD COLUMN claimed_at TIMESTAMPTZ;
ALTER TABLE notification_outbox ADD COLUMN claim_token UUID;
ALTER TABLE notification_outbox ADD COLUMN delivery_order_id BIGINT REFERENCES subscription_delivery_orders(id) ON DELETE SET NULL;
CREATE INDEX whatsapp_outbox_ready_idx ON notification_outbox(channel,status,next_attempt_at,scheduled_at);

-- Minimal event records: no inbound text, OTP, recipient or provider error prose.
CREATE TABLE whatsapp_webhook_events (
  event_key TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  outbox_id BIGINT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

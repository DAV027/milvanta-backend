-- Password Reset OTP and temporary reset token storage
CREATE TABLE IF NOT EXISTS password_reset_codes (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  reset_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  resend_after TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_codes_expiry_idx
  ON password_reset_codes (expires_at);


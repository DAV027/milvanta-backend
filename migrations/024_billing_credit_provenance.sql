-- Migration 024: Optional date-level source evidence for billing adjustments.
-- Adds no credits or entitlement. Existing historical adjustments are
-- intentionally NOT backfilled from unstructured free-text notes.
CREATE TABLE IF NOT EXISTS subscription_billing_credit_provenance (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  billing_adjustment_id BIGINT NOT NULL REFERENCES subscription_billing_adjustments(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('skip','unskip','vacation','pause_resume')),
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 3 AND 160),
  delivery_date DATE NOT NULL,
  days_delta SMALLINT NOT NULL CHECK (days_delta IN (-1,1)),
  amount_paise INTEGER NOT NULL,
  payment_id TEXT,
  billing_cycle_reference TEXT,
  evidence_state TEXT NOT NULL DEFAULT 'date_known_payment_unverified'
    CHECK (evidence_state = 'date_known_payment_unverified'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_credit_provenance_signed_amount CHECK (
    (days_delta=1 AND amount_paise>0) OR
    (days_delta=-1 AND amount_paise<0)
  ),
  CONSTRAINT billing_credit_provenance_unique_adjustment_date UNIQUE (billing_adjustment_id,delivery_date)
);
CREATE INDEX IF NOT EXISTS billing_credit_provenance_subscription_date_idx
  ON subscription_billing_credit_provenance(subscription_id,delivery_date);
CREATE INDEX IF NOT EXISTS billing_credit_provenance_source_idx
  ON subscription_billing_credit_provenance(source_kind,source_reference);

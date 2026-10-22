-- Migration 014: Refund Requests, Audit History & Subscription Entitlement Ledger
-- Additive migration preserving all existing tables and historical records

-- 1. Customer Order & Subscription Refund Requests
CREATE TABLE IF NOT EXISTS refund_requests (
  id BIGSERIAL PRIMARY KEY,
  request_number TEXT UNIQUE NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('subscription', 'order')),
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  subscription_id BIGINT REFERENCES customer_subscriptions(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES customer_orders(id) ON DELETE SET NULL,
  order_number TEXT,
  payment_id TEXT NOT NULL,
  gateway_subscription_id TEXT,
  requested_amount_paise INTEGER NOT NULL CHECK (requested_amount_paise > 0),
  calculated_eligible_amount_paise INTEGER NOT NULL DEFAULT 0,
  approved_amount_paise INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR',
  reason_category TEXT NOT NULL CHECK (reason_category IN (
    'cancellation',
    'damaged_item',
    'wrong_item',
    'missing_item',
    'non_delivery',
    'quality_issue',
    'other'
  )),
  reason_detail TEXT,
  customer_notes TEXT,
  items_payload JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'processing',
    'processed',
    'failed'
  )),
  idempotency_key TEXT UNIQUE NOT NULL,
  admin_notes TEXT,
  reviewed_by BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  gateway_refund_id TEXT,
  gateway_response JSONB,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_req_cust ON refund_requests (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_req_status ON refund_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_req_sub ON refund_requests (subscription_id);
CREATE INDEX IF NOT EXISTS idx_refund_req_order ON refund_requests (order_id);
CREATE INDEX IF NOT EXISTS idx_refund_req_payment ON refund_requests (payment_id);
CREATE INDEX IF NOT EXISTS idx_refund_req_idempotency ON refund_requests (idempotency_key);

-- 2. Refund Status History & Audit Trail
CREATE TABLE IF NOT EXISTS refund_request_history (
  id BIGSERIAL PRIMARY KEY,
  refund_request_id BIGINT NOT NULL REFERENCES refund_requests(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'customer' CHECK (actor_type IN ('customer', 'admin', 'system', 'webhook')),
  actor_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  note TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_hist_req ON refund_request_history (refund_request_id, created_at ASC);

-- 3. Subscription Entitlement & Financial Ledger
CREATE TABLE IF NOT EXISTS subscription_entitlement_ledger (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'payment_captured',
    'delivery_fulfilled',
    'delivery_skipped',
    'vacation_pause',
    'manual_pause',
    'extension_carried_forward',
    'credit_accrued',
    'credit_consumed',
    'refund_requested',
    'refund_approved',
    'refund_settled'
  )),
  billing_cycle_start DATE,
  billing_cycle_end DATE,
  days_delta INTEGER NOT NULL DEFAULT 0,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  delivery_date DATE,
  payment_id TEXT,
  refund_request_id BIGINT REFERENCES refund_requests(id) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_entitlement_sub ON subscription_entitlement_ledger (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_entitlement_type ON subscription_entitlement_ledger (subscription_id, entry_type);

-- DOWN MIGRATION (for reference and safety rollback):
-- DROP TABLE IF EXISTS subscription_entitlement_ledger;
-- DROP TABLE IF EXISTS refund_request_history;
-- DROP TABLE IF EXISTS refund_requests;

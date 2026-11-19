-- Migration 022: Owner-confirmed Daily Milk Capacity Initialization
-- Distinguishes placeholder seed numbers (100L/80L) from verified real farm supply.
-- Prevents new customer commitments until business owner explicitly confirms or configures capacity.

ALTER TABLE milk_capacity_defaults
  ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by BIGINT REFERENCES customers(id);

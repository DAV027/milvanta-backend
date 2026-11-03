-- Migration 017: Idempotent server-side activation of prepaid custom-days
-- milk subscriptions associated with a confirmed, captured one-time order.
-- No existing subscription rows are rewritten.
CREATE UNIQUE INDEX IF NOT EXISTS customer_subscriptions_paid_order_line_key_unique
ON customer_subscriptions (
  (notes->>'sourceOrderId'),
  (notes->>'sourceOrderLineKey')
)
WHERE notes ? 'sourceOrderId' AND notes ? 'sourceOrderLineKey';

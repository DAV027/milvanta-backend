-- Migration 023: Fail-closed prototype reservation release on any bulk or
-- direct cancelled/failed delivery order status transition.
-- Does NOT affect normal paid_entitlement orders, alter live billing, refund,
-- extend entitlements, or enable any owed-morning production dispatch path.
-- Prototype order generation remains strictly NODE_ENV=test + explicit flag.

CREATE OR REPLACE FUNCTION release_owed_prototype_reservation_on_terminal_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  released_id BIGINT;
  released_obligation_id BIGINT;
BEGIN
  IF NEW.fulfillment_source <> 'owed_morning_prototype'
     OR NEW.status NOT IN ('cancelled', 'failed')
     OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- This UPDATE and the order status change are one PostgreSQL transaction.
  -- If no active reservation is found, there is no new release audit event.
  UPDATE subscription_recurring_morning_reservations r
     SET status = 'released',
         release_reason = 'prototype_' || NEW.status,
         updated_at = NOW()
   WHERE r.delivery_order_id = NEW.id AND r.status = 'reserved'
   RETURNING r.id, r.obligation_id INTO released_id, released_obligation_id;

  IF released_id IS NOT NULL THEN
    INSERT INTO subscription_recurring_morning_obligation_events
      (obligation_id, event_key, event_type, days_delta, notes, evidence)
    VALUES (
      released_obligation_id,
      'prototype_released:' || released_id::text,
      'adjusted',
      0,
      'Prototype obligation reservation released by atomic order status transition',
      jsonb_build_object(
        'deliveryOrderId', NEW.id,
        'previousStatus', OLD.status,
        'newStatus', NEW.status,
        'source', 'prototype_order_status_trigger'
      )
    )
    ON CONFLICT (event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owed_prototype_reservation_terminal_update
  ON subscription_delivery_orders;

CREATE TRIGGER owed_prototype_reservation_terminal_update
  AFTER UPDATE OF status ON subscription_delivery_orders
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.fulfillment_source = 'owed_morning_prototype'
    AND NEW.status IN ('cancelled','failed')
  )
  EXECUTE FUNCTION release_owed_prototype_reservation_on_terminal_order();

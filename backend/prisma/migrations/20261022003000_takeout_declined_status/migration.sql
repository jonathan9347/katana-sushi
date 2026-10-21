BEGIN;

ALTER TABLE "takeout_orders"
  DROP CONSTRAINT IF EXISTS "takeout_orders_status_check";

ALTER TABLE "takeout_orders"
  ADD CONSTRAINT "takeout_orders_status_check"
  CHECK ("status" IN (
    'pending_payment',
    'payment_failed',
    'pending_approval',
    'confirmed',
    'preparing',
    'ready',
    'released',
    'declined',
    'cancelled',
    'expired'
  ));

COMMIT;

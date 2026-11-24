ALTER TABLE "takeout_orders"
  ALTER COLUMN "status" SET DEFAULT 'pending_approval';

ALTER TABLE "takeout_orders"
  DROP CONSTRAINT "takeout_orders_status_check";

ALTER TABLE "takeout_orders"
  ADD CONSTRAINT "takeout_orders_status_check"
  CHECK ("status" IN ('pending_payment', 'payment_failed', 'pending_approval', 'confirmed', 'preparing', 'ready', 'released', 'cancelled', 'expired'));

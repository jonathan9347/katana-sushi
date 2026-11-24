BEGIN;

DO $phase2_guestless_dine_in_orders$
DECLARE
  order_items_table REGCLASS := to_regclass('public.dining_order_items');
  dining_orders_table REGCLASS := to_regclass('public.dining_orders');
  dining_guests_table REGCLASS := to_regclass('public.dining_guests');
  table_kind "char";
  column_type TEXT;
  column_nullable TEXT;
  column_default_expression TEXT;
  item_id_attribute SMALLINT;
  item_order_attribute SMALLINT;
  item_guest_attribute SMALLINT;
  guest_id_attribute SMALLINT;
BEGIN
  IF order_items_table IS NULL THEN
    RAISE NOTICE 'Skipping guestless dine-in order change: public.dining_order_items does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind
    FROM pg_class AS c
    WHERE c.oid = order_items_table;

    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Step 4.1 migration stopped: public.dining_order_items is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dining_order_items'
        AND column_name = 'id'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dining_order_items'
        AND column_name = 'order_id'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dining_order_items'
        AND column_name = 'guest_id'
    ) THEN
      RAISE NOTICE 'Skipping guestless dine-in order change: dining_order_items is missing an expected id, order_id, or guest_id column.';
    ELSE
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dining_order_items'
          AND column_name IN ('id', 'order_id')
          AND (data_type <> 'text' OR is_nullable <> 'NO')
      ) THEN
        RAISE EXCEPTION 'Step 4.1 migration stopped: dining_order_items.id and order_id must be NOT NULL text columns.';
      END IF;

      SELECT c.data_type, c.is_nullable, c.column_default
        INTO column_type, column_nullable, column_default_expression
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'dining_order_items'
        AND c.column_name = 'guest_id';

      IF column_type <> 'text' OR column_default_expression IS NOT NULL THEN
        RAISE EXCEPTION 'Step 4.1 migration stopped: dining_order_items.guest_id must be text with no default.';
      END IF;

      IF dining_guests_table IS NULL OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dining_guests'
          AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
      ) THEN
        RAISE NOTICE 'Skipping guestless dine-in order change: public.dining_guests.id is missing or has an unexpected shape.';
      ELSE
        SELECT a.attnum INTO item_id_attribute
        FROM pg_attribute AS a
        WHERE a.attrelid = order_items_table AND a.attname = 'id' AND NOT a.attisdropped;

        SELECT a.attnum INTO item_order_attribute
        FROM pg_attribute AS a
        WHERE a.attrelid = order_items_table AND a.attname = 'order_id' AND NOT a.attisdropped;

        SELECT a.attnum INTO item_guest_attribute
        FROM pg_attribute AS a
        WHERE a.attrelid = order_items_table AND a.attname = 'guest_id' AND NOT a.attisdropped;

        SELECT a.attnum INTO guest_id_attribute
        FROM pg_attribute AS a
        WHERE a.attrelid = dining_guests_table AND a.attname = 'id' AND NOT a.attisdropped;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint AS c
          WHERE c.conrelid = order_items_table
            AND c.conname = 'dining_order_items_guest_id_fkey'
            AND c.contype = 'f'
            AND c.confrelid = dining_guests_table
            AND c.conkey = ARRAY[item_guest_attribute]::SMALLINT[]
            AND c.confkey = ARRAY[guest_id_attribute]::SMALLINT[]
            AND c.confdeltype = 'r'
            AND c.confupdtype = 'c'
        ) THEN
          RAISE EXCEPTION 'Step 4.1 migration stopped: dining_order_items.guest_id has an unexpected or missing foreign key to dining_guests.id.';
        END IF;

        EXECUTE 'ALTER TABLE public.dining_order_items ALTER COLUMN guest_id DROP NOT NULL';
      END IF;
    END IF;
  END IF;

  IF dining_orders_table IS NULL THEN
    RAISE NOTICE 'Skipping table-number snapshot: public.dining_orders does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind
    FROM pg_class AS c
    WHERE c.oid = dining_orders_table;

    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Step 4.1 migration stopped: public.dining_orders is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dining_orders'
        AND column_name = 'id'
    ) THEN
      RAISE NOTICE 'Skipping table-number snapshot: dining_orders.id is missing.';
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dining_orders'
          AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
      ) THEN
        RAISE EXCEPTION 'Step 4.1 migration stopped: dining_orders.id must be NOT NULL text.';
      END IF;

      SELECT c.data_type, c.is_nullable, c.column_default
        INTO column_type, column_nullable, column_default_expression
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'dining_orders'
        AND c.column_name = 'table_number_snapshot';

      IF column_type IS NULL THEN
        EXECUTE 'ALTER TABLE public.dining_orders ADD COLUMN table_number_snapshot INTEGER';
      ELSIF column_type <> 'integer'
         OR column_nullable <> 'YES'
         OR column_default_expression IS NOT NULL THEN
        RAISE EXCEPTION 'Step 4.1 migration stopped: dining_orders.table_number_snapshot exists with an unexpected type, nullability, or default.';
      END IF;
    END IF;
  END IF;
END;
$phase2_guestless_dine_in_orders$;

COMMIT;

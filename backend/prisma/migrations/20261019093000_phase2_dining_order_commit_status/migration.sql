BEGIN;

DO $phase2_dining_order_commit_status$
DECLARE
  orders_table REGCLASS := to_regclass('public.dining_orders');
  table_kind "char";
  column_type TEXT;
  column_nullable TEXT;
  status_check_definition TEXT;
  expected_legacy_definition TEXT := $legacy$CHECK ((status = ANY (ARRAY['reserved'::text, 'prepared'::text, 'ready'::text, 'released'::text, 'cancelled'::text])))$legacy$;
  expected_committed_definition TEXT := $committed$CHECK ((status = ANY (ARRAY['reserved'::text, 'prepared'::text, 'ready'::text, 'released'::text, 'cancelled'::text, 'committed'::text])))$committed$;
BEGIN
  IF orders_table IS NULL THEN
    RAISE NOTICE 'Skipping committed order state: public.dining_orders does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind
    FROM pg_class AS c
    WHERE c.oid = orders_table;

    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Step 4.2 migration stopped: public.dining_orders is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dining_orders'
        AND column_name = 'id'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dining_orders'
        AND column_name = 'status'
    ) THEN
      RAISE NOTICE 'Skipping committed order state: dining_orders is missing id or status.';
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dining_orders'
          AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
      ) THEN
        RAISE EXCEPTION 'Step 4.2 migration stopped: dining_orders.id must be NOT NULL text.';
      END IF;

      SELECT c.data_type, c.is_nullable
        INTO column_type, column_nullable
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public' AND c.table_name = 'dining_orders'
        AND c.column_name = 'status';

      IF column_type <> 'text' OR column_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Step 4.2 migration stopped: dining_orders.status must be NOT NULL text.';
      END IF;

      SELECT pg_get_constraintdef(c.oid)
        INTO status_check_definition
      FROM pg_constraint AS c
      WHERE c.conrelid = orders_table
        AND c.conname = 'dining_orders_status_check'
        AND c.contype = 'c';

      IF status_check_definition = expected_committed_definition THEN
        RAISE NOTICE 'Committed order state is already allowed.';
      ELSIF status_check_definition = expected_legacy_definition THEN
        EXECUTE 'ALTER TABLE public.dining_orders DROP CONSTRAINT dining_orders_status_check';
        EXECUTE 'ALTER TABLE public.dining_orders ADD CONSTRAINT dining_orders_status_check CHECK (status IN (''reserved'', ''prepared'', ''ready'', ''released'', ''cancelled'', ''committed''))';
      ELSE
        RAISE EXCEPTION 'Step 4.2 migration stopped: dining_orders_status_check is missing or has an unexpected definition.';
      END IF;
    END IF;
  END IF;
END;
$phase2_dining_order_commit_status$;

COMMIT;

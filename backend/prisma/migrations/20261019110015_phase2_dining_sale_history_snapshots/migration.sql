BEGIN;

DO $phase2_dining_sale_history_snapshots$
DECLARE
  pos_items_table REGCLASS := to_regclass('public.pos_items');
  pos_transactions_table REGCLASS := to_regclass('public.pos_transactions');
  table_kind "char";
  column_type TEXT;
  column_nullable TEXT;
  column_default_expression TEXT;
BEGIN
  IF pos_items_table IS NULL THEN
    RAISE NOTICE 'Skipping POS item name snapshot: public.pos_items does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind
    FROM pg_class AS c
    WHERE c.oid = pos_items_table;

    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Step 4.3 migration stopped: public.pos_items is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pos_items'
        AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pos_items'
        AND column_name = 'selling_product_id' AND data_type = 'text' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Step 4.3 migration stopped: public.pos_items is missing expected NOT NULL text id or selling_product_id columns.';
    END IF;

    SELECT c.data_type, c.is_nullable, c.column_default
      INTO column_type, column_nullable, column_default_expression
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'pos_items'
      AND c.column_name = 'name_snapshot';

    IF column_type IS NULL THEN
      ALTER TABLE public.pos_items ADD COLUMN name_snapshot TEXT;
    ELSIF column_type <> 'text' OR column_nullable <> 'YES' OR column_default_expression IS NOT NULL THEN
      RAISE EXCEPTION 'Step 4.3 migration stopped: pos_items.name_snapshot exists with an unexpected type, nullability, or default.';
    END IF;
  END IF;

  IF pos_transactions_table IS NULL THEN
    RAISE NOTICE 'Skipping POS transaction table-number snapshot: public.pos_transactions does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind
    FROM pg_class AS c
    WHERE c.oid = pos_transactions_table;

    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Step 4.3 migration stopped: public.pos_transactions is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pos_transactions'
        AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Step 4.3 migration stopped: public.pos_transactions.id must be NOT NULL text.';
    END IF;

    SELECT c.data_type, c.is_nullable, c.column_default
      INTO column_type, column_nullable, column_default_expression
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'pos_transactions'
      AND c.column_name = 'table_number_snapshot';

    IF column_type IS NULL THEN
      ALTER TABLE public.pos_transactions ADD COLUMN table_number_snapshot INTEGER;
    ELSIF column_type <> 'integer' OR column_nullable <> 'YES' OR column_default_expression IS NOT NULL THEN
      RAISE EXCEPTION 'Step 4.3 migration stopped: pos_transactions.table_number_snapshot exists with an unexpected type, nullability, or default.';
    END IF;
  END IF;
END;
$phase2_dining_sale_history_snapshots$;

COMMIT;

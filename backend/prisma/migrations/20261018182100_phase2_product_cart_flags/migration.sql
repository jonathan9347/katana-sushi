BEGIN;

DO $phase2_product_and_temporary_table_flags$
DECLARE
  products_table REGCLASS := to_regclass('public.selling_products');
  tables_table REGCLASS := to_regclass('public.tables');
  table_kind "char";
  column_type TEXT;
  column_nullable TEXT;
  existing_default_expression TEXT;
BEGIN
  IF products_table IS NULL THEN
    RAISE NOTICE 'Skipping sold-a-la-carte flag: public.selling_products does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind FROM pg_class AS c WHERE c.oid = products_table;
    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Phase 2 migration stopped: public.selling_products is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'selling_products'
        AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'selling_products'
        AND column_name = 'is_available' AND data_type = 'boolean' AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'selling_products'
        AND column_name = 'is_deleted' AND data_type = 'boolean' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Phase 2 migration stopped: public.selling_products is missing an expected id/text, is_available/boolean, or is_deleted/boolean column.';
    END IF;

    SELECT c.data_type, c.is_nullable, c.column_default
      INTO column_type, column_nullable, existing_default_expression
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'selling_products'
      AND c.column_name = 'is_sold_a_la_carte';

    IF column_type IS NULL THEN
      ALTER TABLE public.selling_products
        ADD COLUMN is_sold_a_la_carte BOOLEAN NOT NULL DEFAULT TRUE;
    ELSIF column_type <> 'boolean'
       OR column_nullable <> 'NO'
       OR existing_default_expression IS NULL
       OR lower(trim(existing_default_expression)) NOT IN ('true', 'true::boolean') THEN
      RAISE EXCEPTION 'Phase 2 migration stopped: selling_products.is_sold_a_la_carte exists with an unexpected type, nullability, or default.';
    END IF;
  END IF;

  IF tables_table IS NULL THEN
    RAISE NOTICE 'Skipping temporary-table flag: public.tables does not exist.';
  ELSE
    SELECT c.relkind INTO table_kind FROM pg_class AS c WHERE c.oid = tables_table;
    IF table_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'Phase 2 migration stopped: public.tables is not a table.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tables'
        AND column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tables'
        AND column_name = 'table_number' AND data_type = 'integer' AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tables'
        AND column_name = 'is_archived' AND data_type = 'boolean' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Phase 2 migration stopped: public.tables is missing an expected id/text, table_number/integer, or is_archived/boolean column.';
    END IF;

    SELECT c.data_type, c.is_nullable, c.column_default
      INTO column_type, column_nullable, existing_default_expression
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'tables'
      AND c.column_name = 'is_temporary';

    IF column_type IS NULL THEN
      ALTER TABLE public.tables
        ADD COLUMN is_temporary BOOLEAN NOT NULL DEFAULT FALSE;
    ELSIF column_type <> 'boolean'
       OR column_nullable <> 'NO'
       OR existing_default_expression IS NULL
       OR lower(trim(existing_default_expression)) NOT IN ('false', 'false::boolean') THEN
      RAISE EXCEPTION 'Phase 2 migration stopped: tables.is_temporary exists with an unexpected type, nullability, or default.';
    END IF;
  END IF;
END;
$phase2_product_and_temporary_table_flags$;

COMMIT;

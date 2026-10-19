BEGIN;

DO $phase2_senior_pwd_discount_snapshots$
DECLARE
  pos_transactions_table REGCLASS := to_regclass('public.pos_transactions');
  table_kind "char";
  column_type TEXT;
  column_nullable TEXT;
  column_default_expression TEXT;
BEGIN
  IF pos_transactions_table IS NULL THEN
    RAISE NOTICE 'Skipping senior/PWD discount snapshots: public.pos_transactions does not exist.';
    RETURN;
  END IF;

  SELECT c.relkind INTO table_kind
  FROM pg_class AS c
  WHERE c.oid = pos_transactions_table;

  IF table_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'Senior/PWD migration stopped: public.pos_transactions is not a table.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'pos_transactions'
      AND (
        (c.column_name = 'id' AND (c.data_type <> 'text' OR c.is_nullable <> 'NO'))
        OR (c.column_name IN ('subtotal', 'discount_amount')
            AND (c.data_type <> 'double precision' OR c.is_nullable <> 'NO'))
        OR (c.column_name IN ('guest_count', 'discount_guest_count')
            AND (c.data_type <> 'integer' OR c.is_nullable <> 'NO'))
      )
  ) THEN
    RAISE EXCEPTION
      'Senior/PWD migration stopped: an existing pos_transactions baseline column has an unexpected type or nullability.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'pos_transactions'
      AND c.column_name IN ('id', 'subtotal', 'discount_amount', 'guest_count', 'discount_guest_count')
  ) <> 5 THEN
    RAISE NOTICE 'Skipping senior/PWD discount snapshots: expected pos_transactions baseline columns are missing.';
    RETURN;
  END IF;

  SELECT c.data_type, c.is_nullable, c.column_default
    INTO column_type, column_nullable, column_default_expression
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'pos_transactions'
    AND c.column_name = 'discount_base_snapshot';

  IF NOT FOUND THEN
    ALTER TABLE public.pos_transactions
      ADD COLUMN discount_base_snapshot DOUBLE PRECISION;
  ELSIF column_type <> 'double precision'
     OR column_nullable <> 'YES'
     OR column_default_expression IS NOT NULL THEN
    RAISE EXCEPTION
      'Senior/PWD migration stopped: pos_transactions.discount_base_snapshot has an unexpected type, nullability, or default.';
  END IF;

  SELECT c.data_type, c.is_nullable, c.column_default
    INTO column_type, column_nullable, column_default_expression
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'pos_transactions'
    AND c.column_name = 'discount_rate_snapshot';

  IF NOT FOUND THEN
    ALTER TABLE public.pos_transactions
      ADD COLUMN discount_rate_snapshot DOUBLE PRECISION;
  ELSIF column_type <> 'double precision'
     OR column_nullable <> 'YES'
     OR column_default_expression IS NOT NULL THEN
    RAISE EXCEPTION
      'Senior/PWD migration stopped: pos_transactions.discount_rate_snapshot has an unexpected type, nullability, or default.';
  END IF;
END;
$phase2_senior_pwd_discount_snapshots$;

COMMIT;
